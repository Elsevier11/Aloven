import {TEST_NOW} from './test-clock.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const playwrightPath=process.env.PLAYWRIGHT_PATH;
if(!playwrightPath)throw new Error('Imposta PLAYWRIGHT_PATH sul modulo Playwright disponibile.');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const temp=mkdtempSync(path.join(tmpdir(),'aloven-desktop-flow-'));
const results=[];
let browser,child,context,page,base;

async function test(name,fn){
  try{await fn();results.push({name,status:'passed'});console.log(`PASS ${name}`);}
  catch(error){results.push({name,status:'failed',error:error.stack||String(error)});console.error(`FAIL ${name}: ${error.message}`);}
}
const state=async(target=page)=>target.evaluate(async()=>{const response=await fetch('/api/state');if(!response.ok)throw new Error(`state ${response.status}`);return response.json();});
const groups={machines:'catalogues',types:'catalogues',articles:'catalogues',setupRules:'catalogues',scrapReasons:'catalogues',machineStopReasons:'catalogues',calendar:'settings',users:'settings'};
async function nav(name,target=page){if(groups[name])await target.locator(`[data-nav-group="${groups[name]}"]`).click();await target.locator(`[data-nav="${name}"]`).click();}

try{
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,HOST:'127.0.0.1',PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Avvio server scaduto: ${output}`)),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>process.stderr.write(chunk));child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server terminato: ${code} ${output}`));});});
  browser=await chromium.launch({headless:process.env.HEADFUL!=='1',channel:'msedge'});
  context=await browser.newContext({viewport:{width:1366,height:768}});
  page=await context.newPage();
  let dialogAction='dismiss',dialogs=[];
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());if(dialogAction==='accept')await dialog.accept();else await dialog.dismiss();});
  await page.goto(base);
  await page.getByLabel('Nome e cognome').fill('Admin desktop');
  await page.getByLabel('Nome utente',{exact:true}).fill('admin');
  await page.getByLabel('Password',{exact:true}).fill('PasswordTest123!');
  await page.getByRole('button',{name:'Crea amministratore'}).click();
  await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();

  // The Consegne control only appears when at least one open activity has a declared delivery date.
  const delivery=await page.evaluate(async()=>{const h={'Content-Type':'application/json','X-Aloven-Request':'1'},s=await(await fetch('/api/state')).json(),t=s.tasks.find(x=>x.status==='unplanned'),p=await(await fetch('/api/preview',{method:'POST',headers:h,body:JSON.stringify({revision:s.revision,action:{kind:'task',id:t.id,values:{...t,dueDate:'2026-10-20'}}})})).json(),c=await fetch('/api/commit',{method:'POST',headers:h,body:JSON.stringify({token:p.token})});return c.status;});
  assert.equal(delivery,200);await page.reload();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
  await test('consegne prioritarie: dettaglio, Escape e clic esterno',async()=>{
    const panel=page.locator('.planning-priorities'),summary=panel.locator('summary');
    await summary.click();
    assert.ok(await panel.evaluate(details=>details.open));
    await page.keyboard.press('Escape');
    assert.equal(await panel.evaluate(details=>details.open),false);
    assert.ok(await summary.evaluate(element=>document.activeElement===element));
    await summary.click();
    await page.getByRole('heading',{name:'Piano di produzione'}).click();
    assert.equal(await panel.evaluate(details=>details.open),false);
    if(await panel.locator('[data-detail]').count()){
      await summary.click();
      await panel.locator('[data-detail]').first().click();
      assert.ok(await page.locator('#modal').evaluate(dialog=>dialog.open));
      await page.locator('#modal').getByRole('button',{name:'Chiudi',exact:true}).click();
    }
  });

  await test('annullamento invariato e protezione modifiche con Annulla/Escape',async()=>{
    await nav('machines');
    const edit=page.locator('[data-edit^="machine:"]').first();
    await edit.click();
    const before=dialogs.length;
    await page.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();
    await page.locator('#modal').waitFor({state:'hidden'});
    assert.equal(dialogs.length,before,'Un form invariato non deve chiedere conferma');
    await edit.click();
    const name=page.getByLabel('Nome macchina');
    await name.fill(`${await name.inputValue()} prova`);
    await page.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();
    await page.locator('#modal .discard-confirm').waitFor();
    assert.match(await page.locator('#modal .discard-confirm').textContent(),/modifiche non salvate/i);
    await page.locator('#modal .discard-confirm').getByRole('button',{name:'Continua a modificare'}).click();
    assert.ok(await page.locator('#modal').evaluate(dialog=>dialog.open));
    assert.equal(await page.locator('#modal .discard-confirm').count(),0);
    await page.keyboard.press('Escape');
    await page.locator('#modal .discard-confirm').getByRole('button',{name:'Chiudi senza salvare'}).click();
    await page.locator('#modal').waitFor({state:'hidden'});
  });

  await test('errore di rete: invio singolo, chiusura bloccata e campi conservati',async()=>{
    await nav('machines');
    await page.locator('[data-edit^="machine:"]').first().click();
    const name=page.getByLabel('Nome macchina'),changed=`${await name.inputValue()} rete`;
    await name.fill(changed);
    let release,hits=0;const gate=new Promise(resolve=>release=resolve);
    await page.route('**/api/preview',async route=>{hits++;await gate;await route.abort('failed');});
    await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).click();
    await page.locator('#modal form[aria-busy="true"]').waitFor();
    assert.equal(await page.locator('#modal form button:not([disabled]),#modal form input:not([disabled]),#modal form select:not([disabled]),#modal form textarea:not([disabled])').count(),0);
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#modal').evaluate(dialog=>dialog.open),'Escape non deve chiudere durante l’invio');
    await page.locator('#modal form').evaluate(form=>form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));
    release();
    await page.locator('#modal .dialog-error:not([hidden])').waitFor();
    await page.unroute('**/api/preview');
    assert.equal(hits,1,'L’invio pendente non deve essere duplicato');
    assert.equal(await name.inputValue(),changed);
    assert.ok(await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).isEnabled());
    dialogAction='accept';
    await page.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();
    await page.locator('#modal').waitFor({state:'hidden'});
  });

  await test('dettaglio attività, filtro e focus restano stabili',async()=>{
    const task=(await state()).tasks.find(item=>['planned','unplanned'].includes(item.status));
    assert.ok(task,'Serve un’attività modificabile per verificare il ritorno alla scheda.');
    await nav('tasks');
    const search=page.getByLabel('Cerca attività',{exact:true});
    await search.fill(task.title);
    await page.getByRole('row').filter({hasText:task.title}).getByRole('button',{name:'Apri'}).click();
    await page.getByRole('button',{name:'Modifica attività'}).click();
    await page.getByLabel('Note').fill('Bozza da scartare');
    dialogAction='accept';
    await page.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();
    await page.locator('#modal').getByRole('heading',{name:task.title}).waitFor();
    await page.locator('#modal').getByRole('button',{name:'Chiudi',exact:true}).click();
    assert.equal(await search.inputValue(),task.title);
    const tableScroll=await page.locator('.table-wrap').evaluate(table=>{const max=Math.max(0,table.scrollWidth-table.clientWidth),left=max>=20?Math.min(40,max):0;table.scrollLeft=left;return left;});
    await page.locator('#refresh').click();
    await page.waitForFunction(()=>document.activeElement?.id==='refresh');
    assert.equal(await page.getByLabel('Cerca attività',{exact:true}).inputValue(),task.title);
    assert.equal(await page.getByRole('row').filter({hasText:task.title}).count(),1);
    assert.equal(await page.locator('.table-wrap').evaluate(table=>table.scrollLeft),tableScroll);
  });

  await test('calendario: modifica scartata con conferma senza anteprima sostitutiva',async()=>{
    await nav('calendar');
    await page.getByRole('button',{name:'Imposta periodo'}).click();
    const to=page.getByLabel('Al',{exact:true});
    await to.fill('2030-01-02');
    const title=await page.locator('#modal h2').textContent();
    await page.locator('#modal').getByRole('button',{name:'Chiudi',exact:true}).click();
    await page.locator('#modal .discard-confirm').waitFor();
    await page.locator('#modal .discard-confirm').getByRole('button',{name:'Continua a modificare'}).click();
    assert.equal(await page.locator('#modal h2').textContent(),title);
    assert.ok(await page.locator('#modal').evaluate(dialog=>dialog.open));
    await page.locator('#modal').getByRole('button',{name:'Chiudi',exact:true}).click();
    await page.locator('#modal .discard-confirm').getByRole('button',{name:'Chiudi senza salvare'}).click();
    await page.locator('#modal').waitFor({state:'hidden'});
  });

  await test('permessi del pianificatore: calendario modificabile, utenti e anagrafiche no',async()=>{
    await nav('users');
    await page.getByRole('button',{name:'Nuovo utente'}).click();
    await page.getByLabel('Nome e cognome').fill('Pianificatore desktop');
    await page.getByLabel('Nome utente').fill('pianificatore');
    await page.getByLabel('Ruolo').selectOption('planner');
    await page.getByLabel('Password').fill('PasswordTest123!');
    await page.getByRole('button',{name:'Salva',exact:true}).click();
    await page.locator('#modal').waitFor({state:'hidden'});
    const plannerContext=await browser.newContext({viewport:{width:1366,height:768}}),planner=await plannerContext.newPage();
    await planner.goto(base);
    await planner.getByLabel('Nome utente').fill('pianificatore');
    await planner.getByLabel('Password').fill('PasswordTest123!');
    await planner.getByRole('button',{name:'Accedi'}).click();
    await planner.getByRole('heading',{name:'Piano di produzione'}).waitFor();
    assert.ok(await planner.locator('#release-plan').count(),'il pianificatore rilascia il piano');
    await planner.locator('[data-nav-group="settings"]').click();
    assert.equal(await planner.locator('[data-nav="users"]').count(),0);
    assert.equal(await planner.locator('[data-nav="backups"]').count(),0);
    await planner.locator('#weekly-form').waitFor();// con una sola voce il menu secondario non c'è: la pagina si apre dal gruppo
    assert.equal(await planner.getByRole('button',{name:'Imposta periodo'}).count(),1,'il pianificatore gestisce il calendario');
    assert.equal(await planner.locator('#weekly-form fieldset').evaluate(fieldset=>fieldset.disabled),false);
    assert.equal(await planner.locator('.section-navigation').count(),0,'menu secondario con una sola voce nascosto');
    await planner.locator('[data-nav-group="catalogues"]').click();
    await planner.locator('[data-nav="machines"]').click();
    assert.equal(await planner.locator('[data-edit^="machine:"],[data-delete^="machine:"]').count(),0,'le anagrafiche restano all’amministratore');
    await planner.locator('[data-nav="scrapReasons"]').click();
    assert.equal(await planner.locator('#new-cause').count(),1,'il pianificatore gestisce le causali');
    await plannerContext.close();
  });

  await test('operatore: atterra sulla vista touch e non accede alla pianificazione',async()=>{
    await nav('users');
    await page.getByRole('button',{name:'Nuovo utente'}).click();
    await page.getByLabel('Nome e cognome').fill('Operatore desktop');
    await page.getByLabel('Nome utente').fill('operatore');
    await page.getByLabel('Password').fill('PasswordTest123!');
    await page.getByRole('button',{name:'Salva',exact:true}).click();
    await page.locator('#modal').waitFor({state:'hidden'});
    const operatorContext=await browser.newContext({viewport:{width:1366,height:768}}),operator=await operatorContext.newPage();
    await operator.goto(base);
    await operator.getByLabel('Nome utente').fill('operatore');
    await operator.getByLabel('Password').fill('PasswordTest123!');
    await operator.getByRole('button',{name:'Accedi'}).click();
    await operator.waitForURL('**/operatore');
    assert.equal(await operator.evaluate(()=>fetch('/api/state').then(r=>r.status)),403,'lo stato della pianificazione è negato all’operatore');
    assert.equal(await operator.evaluate(()=>fetch('/api/state?view=shopfloor').then(r=>r.status)),200);
    await operator.goto(base);
    await operator.waitForURL('**/operatore');
    await operatorContext.close();
  });
}catch(error){results.push({name:'bootstrap',status:'failed',error:error.stack||String(error)});console.error(error);}
finally{
  await browser?.close();
  if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}
  rmSync(temp,{recursive:true,force:true});
}

const failed=results.filter(result=>result.status==='failed');
if(failed.length){console.error(`Desktop flow suite: ${results.length-failed.length}/${results.length} passed`);process.exitCode=1;}
else console.log(`Desktop flow suite: ${results.length}/${results.length} passed`);
