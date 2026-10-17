import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const playwrightPath=process.env.PLAYWRIGHT_PATH||'C:/Users/Paolo Pedron/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const temp=mkdtempSync(path.join(tmpdir(),'aloven-revision-review-'));
const artifacts=path.resolve('.artifacts');mkdirSync(artifacts,{recursive:true});
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:temp,PORT:'0',ALOVEN_NOW:'2026-01-01T07:00:00Z'},stdio:['ignore','pipe','pipe']});
const report={startedAt:new Date().toISOString(),passed:[],failures:[],consoleErrors:[],pageErrors:[],networkErrors:[],screenshots:[]};
let browser,page,base,currentCase='bootstrap';
const reportFile=path.join(artifacts,'revision-review-report.json');
const flush=()=>writeFileSync(reportFile,JSON.stringify(report,null,2));
const capture=async name=>{const file=path.join(artifacts,`revision-review-${name}.png`);await page.screenshot({path:file,fullPage:false});report.screenshots.push({name,file});};
const check=async(name,fn)=>{currentCase=name;try{await fn();report.passed.push(name);flush();}catch(error){const file=path.join(artifacts,`revision-review-failure-${report.failures.length+1}.png`);await page.screenshot({path:file,fullPage:false}).catch(()=>{});report.failures.push({name,error:error.stack||String(error),screenshot:file});flush();await page.locator('#modal').evaluate(element=>element.open&&element.close()).catch(()=>{});}};

try{
  base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Timeout avvio server: ${output}`)),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>{output+=chunk;});child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Server terminato (${code}): ${output}`));});});
  browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
  const context=await browser.newContext({viewport:{width:1366,height:768}});context.setDefaultTimeout(8000);
  page=await context.newPage();
  page.on('pageerror',error=>report.pageErrors.push({case:currentCase,message:error.message}));
  page.on('console',message=>{if(['error','warning'].includes(message.type()))report.consoleErrors.push({case:currentCase,type:message.type(),message:message.text()});});
  page.on('response',response=>{if(response.status()>=500)report.networkErrors.push({case:currentCase,status:response.status(),url:response.url()});});
  await page.goto(base);
  await page.getByLabel('Nome e cognome').fill('Revisore MES');
  await page.getByLabel('Nome utente',{exact:true}).fill('review-admin');
  await page.getByLabel('Password',{exact:true}).fill('RevisionCheck123!');
  await page.getByRole('button',{name:'Crea amministratore'}).click();
  await page.locator('[data-nav="tasks"]').waitFor();

  const state=async()=>await (await page.request.get(base+'/api/state')).json();
  const post=async(endpoint,data,expected=200)=>{const response=await page.request.post(`${base}/api/${endpoint}`,{data,headers:{'X-Aloven-Request':'1'}});assert.equal(response.status(),expected,await response.text());return response.json();};
  const action=async value=>{const before=await state(),preview=await post('preview',{revision:before.revision,action:value});await post('commit',{token:preview.token});return state();};
  let fixture=await action({kind:'machine',values:{name:'Revisione UI',description:'Fixture isolata',anchor:'2026-01-02T08:00',speed:10,speedUnit:'m'}});
  const reviewMachine=fixture.machines.find(machine=>machine.name==='Revisione UI');
  const calendar=structuredClone(fixture.calendar);calendar.exceptions['2026-02-03']=[['09:00','11:00']];await action({kind:'calendar',values:calendar});
  await page.reload();await page.locator('[data-nav="tasks"]').waitFor();

  const openTaskForm=async()=>{await page.locator('[data-nav="tasks"]').click();await page.getByRole('button',{name:'Nuova attività'}).click();const modal=page.locator('#modal');await modal.getByRole('heading',{name:'Nuova attività'}).waitFor();await modal.getByLabel('Prodotto da realizzare').selectOption({index:1});await modal.locator('select[name="machineId"]').selectOption(reviewMachine.id);await modal.getByLabel('Componente 1').selectOption({index:1});await modal.getByLabel('Componente 2').selectOption({index:2});return modal;};

  await check('Quantità e consegna mancanti: avviso, annulla senza scrittura, conferma singola',async()=>{
    let before=await state(),modal=await openTaskForm();
    await modal.locator('input[name="runMinutes"]').fill('45');
    const chosen={machine:await modal.locator('select[name="machineId"]').inputValue(),c1:await modal.getByLabel('Componente 1').inputValue(),c2:await modal.getByLabel('Componente 2').inputValue(),product:await modal.getByLabel('Prodotto da realizzare').inputValue()};
    await modal.getByRole('button',{name:'Salva',exact:true}).click();
    await modal.getByRole('heading',{name:'Conferma la modifica'}).waitFor();
    const warning=(await modal.getByRole('alert').textContent()).replace(/\s+/g,' ');
    assert.match(warning,/quantità/i);assert.match(warning,/consegna/i);
    await capture('warning-desktop-1366');
        await modal.getByRole('button',{name:'Annulla',exact:true}).click();
    // Annulla nell'avviso riporta alla scheda con i dati già inseriti
    await modal.getByRole('heading',{name:'Nuova attività'}).waitFor();
    assert.equal(await modal.locator('input[name="runMinutes"]').inputValue(),'45');
    assert.deepEqual({machine:await modal.locator('select[name="machineId"]').inputValue(),c1:await modal.getByLabel('Componente 1').inputValue(),c2:await modal.getByLabel('Componente 2').inputValue(),product:await modal.getByLabel('Prodotto da realizzare').inputValue()},chosen,'I dati inseriti non sono stati conservati');
    assert.equal((await state()).revision,before.revision,'Annullare l’avviso non deve scrivere');

    await modal.getByRole('button',{name:'Salva',exact:true}).click();await modal.getByRole('heading',{name:'Conferma la modifica'}).waitFor();await modal.getByRole('button',{name:'Conferma e salva'}).click();await modal.waitFor({state:'hidden'});
    const after=await state();assert.equal(after.revision,before.revision+1);assert.equal(after.tasks.filter(task=>task.machineId===reviewMachine.id).length,1,'La conferma deve creare una sola attività');
  });

  await check('Componenti uguali e consegna passata mostrano entrambi gli avvisi',async()=>{
    const modal=await openTaskForm();const first=await modal.getByLabel('Componente 1').inputValue();await modal.getByLabel('Componente 2').selectOption(first);await modal.locator('input[name="quantity"]').fill('120');await modal.locator('input[name="dueDate"]').fill('2026-01-01');await modal.getByRole('button',{name:'Salva',exact:true}).click();await modal.getByRole('heading',{name:'Conferma la modifica'}).waitFor();const warning=(await modal.getByRole('alert').textContent()).replace(/\s+/g,' ');assert.match(warning,/componenti.*uguali|stesso componente/i);assert.match(warning,/consegna.*passat|data.*passat/i);await modal.getByRole('button',{name:'Annulla',exact:true}).click();
    // Annulla riporta alla scheda con i componenti e la consegna già inseriti, per verificarli o correggerli
    await modal.getByRole('heading',{name:'Nuova attività'}).waitFor();
    assert.equal(await modal.getByLabel('Componente 2').inputValue(),first);assert.equal(await modal.locator('input[name="quantity"]').inputValue(),'120');assert.equal(await modal.locator('input[name="dueDate"]').inputValue(),'2026-01-01');
    page.once('dialog',dialog=>dialog.accept());await modal.getByRole('button',{name:'Annulla',exact:true}).click();await modal.waitFor({state:'hidden'});
  });

  await check('Festività italiane: annulla invariato, applica anno e conserva eccezione preesistente',async()=>{
    await page.locator('[data-nav-group="settings"]').click();await page.locator('[data-nav="calendar"]').click();await page.getByRole('heading',{name:'Calendario di produzione'}).waitFor();
    let before=await state();await page.getByRole('button',{name:'Aggiungi festività italiane'}).click();let modal=page.locator('#modal');assert.match(await modal.textContent(),/2026/);await capture('holidays-dialog-desktop');await modal.getByRole('button',{name:'Annulla',exact:true}).click();assert.equal((await state()).revision,before.revision);
    await page.getByRole('button',{name:'Aggiungi festività italiane'}).click();await modal.getByRole('button',{name:'Verifica le nuove date'}).click();await modal.getByRole('heading',{name:'Conferma la modifica'}).waitFor();await modal.getByRole('button',{name:'Conferma e salva'}).click();await modal.waitFor({state:'hidden'});
    const after=await state();assert.deepEqual(after.calendar.exceptions['2026-02-03'],[['09:00','11:00']]);for(const date of ['2026-01-01','2026-04-06','2026-12-25'])assert.deepEqual(after.calendar.exceptions[date],[],`Festività assente: ${date}`);
  });

  await check('Attività mostra il badge per un inizio previsto superato',async()=>{
    let snapshot=await state();const task=snapshot.tasks.find(item=>item.machineId===reviewMachine.id);await action({kind:'plan',id:task.id,machineId:reviewMachine.id,fixedStart:'2026-01-02T08:00'});await page.reload();await page.locator('[data-nav="tasks"]').click();await page.locator('#task-search').fill(task.title);const row=page.locator('tbody tr').filter({hasText:task.title}).filter({hasText:reviewMachine.name});await row.waitFor();assert.match(await row.textContent(),/Inizio previsto superato da \d+ (min|h|gg)/);await page.locator('#late-filter').click();assert.ok(await row.isVisible(),'Il filtro In ritardo nasconde un ritardo');await capture('attivita-ritardo');await page.locator('#clear-task-filters').click();
  });

  await check('Layout avvisi e calendario a 390 px senza overflow orizzontale pagina',async()=>{
    await page.setViewportSize({width:390,height:844});await page.locator('[data-nav="tasks"]').click();const modal=await openTaskForm();await modal.locator('input[name="runMinutes"]').fill('45');await modal.getByRole('button',{name:'Salva',exact:true}).click();await modal.getByRole('heading',{name:'Conferma la modifica'}).waitFor();const warningBox=modal.getByRole('alert');const geometry=await warningBox.evaluate(element=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(geometry.left>=0&&geometry.right<=390,JSON.stringify(geometry));assert.ok(geometry.documentWidth<=391,JSON.stringify(geometry));await capture('warning-mobile-390');await modal.getByRole('button',{name:'Annulla',exact:true}).click();await modal.getByRole('heading',{name:'Nuova attività'}).waitFor();page.once('dialog',dialog=>dialog.accept());await modal.getByRole('button',{name:'Annulla',exact:true}).click();await modal.waitFor({state:'hidden'});
    await page.locator('[data-nav-group="settings"]').click();await page.locator('[data-nav="calendar"]').click();await page.getByRole('heading',{name:'Calendario di produzione'}).waitFor();await capture('calendar-mobile-390');const calendarGeometry=await page.evaluate(()=>({documentWidth:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(calendarGeometry.documentWidth<=391,JSON.stringify(calendarGeometry));
  });

  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.networkErrors,[]);
}catch(error){await check(currentCase,async()=>{throw error;});}
finally{report.finishedAt=new Date().toISOString();flush();await browser?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited.catch(()=>{});}rmSync(temp,{recursive:true,force:true});}

if(report.failures.length){console.error(`FAIL revision review: ${report.failures.length}; report ${reportFile}`);process.exitCode=1;}else console.log(`PASS revision review: ${report.passed.length} scenari; report ${reportFile}`);
