import {TEST_NOW} from './test-clock.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const playwrightPath=process.env.PLAYWRIGHT_PATH;
if(!playwrightPath)throw new Error('Imposta PLAYWRIGHT_PATH sul modulo Playwright disponibile.');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const temp=mkdtempSync(path.join(tmpdir(),'aloven-task-list-')),artifacts=path.resolve('.artifacts');
mkdirSync(artifacts,{recursive:true});
let browser,server;

try{
  server=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,HOST:'127.0.0.1',PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Avvio server scaduto: ${output}`)),15000);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.stderr.on('data',chunk=>process.stderr.write(chunk));server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server terminato: ${code} ${output}`));});});
  browser=await chromium.launch({headless:process.env.HEADFUL!=='1',channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  await page.goto(base);
  await page.getByLabel('Nome e cognome').fill('Verifica elenco attività');
  await page.getByLabel('Nome utente',{exact:true}).fill('tasklist');
  await page.getByLabel('Password',{exact:true}).fill('PasswordTest123!');
  await page.getByRole('button',{name:'Crea amministratore'}).click();
  await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
  const seed=spawn(process.execPath,['seed-history.mjs'],{env:{...process.env,DATA_DIR:temp},stdio:['ignore','ignore','pipe']});
  assert.equal((await once(seed,'exit'))[0],0);
  await page.locator('#refresh').click();
  const seeded=await(await page.request.get(base+'/api/state')).json();
  await page.waitForFunction(revision=>document.querySelector('.shell')?.dataset.revision===String(revision),seeded.revision);
  await page.locator('[data-nav="tasks"]').click();
  await page.locator('.task-table').waitFor();

  const editableRow=page.locator('.task-table tbody tr').filter({has:page.getByRole('button',{name:'Modifica'})}).first();
  const editableTitle=await editableRow.locator('.task-primary>strong').innerText();
  const editable=seeded.tasks.find(task=>task.title===editableTitle);
  assert.ok(editable,`Attività modificabile non trovata: ${editableTitle}`);
  await editableRow.getByRole('button',{name:'Modifica'}).click();
  await page.locator('#modal .order-references[open]').waitFor();
  await page.getByLabel('Riferimento ordine').fill('ORD-CLIENTE-INTERNAZIONALE-2026-000184-LAVORAZIONE-URGENTE');
  await page.getByLabel('Lotto prodotto previsto').fill('LOTTO-PRODOTTO-FINITO-TRACCIABILITA-ESTESA-2026-10');
  await page.getByLabel('Consegna prevista').fill('2026-12-31');
  await page.getByLabel('Cliente',{exact:true}).fill('Cliente Prova Filtri');
  await page.locator('#modal').getByRole('button',{name:'Salva'}).click();
  const confirmation=page.locator('#modal').getByRole('heading',{name:'Conferma la modifica'});
  await Promise.race([
    confirmation.waitFor({state:'visible'}),
    page.locator('#modal').waitFor({state:'hidden'})
  ]);
  if(await confirmation.isVisible().catch(()=>false))await page.locator('#modal').getByRole('button',{name:'Conferma e salva'}).click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('.task-references').first().waitFor();

  for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);
    const geometry=await page.locator('.task-table tbody tr').evaluateAll(rows=>rows.map(row=>{const cells=row.cells,product=cells[5]?.getBoundingClientRect(),actions=cells[8]?.getBoundingClientRect();return {height:row.getBoundingClientRect().height,productRight:product?.right,actionsLeft:actions?.left};}));
    const heights=geometry.map(row=>row.height).sort((a,b)=>a-b),median=heights[Math.floor(heights.length/2)];
    assert.ok(median>=50&&median<=70,`Altezza mediana ${median}px a ${viewport.width}px`);
    assert.ok(geometry.every(row=>row.productRight<=row.actionsLeft+1),`Articolo prodotto coperto dalle azioni a ${viewport.width}px`);
    assert.equal(await page.locator('.task-table tbody tr').count(),25);
    assert.ok(await page.locator('.task-table tbody tr').first().locator('.product-column strong').isVisible());
    assert.ok(await page.locator('.task-table tbody tr').first().locator('.task-machine strong').isVisible());
    await page.screenshot({path:path.join(artifacts,`task-list-${viewport.width}x${viewport.height}.png`),fullPage:true});
  }

  // Filtri aggiuntivi, chip, azzera e selettore colonne
  assert.equal(await page.locator('#status-filter').inputValue(),'active','Il filtro predefinito deve essere Attive');
  assert.equal(await page.locator('.filter-chips').count(),0,'Nessun chip con i filtri predefiniti');
  await page.locator('#status-filter').selectOption('');
  await page.locator('.filter-chips .chip',{hasText:'Stato: Tutti'}).waitFor();
  await page.locator('#clear-task-filters').click();
  assert.equal(await page.locator('#status-filter').inputValue(),'active','Azzera deve tornare ad Attive');
  const lateButton=page.locator('#late-filter');
  assert.match(await lateButton.innerText(),/^In ritardo \(\d+\)$/);
  await lateButton.click();
  assert.equal(await page.locator('#late-filter').getAttribute('aria-pressed'),'true');
  await page.locator('.filter-chips .chip',{hasText:'Solo in ritardo'}).waitFor();
  await page.locator('#clear-task-filters').click();
  assert.equal(await page.locator('.filter-chips').count(),0);
  assert.equal(await page.locator('.task-table tbody tr').count(),25);
  const customers=await page.locator('#customer-filter option').allTextContents();
  assert.ok(customers.length>1,'Nessun cliente nel filtro');
  await page.locator('#customer-filter').selectOption({index:1});
  await page.locator('.filter-chips .chip',{hasText:'Cliente: '}).waitFor();
  for(const cell of await page.locator('.task-table tbody td.task-customer strong').allTextContents())assert.equal(cell,customers[1]);
  await page.locator('.filter-chips .chip',{hasText:'Cliente: '}).click();
  assert.equal(await page.locator('.filter-chips').count(),0);
  await page.locator('#period-filter').selectOption('today');
  await page.locator('.filter-chips .chip',{hasText:'Periodo: Oggi'}).waitFor();
  await page.locator('#clear-task-filters').click();
  const picker=page.locator('.column-picker');
  await picker.locator('summary').click();
  await picker.locator('[data-col="materials"]').uncheck();
  assert.equal(await page.locator('.task-table th',{hasText:'Componenti consumati'}).isVisible(),false);
  await page.reload();await page.locator('[data-nav="tasks"]').click();await page.locator('.task-table').waitFor();
  assert.equal(await page.locator('.task-table th',{hasText:'Componenti consumati'}).isVisible(),false,'Colonna nascosta non ricordata');
  await page.locator('.column-picker summary').click();
  await page.locator('.column-picker [data-col="materials"]').check();
  assert.equal(await page.locator('.task-table th',{hasText:'Componenti consumati'}).isVisible(),true);
  const tinyText=await page.locator('.task-table tbody tr').first().evaluate(row=>[...row.querySelectorAll('small,.badge,.dispatch-quiet,.task-type')].filter(el=>parseFloat(getComputedStyle(el).fontSize)<12).map(el=>el.className||el.tagName));
  assert.deepEqual(tinyText,[],'Testi secondari sotto 12px');

  // «Annulla» nella conferma riporta alla scheda con i dati già inseriti, senza doverli reinserire
  await page.locator('#status-filter').selectOption('');
  const second=page.locator('.task-table tbody tr').filter({has:page.getByRole('button',{name:'Modifica'})}).nth(1);
  await second.getByRole('button',{name:'Modifica'}).click();
  await page.locator('#modal .order-references[open]').waitFor();
  await page.getByLabel('Note',{exact:true}).fill('Nota da conservare dopo Annulla');
  await page.getByLabel('Consegna prevista').fill('');
  await page.getByLabel('Riferimento ordine').fill('ORD-CONSERVA-1');
  await page.locator('#modal').getByRole('button',{name:'Salva'}).click();
  await page.locator('#modal').getByText('Verifica i dati della lavorazione').waitFor();
  await page.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();
  await page.getByLabel('Note',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Note',{exact:true}).inputValue(),'Nota da conservare dopo Annulla','Le note inserite sono andate perse');
  assert.equal(await page.getByLabel('Riferimento ordine').inputValue(),'ORD-CONSERVA-1','Il riferimento inserito è andato perso');
  page.once('dialog',dialog=>{assert.match(dialog.message(),/modifiche non salvate/);dialog.accept();});// i dati ripristinati contano come non salvati
  await page.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('#clear-task-filters').click();

  const reference=page.locator('.task-references summary').first();
  await reference.focus();await page.keyboard.press('Enter');
  assert.ok(await reference.evaluate(summary=>summary.parentElement.open));
  await page.keyboard.press('Enter');
  assert.equal(await reference.evaluate(summary=>summary.parentElement.open),false);
  const firstRow=await page.locator('.task-table tbody tr').first().innerText();
  await page.locator('#list-next').click();
  assert.notEqual(await page.locator('.task-table tbody tr').first().innerText(),firstRow);
  const target=editable;
  const search=page.getByLabel('Cerca attività',{exact:true});
  await search.fill(target.title);
  const row=page.getByRole('row').filter({hasText:target.title}).first();
  await row.getByRole('button',{name:'Apri'}).click();
  await page.locator('#modal').getByRole('heading',{name:target.title}).waitFor();
  const referenceValues=await page.locator('.task-detail-references strong').allTextContents();
  assert.deepEqual(referenceValues,[
    'ORD-CLIENTE-INTERNAZIONALE-2026-000184-LAVORAZIONE-URGENTE','—','Cliente Prova Filtri','2026-12-31','LOTTO-PRODOTTO-FINITO-TRACCIABILITA-ESTESA-2026-10'
  ]);
  const current=await(await page.request.get(base+'/api/state')).json(),currentTarget=current.tasks.find(task=>task.id===target.id);
  const sequence=current.tasks.filter(task=>task.machineId===currentTarget.machineId&&task.position!==null&&task.id!==target.id).sort((a,b)=>a.position-b.position),boundary=sequence.findLastIndex(task=>['in_progress','completed'].includes(task.status));
  const optionValues=await page.locator('#plan-task select[name="beforeId"] option').evaluateAll(options=>options.slice(1).map(option=>option.value));
  assert.deepEqual(optionValues,sequence.slice(boundary+1).map(task=>task.id));
  if(boundary>=0)assert.match(await page.locator('#plan-task .notice').textContent(),new RegExp(`^${boundary+1} posizion`));
  await page.locator('#modal').getByRole('button',{name:'Chiudi'}).click();
  assert.equal(await search.inputValue(),target.title);
  assert.ok(await row.isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS task list: 1366/1920, long refs, disclosures, 25-row paging, filter and detail return.');
}finally{
  await browser?.close();
  if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}
  rmSync(temp,{recursive:true,force:true});
}
