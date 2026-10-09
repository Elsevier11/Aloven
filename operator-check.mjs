import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const { chromium, request }=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-operator-'));
const artifacts=path.resolve('.artifacts');mkdirSync(artifacts,{recursive:true});
const results=[];let browser,child,base,page,adminApi,taskId,selectedScrapReason,shot=0;
const stamp=()=>new Date().toISOString();
const report={startedAt:stamp(),dataDir:temp,headless:process.env.HEADFUL!=='1',browser:'Microsoft Edge',results};
async function screenshot(name,p=page){const file=path.join(artifacts,`operator-${String(++shot).padStart(2,'0')}-${name}.png`);await p.screenshot({path:file,fullPage:true});return path.relative(process.cwd(),file);}
async function test(name,fn){const started=Date.now();try{await fn();results.push({name,status:'passed',durationMs:Date.now()-started});console.log(`PASS ${name}`);}catch(error){let image=null;try{image=await screenshot(`failure-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`);}catch{}results.push({name,status:'failed',durationMs:Date.now()-started,error:error.stack||String(error),screenshot:image});console.error(`FAIL ${name}: ${error.message}`);}}
async function apiPost(api,url,data){const response=await api.post(url,{headers:{'X-Aloven-Request':'1'},data});const json=await response.json();if(!response.ok())throw new Error(`${url} ${response.status()}: ${json.error||JSON.stringify(json)}`);return json;}
async function state(api=adminApi){const response=await api.get('/api/state');assert.ok(response.ok(),`state ${response.status()}`);return response.json();}
async function mutate(action){const current=await state();const preview=await apiPost(adminApi,'/api/preview',{revision:current.revision,action});await apiPost(adminApi,'/api/commit',{token:preview.token});return state();}
async function buildFixture(){
  await apiPost(adminApi,'/api/setup',{name:'Amministratore test operatore',username:'adminoperator',password:'PasswordTest123!'});
  await apiPost(adminApi,'/api/users',{name:'Operatore touch',username:'operatore',password:'PasswordTest123!',role:'operator'});
  let current=await state();const machine=current.machines.find(x=>x.id==='CNC-01');assert.ok(machine,'Macchina CNC-01 assente');
  const component1=current.articles.find(x=>x.kind==='component'||x.kind==='both');
  const component2=current.articles.find(x=>x.id!==component1?.id&&(x.kind==='component'||x.kind==='both'));
  const product=current.articles.find(x=>(x.kind==='product'||x.kind==='both')&&x.unit===machine.speedUnit);
  assert.ok(component1&&component2&&product,'Catalogo fixture incompleto');
  current=await mutate({kind:'article',id:component1.id,values:{...component1,descriptionEn:'Technical fabric'}});
  current=await mutate({kind:'article',id:product.id,values:{...product,descriptionEn:'Laminated fabric'}});
  assert.equal(current.articles.find(x=>x.id===component1.id).descriptionEn,'Technical fabric');
  const values={title:'Rivestimento sedile automotive · lotto TEST-01',typeId:current.types[0].id,machineId:'CNC-01',setupMinutes:10,runMinutes:30,quantity:100,calculationMode:'manual',notes:'Fixture UI touch',component1ArticleId:component1.id,component2ArticleId:component2.id,productArticleId:product.id};
  current=await mutate({kind:'task',values});taskId=current.tasks.find(x=>x.title===values.title)?.id;assert.ok(taskId,'Attività fixture non creata');
  await mutate({kind:'plan',id:taskId});
}
async function execution(){return (await state()).executions.find(x=>x.taskId===taskId);}
async function assertNoOverflow(p=page){assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`overflow ${await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)}px`);}
async function waitDialogClosed(){await page.locator('#operator-dialog').waitFor({state:'hidden'});}

try {
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',chunk=>{out+=chunk;const match=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>process.stderr.write(chunk));child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Server exit ${code}`));});});
  adminApi=await request.newContext({baseURL:base});await buildFixture();
  browser=await chromium.launch({headless:process.env.HEADFUL!=='1',channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1024,height:768}});page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));

  await test('autenticazione UI operatore e lingua persistente IT/EN',async()=>{
    await page.goto(base+'/operatore?machine=CNC-01');await page.locator('form').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'it');
    await page.getByRole('button',{name:'EN',exact:true}).click();assert.equal(await page.locator('html').getAttribute('lang'),'en');
    await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'en');
    await page.getByRole('button',{name:'IT',exact:true}).click();assert.equal(await page.locator('html').getAttribute('lang'),'it');
    await page.getByLabel(/Nome utente|Username/i).fill('operatore');await page.getByLabel(/Password/i).fill('PasswordTest123!');await page.getByRole('button',{name:/Accedi|Sign in/i}).click();
    await page.getByText('Rivestimento sedile automotive · lotto TEST-01',{exact:true}).waitFor();assert.match(page.url(),/\/operatore/);await screenshot('login-tablet-landscape');
    await page.getByRole('button',{name:'EN',exact:true}).click();await page.locator('.component').getByText('Technical fabric',{exact:true}).waitFor();await page.locator('.work-details summary').click();await page.locator('.work-details').getByText('Laminated fabric',{exact:true}).waitFor();await page.locator('.work-details summary').click();
    await page.reload();await page.locator('.component').getByText('Technical fabric',{exact:true}).waitFor();await screenshot('english-operational-descriptions');
    await page.getByRole('button',{name:'IT',exact:true}).click();assert.equal(await page.locator('.component').getByText('Technical fabric',{exact:true}).count(),0);
  });

  await test('layout touch responsive e pulsante principale',async()=>{
    await page.locator('.operator-brand img').evaluate(image=>image.decode());assert.ok(await page.locator('.operator-brand img').isVisible(),'Logo non visibile');
    for(const [width,height,name] of [[1024,768,'tablet-landscape'],[768,1024,'tablet-portrait'],[390,844,'mobile']]){
      await page.setViewportSize({width,height});await assertNoOverflow();const button=page.locator('.primary-action:visible');assert.equal(await button.count(),1);const box=await button.boundingBox();assert.ok(box&&box.height>=90,`Pulsante principale ${box?.height}px a ${width}x${height}`);await screenshot(name);
    }
    await page.setViewportSize({width:1024,height:768});
    assert.equal(await page.locator('#live-timer').count(),0,'Timer mostrato prima dell’avvio');
    const work=await page.locator('.current').boundingBox(),dock=await page.locator('.action-dock').boundingBox();assert.ok(work.y+work.height<=dock.y,'Scheda corrente coperta dai comandi tablet');
    await page.locator('.work-details summary').click();await page.locator('#refresh').click();await page.locator('.work-details[open]').waitFor();await page.locator('.work-details summary').click();
    await page.locator('.queue summary').click();assert.ok(await page.locator('.queue details[open]').isVisible());await page.locator('.queue summary').click();
  });

  // I selettori di flusso sono intenzionalmente semantici: verificano la UI usata dall'operatore.
  await test('ciclo setup/run: doppio tap, pausa, stop e ripresa esplicita',async()=>{
    const waitPhase=async phase=>{await page.waitForFunction(async ({id,phase})=>{const s=await (await fetch('/api/state')).json();return s.executions.some(e=>e.taskId===id&&e.phase===phase);},{id:taskId,phase});assert.equal(await page.locator('#operator-dialog').evaluate(d=>d.open),false);};
    const primary=page.locator('.primary-action');await primary.dblclick();await waitPhase('setup_running');
    let current=await state();const firstExecution=current.executions.find(x=>x.taskId===taskId);assert.ok(firstExecution);assert.equal(current.executions.filter(x=>x.taskId===taskId).length,1,'Il doppio tap ha duplicato l’esecuzione');assert.equal(firstExecution.events.filter(x=>x.action==='start_setup').length,1,'Il doppio tap ha duplicato l’evento');
    await page.locator('.primary-action').click();await waitPhase('setup_done');
    await page.locator('.primary-action').click();await waitPhase('run_running');
    await page.locator('#live-timer').waitFor();const runningCard=await page.locator('.current').boundingBox(),runningDock=await page.locator('.action-dock').boundingBox();assert.ok(runningCard.y+runningCard.height<=runningDock.y,'Lavorazione in corso coperta dal footer');await screenshot('running-tablet');
    await page.locator('[data-action="pause_run"]').click();await page.getByLabel(/Motivo|Reason/i).fill('Fine turno');await page.locator('#action-form [type="submit"]').click();await waitDialogClosed();
    current=await state();const stopReason=current.machineStopReasons.find(x=>x.active);assert.ok(stopReason,'Nessuna causale fermo attiva');await apiPost(adminApi,'/api/machine-stop',{revision:current.revision,machineId:'CNC-01',action:'stop',reasonId:stopReason.id});await page.getByRole('button',{name:/Aggiorna|Refresh/i}).click();
    await page.locator('.machine-hero.stopped').waitFor();assert.equal(await page.locator('[data-action="resume_run"]').count(),0,'Ripresa esposta durante fermo');assert.equal((await execution()).phase,'run_paused');
    await page.locator('[data-stop="resume"]').click();await page.waitForFunction(async()=>!(await (await fetch('/api/state')).json()).machineStops.some(s=>!s.endedAt));assert.equal(await page.locator('#operator-dialog').evaluate(d=>d.open),false);
    assert.equal((await execution()).phase,'run_paused','La riattivazione ha ripreso automaticamente la lavorazione');assert.match(await page.locator('[data-action="resume_run"]').textContent(),/Riprendi|Resume/i);
    await page.locator('.primary-action').click();await waitPhase('run_running');
  });

  await test('wizard completamento: bozze annullate e validazioni atomiche',async()=>{
    const before=await state();await page.locator('.primary-action').click();assert.equal(await page.locator('[name="producedQuantity"]').inputValue(),'100');assert.equal(await page.locator('[name="scrapQuantity"]').inputValue(),'0');assert.equal(await page.locator('[data-zero-notes]').isVisible(),false);assert.equal(await page.locator('[data-scrap-notes]').isVisible(),false);await page.locator('[name="scrapQuantity"]').fill('1');assert.equal(await page.locator('[data-scrap-notes]').isVisible(),true);await page.locator('[name="scrapQuantity"]').fill('0');await page.locator('[name="producedQuantity"]').fill('0');assert.equal(await page.locator('[data-zero-notes]').isVisible(),true);await page.locator('[name="producedQuantity"]').fill('-1');await page.locator('#wizard-next').click();assert.ok(await page.locator('#operator-dialog').isVisible());
    await page.getByRole('button',{name:/Annulla|Cancel/i}).click();await waitDialogClosed();let after=await state();const oldExecution=before.executions.find(x=>x.taskId===taskId),newExecution=after.executions.find(x=>x.taskId===taskId);assert.equal(after.revision,before.revision);assert.equal(newExecution.phase,oldExecution.phase);assert.equal(newExecution.events.length,oldExecution.events.length);assert.deepEqual(newExecution.lots,oldExecution.lots);
    await page.locator('.primary-action').click();await page.locator('[name="producedQuantity"]').fill('95');await page.locator('[name="scrapQuantity"]').fill('-1');await page.locator('#wizard-next').click();assert.ok(await page.locator('.dialog-error:not([hidden])').isVisible(),'Scarto negativo accettato');await page.locator('[name="scrapQuantity"]').fill('2');await page.locator('#wizard-next').click();assert.ok(await page.locator('.dialog-error:not([hidden])').isVisible(),'Scarto positivo senza causale accettato');selectedScrapReason=(await state()).scrapReasons.find(x=>x.active);assert.ok(selectedScrapReason,'Nessuna causale scarto attiva');await page.locator('[name="scrapReasonId"]').selectOption(selectedScrapReason.id);await page.locator('#wizard-next').click();
    await page.locator('#wizard-next').click();assert.ok(await page.locator('#operator-dialog').isVisible(),'Lotti mancanti accettati');assert.ok(await page.locator('.dialog-error:not([hidden])').isVisible());
  });

  await test('wizard completamento: quantità, lotti, qualità e riepilogo',async()=>{
    if(!await page.locator('#operator-dialog').isVisible().catch(()=>false)){await page.locator('.primary-action').click();await page.locator('[name="producedQuantity"]').fill('95');await page.locator('#wizard-next').click();}
    const dialog=page.locator('#operator-dialog');const groups=dialog.locator('.lot-group');assert.equal(await groups.count(),2);
    assert.equal(await groups.nth(1).isVisible(),false);
    for(let i=0;i<2;i++){await dialog.locator('[data-component-tab="'+i+'"]').click();await groups.nth(i).locator('input[name*="lot"]').first().fill(`LOT-${i+1}`);await groups.nth(i).locator('input[name*="quantity"]').first().fill(i?'100':'95');}
    await dialog.locator('[data-component-tab="0"]').click();assert.equal(await groups.nth(0).locator('input[name*="lot"]').first().inputValue(),'LOT-1');
    const first=groups.nth(0);await first.locator('input[name$="-barcode"]').fill('WRONG|LOT-1|95');await first.locator('input[name$="-barcode"]').press('Enter');assert.ok(await first.locator('.scan-feedback.error').isVisible());await page.locator('#wizard-next').click();assert.equal(await groups.nth(0).isVisible(),true);
    const code=await first.getAttribute('data-code');await first.locator('input[name$="-barcode"]').fill(code+'|LOT-1|95');await first.locator('input[name$="-barcode"]').press('Enter');assert.equal(await first.locator('input[name$="-quantity"]').inputValue(),'95');
    await screenshot('lots-tablet-one-component');
    const fields=await groups.nth(0).locator('input').all();const footer=await dialog.locator('.dialog-footer').boundingBox();for(const field of fields){const box=await field.boundingBox();assert.ok(box.y+box.height<=footer.y,'Campo lotti coperto dal footer');}
    for(const [width,height] of [[768,1024],[390,844]]){await page.setViewportSize({width,height});await assertNoOverflow();const box=await dialog.locator('.dialog-footer').boundingBox();assert.ok(box.y+box.height<=height,'Footer fuori schermo');for(const tab of await dialog.locator('[data-component-tab]').all())assert.ok((await tab.boundingBox()).height>=64);assert.equal(await first.locator('input[name$="-lot"]').inputValue(),'LOT-1');await screenshot('lots-'+width);}
    await page.setViewportSize({width:1024,height:768});
    await page.locator('#wizard-next').click();assert.equal(await groups.nth(1).isVisible(),true);assert.equal(await groups.nth(1).locator('input[name*="lot"]').first().inputValue(),'LOT-2');
    await page.locator('#wizard-back').click();assert.equal(await groups.nth(0).isVisible(),true);await page.locator('#wizard-next').click();
    await page.locator('#wizard-next').click();
    await dialog.locator('.tri-state').nth(0).getByText(/Regolare|Pass/i,{exact:true}).click();await dialog.locator('.tri-state').nth(1).getByText(/Regolare|Pass/i,{exact:true}).click();await dialog.locator('[name="qualityStatus"]').selectOption('conforming');
    assert.equal(await dialog.locator('[data-track]').count(),3);await dialog.locator('.finish-preview summary').click();assert.match(await dialog.locator('.summary').textContent(),/95/);assert.match(await dialog.locator('.summary').textContent(),/LOT-1/);assert.match(await dialog.locator('.summary').textContent(),new RegExp(selectedScrapReason.code));assert.match(await dialog.locator('.summary').textContent(),new RegExp(selectedScrapReason.description));const footerBox=await dialog.locator('.dialog-footer').boundingBox();assert.ok(footerBox.y>=0&&footerBox.y+footerBox.height<=page.viewportSize().height,'Comandi del dialogo fuori dallo schermo');await screenshot('completion-summary');
    assert.equal(await dialog.locator('.explicit-check').count(),0);await page.getByRole('button',{name:/^Completa attività$|^Complete activity$/i}).click();await waitDialogClosed();await page.getByText(/Nessuna attività pronta|No activity ready/i).waitFor();
    const current=await state(),task=current.tasks.find(x=>x.id===taskId),done=current.executions.find(x=>x.taskId===taskId);assert.equal(task.status,'completed');assert.equal(done.phase,'completed');assert.equal(done.producedQuantity,95);assert.equal(done.scrapQuantity,2);assert.equal(done.scrapReasonId,selectedScrapReason.id);assert.equal(done.scrapReasonCode,selectedScrapReason.code);assert.equal(done.scrapReason,selectedScrapReason.description);assert.equal(done.lots.length,2);assert.equal(done.qualityStatus,'conforming');await screenshot('completed-summary');
  });

  await test('nessun errore JavaScript',async()=>assert.deepEqual(errors,[]));
  await context.close();
} catch(error){results.push({name:'bootstrap',status:'failed',error:error.stack||String(error)});console.error(error);} finally {
  report.finishedAt=stamp();report.summary={passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,total:results.length};
  writeFileSync(path.join(artifacts,'operator-report.json'),JSON.stringify(report,null,2));
  await adminApi?.dispose();await browser?.close();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(temp,{recursive:true,force:true});
}
if(report.summary.failed)process.exitCode=1;else console.log(`Operator suite: ${report.summary.passed}/${report.summary.total} passed`);
