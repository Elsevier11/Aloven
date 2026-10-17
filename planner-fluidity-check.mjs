import {TEST_NOW} from './test-clock.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const playwrightPath=process.env.PLAYWRIGHT_PATH||'C:/Users/Paolo Pedron/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const temp=mkdtempSync(path.join(tmpdir(),'aloven-planner-fluidity-'));
const artifacts=path.resolve('.artifacts');
mkdirSync(artifacts,{recursive:true});
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,DATA_DIR:temp,PORT:'0'},stdio:['ignore','pipe','pipe']});
const report={startedAt:new Date().toISOString(),passed:[],failures:[],pageErrors:[],requests:[],layouts:[],visuals:[]};
let browser,page,base,caseName='bootstrap';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const flushReport=()=>writeFileSync(path.join(artifacts,'planner-fluidity-report.json'),JSON.stringify(report,null,2));
const capture=async name=>{const screenshot=path.join(artifacts,`planner-fluidity-${name}.png`);await page.screenshot({path:screenshot,fullPage:false});report.visuals.push({name,screenshot});};
const planningSnapshot=state=>Object.fromEntries(state.tasks.map(task=>[task.id,{machineId:task.machineId,status:task.status,position:task.position,start:task.start,end:task.end,fixedStart:task.fixedStart,segments:task.segments,effectiveSetupMinutes:task.effectiveSetupMinutes}]));
const recordFailure=async(name,error)=>{
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
  const screenshot=path.join(artifacts,`planner-fluidity-failure-${slug}.png`);
  await page?.screenshot({path:screenshot,fullPage:false}).catch(()=>{});
  report.failures.push({name,error:error.stack||String(error),screenshot,reproduction:`PLAYWRIGHT_PATH=${playwrightPath} node planner-fluidity-check.mjs`});
  flushReport();
};
const check=async(name,fn)=>{caseName=name;try{await fn();report.passed.push(name);flushReport();}catch(error){await recordFailure(name,error);}};

try{
  base=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Timeout avvio server')),15000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
    child.stderr.on('data',chunk=>process.stderr.write(chunk));child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Server terminato con codice ${code}`));});
  });
  browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  context.setDefaultTimeout(8000);
  await context.addInitScript(()=>{localStorage.setItem('aloven-plan-view','day');localStorage.setItem('aloven-plan-zoom','1');});
  page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
  page.on('request',request=>{if(/\/api\/(preview|commit|planning\/undo)(?:\?|$)/.test(request.url()))report.requests.push({method:request.method(),endpoint:new URL(request.url()).pathname,body:request.postDataJSON?.()});});
  await page.goto(base);await page.getByLabel('Nome e cognome').fill('Verifica fluidità');await page.getByLabel('Nome utente',{exact:true}).fill('fluidity-admin');await page.getByLabel('Password',{exact:true}).fill('FluidityCheck123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.locator('.timeline-scroll').waitFor();

  const state=async(p=page)=>await (await p.request.get(base+'/api/state')).json();
  const post=async(p,endpoint,data,expected=200)=>{const response=await p.request.post(base+'/api/'+endpoint,{data,headers:{'X-Aloven-Request':'1'}});assert.equal(response.status(),expected,await response.text());return response.json();};
  const action=async(value,p=page)=>{const current=await state(p),preview=await post(p,'preview',{revision:current.revision,action:value});await post(p,'commit',{token:preview.token});return state(p);};
  const cellFor=machineId=>page.locator(`[data-drop-machine="${machineId}"][data-date="2026-10-12"]`);
  const dragCoordinates=async(source,cell,minute)=>{const [sourceBox,cellBox,meta]=await Promise.all([source.boundingBox(),cell.boundingBox(),cell.evaluate(element=>({lo:Number(element.dataset.lo),scale:Number(element.dataset.scale)}))]);assert.ok(sourceBox&&cellBox,'Elemento di trascinamento non visibile');return {from:{x:sourceBox.x+Math.min(4,sourceBox.width/2),y:sourceBox.y+Math.min(18,sourceBox.height/2)},to:{x:cellBox.x+(minute-meta.lo)*meta.scale,y:cellBox.y+40}};};
  const holdDrag=async(source,cell,minute)=>{const point=await dragCoordinates(source,cell,minute);await page.mouse.move(point.from.x,point.from.y);await page.mouse.down();await page.mouse.move(point.from.x+8,point.from.y+2,{steps:3});await page.mouse.move(point.to.x,point.to.y,{steps:14});return point;};
  const finishDrag=async()=>page.mouse.up();

  const weekly={0:[],1:[['08:00','12:00'],['13:00','17:00']],2:[['08:00','12:00'],['13:00','17:00']],3:[['08:00','12:00'],['13:00','17:00']],4:[['08:00','12:00'],['13:00','17:00']],5:[['08:00','12:00'],['13:00','17:00']],6:[]};
  let fixture=await action({kind:'calendar',values:{weekly,exceptions:{},machineExceptions:{},maintenanceBlocks:[]}});
  const machine=fixture.machines.find(item=>item.id==='CNC-01')||fixture.machines[0],other=fixture.machines.find(item=>item.id!==machine.id);assert.ok(machine&&other);
  for(const item of [machine,other]){const current=(await state()).machines.find(value=>value.id===item.id);await action({kind:'machine',id:item.id,values:{...current,anchor:'2026-10-12T08:00'}});}
  fixture=await state();const tasks=fixture.tasks.slice(0,4);assert.equal(tasks.length,4);
  for(let index=0;index<tasks.length;index++){
    const current=(await state()).tasks.find(item=>item.id===tasks[index].id);
    await action({kind:'task',id:current.id,values:{...current,title:`Fluidità ${index+1} · ${current.title}`,machineId:machine.id,compatibleMachineIds:[machine.id,other.id],preferredMachineId:machine.id,setupMinutes:0,runMinutes:index===3?60:60,calculationMode:'manual'}});
  }
  for(const task of tasks.slice(0,3))await action({kind:'plan',id:task.id,machineId:machine.id});
  await page.reload();await page.locator('.timeline-scroll').waitFor();await page.locator('#date-start').fill('2026-10-12');await page.locator('#date-start').dispatchEvent('change');
  const baseline=await state();assert.deepEqual(tasks.slice(0,3).map(item=>baseline.tasks.find(task=>task.id===item.id).start),['2026-10-12T08:00','2026-10-12T09:00','2026-10-12T10:00']);
  const baselinePlanning=planningSnapshot(baseline),cell=cellFor(machine.id),moverId=tasks[3].id;

  await check('Anteprima continua, scroll e resize senza commit durante il gesto',async()=>{
    await page.locator('#plan-zoom').evaluate(element=>{element.value='1.5';element.dispatchEvent(new Event('change'));});
    await page.route('**/api/preview',async route=>{await sleep(700);await route.continue();});
    const before=await state(),commits=report.requests.filter(request=>request.endpoint==='/api/commit').length;
    try{
      const source=page.locator(`.backlog .task-card[data-task="${moverId}"]`);const point=await holdDrag(source,cell,13*60);
      await page.locator('.insertion-hint').waitFor();assert.match(await page.locator('.insertion-hint').innerText(),/Verifica posizione/);
      const estimate=page.locator(`.drag-preview-footprint[data-preview-task="${moverId}"]`);
      await estimate.first().waitFor();
      await capture('immediate-estimate');
      await page.evaluate(()=>{window.testFootprint=document.querySelector('.drag-preview-footprint');});
      const meta=await cell.evaluate(element=>({scale:Number(element.dataset.scale)}));
      await page.mouse.move(point.to.x+30*meta.scale,point.to.y);
      assert.equal(await page.evaluate(()=>window.testFootprint===document.querySelector('.drag-preview-footprint')),true,'Riutilizza il nodo durante il movimento');
      await page.locator('.timeline-scroll').evaluate(element=>{element.scrollLeft+=30;});
      assert.ok(await page.locator('.drag-preview-footprint').count()>0,'L’anteprima resta dopo lo scroll');
      await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await page.locator('.insertion-hint').waitFor();
      await page.mouse.move(10,10);await finishDrag();await sleep(900);
      assert.equal(await page.locator('.drag-preview-footprint').count(),0,'Risposte tardive non ripristinano l’anteprima');
      assert.equal((await state()).revision,before.revision);assert.equal(report.requests.filter(request=>request.endpoint==='/api/commit').length,commits);
    }finally{await page.mouse.move(10,10);await finishDrag();await page.unroute('**/api/preview');await page.locator('#plan-zoom').evaluate(element=>{element.value='1';element.dispatchEvent(new Event('change'));});}
  });

  await check('Rilascio dentro la sequenza chiede conferma; Annulla non scrive',async()=>{
    const before=await state(),commitsBefore=report.requests.filter(request=>request.endpoint==='/api/commit').length,source=page.locator(`.backlog .task-card[data-task="${moverId}"]`);await holdDrag(source,cell,9*60+45);
    await page.locator('.drag-preview-footprint[data-validity="ready"]').first().waitFor();assert.equal(await page.locator('.insertion-hint.invalid').count(),0,'inserire nella sequenza non è un rifiuto');
    assert.match(await page.locator('.insertion-hint').innerText(),/^Prima di .+ · parte .+ · \d+ attività slitt(?:a|ano)$/,'l’etichetta dice dove entra, quando parte e quante attività slittano');
    assert.equal(await page.locator('[data-drag-mode]').count(),0,'l’interruttore di modalità non esiste più');
    await finishDrag();await page.getByRole('heading',{name:'La sequenza si ricompatta'}).waitFor();
    assert.match(await page.locator('#shift-notice').innerText(),/«Fluidità 4.*» entra prima di «Fluidità 3.*» su .* e cambiano le date di \d+ altr[ae] attivit/);const firstChange=page.locator('.change-list > div').first();assert.ok(await firstChange.evaluate(el=>el.classList.contains('change-moved')),'l’attività spostata è la prima');assert.match(await firstChange.innerText(),/Attività spostata/);assert.ok(await page.locator('.change-list').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'l’elenco non nasconde righe dietro uno scorrimento interno');assert.ok(await page.locator('.change-list').getByText('Fluidità',{exact:false}).count());
    assert.equal((await state()).revision,before.revision,'nessuna scrittura prima della scelta');
    await page.getByRole('button',{name:'Annulla',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});
    assert.equal((await state()).revision,before.revision);assert.equal(report.requests.filter(request=>request.endpoint==='/api/commit').length,commitsBefore);
  });


  await check('Errore di salvataggio lascia la bozza intatta e pulisce il gesto',async()=>{
    const before=await state(),commits=report.requests.filter(request=>request.endpoint==='/api/commit').length;
    await page.route('**/api/commit',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Errore di salvataggio simulato'})}),{times:1});
    const source=page.locator(`.backlog .task-card[data-task="${moverId}"]`);await holdDrag(source,cell,13*60);await page.locator('.drag-preview-footprint[data-validity="ready"]').first().waitFor();await finishDrag();
    await page.getByText('Errore di salvataggio simulato',{exact:true}).waitFor();
    assert.equal((await state()).revision,before.revision);assert.equal(await page.locator('.drag-preview-footprint').count(),0);assert.equal(await page.locator('#planning-save-status').isVisible(),false);assert.equal(report.requests.filter(request=>request.endpoint==='/api/commit').length,commits+1);
  });

  await check('Inserimento in coda: stato di salvataggio e annullamento esatto',async()=>{
    const commitBodies=[];const onRequest=request=>{if(new URL(request.url()).pathname==='/api/commit')commitBodies.push(request.postDataJSON());};page.on('request',onRequest);
    await page.route('**/api/commit',async route=>{await sleep(550);await route.continue();},{times:1});
    const source=page.locator(`.backlog .task-card[data-task="${moverId}"]`);await holdDrag(source,cell,13*60);await page.locator('.drag-preview-footprint[data-preview-task="'+moverId+'"]').first().waitFor();await finishDrag();
    await page.locator('#planning-save-status').waitFor({state:'visible'});assert.equal(await page.locator('.timeline-scroll').getAttribute('aria-busy'),'true');
    await page.waitForFunction(id=>document.querySelector(`.time-block[data-task="${id}"][data-start="2026-10-12T11:00"]`),moverId,{timeout:7000});page.off('request',onRequest);
    const moved=await state();assert.equal(moved.tasks.find(task=>task.id===moverId).fixedStart,null,'nessun orario fisso: la posizione decide la data');assert.ok(commitBodies.length===1);
    await page.locator('#planning-undo').click();await page.waitForFunction(revision=>Number(document.querySelector('.shell')?.dataset.revision)>revision,moved.revision);assert.deepEqual(planningSnapshot(await state()),baselinePlanning);
  });

  await check('Inserimento nella sequenza riusa l’anteprima finale, mostra le impronte e annulla tutte le modifiche',async()=>{
    const traffic={preview:[],commit:[]};const onResponse=async response=>{const endpoint=new URL(response.url()).pathname;if(endpoint==='/api/preview'&&response.request().method()==='POST')traffic.preview.push({action:response.request().postDataJSON()?.action,result:await response.json().catch(()=>null)});};const onRequest=request=>{const endpoint=new URL(request.url()).pathname;if(endpoint==='/api/commit')traffic.commit.push(request.postDataJSON());};page.on('response',onResponse);page.on('request',onRequest);
    const source=page.locator(`.backlog .task-card[data-task="${moverId}"]`);await holdDrag(source,cell,9*60+45);await page.locator(`.drag-preview-footprint[data-preview-task="${moverId}"][data-validity="ready"]`).waitFor();assert.ok(await page.locator('.drag-preview-footprint').count()>=2);await capture('cascade-preview');
    const beforeDrop=await state();await finishDrag();await page.getByRole('heading',{name:'La sequenza si ricompatta'}).waitFor();assert.equal((await state()).revision,beforeDrop.revision);assert.ok(await page.locator('.change-list').getByText('Fluidità 3',{exact:false}).count());
    await page.getByRole('button',{name:'Inserisci e ricompatta',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});page.off('response',onResponse);page.off('request',onRequest);
    const cascaded=await state(),after=planningSnapshot(cascaded);assert.deepEqual(after[tasks[0].id],baselinePlanning[tasks[0].id]);assert.equal(after[moverId].fixedStart,null);assert.equal(after[moverId].start,'2026-10-12T10:00');assert.deepEqual(after[tasks[1].id],baselinePlanning[tasks[1].id]);assert.notEqual(after[tasks[2].id].start,baselinePlanning[tasks[2].id].start);
    await page.locator('#planning-undo').click();await page.waitForFunction(revision=>Number(document.querySelector('.shell')?.dataset.revision)>revision,cascaded.revision);assert.deepEqual(planningSnapshot(await state()),baselinePlanning);
    const finalPreviews=traffic.preview.filter(item=>item.action?.id===moverId&&item.action?.beforeId===tasks[2].id);assert.equal(finalPreviews.length,1,'Il drop non deve ripetere l’anteprima della posizione finale');assert.equal(traffic.commit.length,1);assert.equal(traffic.commit[0].token,finalPreviews[0].result.token);
  });

  await check('Vecchio inizio fissato: visibile, rimovibile, annullamento obsoleto disabilitato',async()=>{
    await action({kind:'plan',id:tasks[0].id,machineId:machine.id,fixedStart:'2026-10-12T13:00',shiftFollowing:true});
    await page.reload();await page.locator('.timeline-scroll').waitFor();await page.locator('#date-start').fill('2026-10-12');await page.locator('#date-start').dispatchEvent('change');await page.locator(`.time-block.fixed-start[data-task="${tasks[0].id}"]`).first().waitFor();
    await page.locator(`.time-block.run[data-task="${tasks[0].id}"]`).click();await page.locator('#selection-unpin').waitFor();let unpinAction;const capture=request=>{if(new URL(request.url()).pathname==='/api/preview')unpinAction=request.postDataJSON()?.action;};page.on('request',capture);await page.locator('#selection-unpin').click();await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();page.off('request',capture);assert.equal(unpinAction.id,tasks[0].id);assert.ok(!Object.hasOwn(unpinAction,'fixedStart'));await page.getByRole('button',{name:'Annulla',exact:true}).click();
    const current=(await state()).machines.find(item=>item.id===other.id);await action({kind:'machine',id:other.id,values:{...current,description:current.description+' · refresh test'}});await page.reload();await page.locator('.timeline-scroll').waitFor();assert.equal(await page.locator('#planning-undo').isDisabled(),true);
  });

  await check('Pannello tastiera consente una risorsa compatibile diversa',async()=>{
    await page.locator('#date-start').fill('2026-10-12');await page.locator('#date-start').dispatchEvent('change');const block=page.locator(`.time-block.run[data-task="${tasks[0].id}"]`);await block.focus();await block.press('Enter');await page.locator('.selection-placement-box summary').evaluate(summary=>{if(!summary.parentElement.open)summary.click();});await page.locator('#selection-placement').waitFor();const destination=page.getByLabel('Macchina di destinazione');await destination.focus();await destination.press('End');assert.equal(await destination.inputValue(),other.id);
    await page.getByLabel('Inserisci attività').selectOption('end');await capture('keyboard-destination-panel');let previewAction;const captureRequest=request=>{if(new URL(request.url()).pathname==='/api/preview')previewAction=request.postDataJSON()?.action;};page.on('request',captureRequest);await page.locator('#selection-placement [type="submit"]').press('Enter');await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();page.off('request',captureRequest);assert.equal(previewAction.machineId,other.id);await page.getByRole('button',{name:'Annulla',exact:true}).click();
  });

  await check('Riordino reale e freccia mantengono aperta la sequenza',async()=>{
    const row=page.locator(`.gantt-row[data-resource="${machine.id}"]`);await row.locator('.machine-actions').evaluate(element=>element.open=true);await page.locator(`[data-sequence="${machine.id}"]`).click();await page.getByRole('heading',{name:'Sequenza macchina'}).waitFor();
    const source=page.locator(`.production-sequence-row[data-task="${tasks[2].id}"]`),target=page.locator(`.production-sequence-row[data-task="${tasks[1].id}"]`);await source.dragTo(target);await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();await page.getByRole('button',{name:'Conferma e salva',exact:true}).click();await page.getByRole('heading',{name:'Sequenza macchina'}).waitFor();assert.equal(await page.locator('#modal').isVisible(),true);await capture('sequence-after-reorder');
    const arrow=page.locator(`[data-move-task="${tasks[2].id}"][data-direction="down"]`);assert.equal(await arrow.isEnabled(),true);await arrow.click();await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();await page.getByRole('button',{name:'Conferma e salva',exact:true}).click();await page.getByRole('heading',{name:'Sequenza macchina'}).waitFor();assert.equal(await page.locator('#modal').isVisible(),true);await page.getByRole('button',{name:'Chiudi',exact:true}).click();
  });

  await check('Touch fra macchine, pointercancel e pressione senza spostamento',async()=>{
    const touchContext=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});touchContext.setDefaultTimeout(8000);await touchContext.addInitScript(()=>{localStorage.setItem('aloven-plan-view','day');});const touch=await touchContext.newPage();touch.on('pageerror',error=>report.pageErrors.push(error.message));
    await touch.goto(base);await touch.getByLabel('Nome utente',{exact:true}).fill('fluidity-admin');await touch.getByLabel('Password',{exact:true}).fill('FluidityCheck123!');await touch.getByRole('button',{name:'Accedi',exact:true}).click();await touch.locator('.timeline-scroll').waitFor();await touch.locator('#date-start').fill('2026-10-12');await touch.locator('#date-start').dispatchEvent('change');
    const before=await state(touch),id=tasks[1].id,source=touch.locator(`.time-block.run[data-task="${id}"]`),touchCell=touch.locator(`[data-drop-machine="${other.id}"][data-date="2026-10-12"]`);const [sourceBox,cellBox,meta]=await Promise.all([source.boundingBox(),touchCell.boundingBox(),touchCell.evaluate(element=>({lo:Number(element.dataset.lo),scale:Number(element.dataset.scale)}))]);assert.ok(sourceBox&&cellBox);const start={x:sourceBox.x+4,y:sourceBox.y+18},end={x:cellBox.x+(15*60-meta.lo)*meta.scale,y:cellBox.y+40},cdp=await touchContext.newCDPSession(touch);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x,y:start.y,id:7}]});await sleep(320);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal((await state(touch)).revision,before.revision,'Una pressione senza spostamento non salva');assert.equal(await touch.locator('.drag-preview-footprint').count(),0);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x,y:start.y,id:8}]});await sleep(320);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:end.x,y:end.y,id:8}]});await touch.locator('.drag-preview-footprint').first().waitFor();await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await touch.locator('.drag-preview-footprint').count(),0);assert.equal(await touch.locator('.drop-hover').count(),0);assert.equal((await state(touch)).revision,before.revision);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x,y:start.y,id:9,radiusX:2,radiusY:2,force:1}]});await sleep(320);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:end.x,y:end.y,id:9,radiusX:2,radiusY:2,force:1}]});await touch.locator('.drag-preview-footprint').first().waitFor();assert.equal(await touch.locator('.touch-drag-ghost').isVisible(),false);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.getByRole('heading',{name:'La sequenza si ricompatta'}).waitFor();await touch.getByRole('button',{name:'Inserisci e ricompatta',exact:true}).click();await touch.waitForFunction(({id,revision})=>Number(document.querySelector('.shell')?.dataset.revision)>revision&&document.querySelector(`.time-block[data-task="${id}"]`),{id,revision:before.revision},{timeout:7000});const moved=(await state(touch)).tasks.find(task=>task.id===id);assert.equal(moved.fixedStart,null);assert.equal(moved.start,'2026-10-12T08:00','su una macchina vuota la sequenza parte dal primo spazio libero');assert.equal(moved.machineId,other.id);await touchContext.close();
  });

  await check('Layout desktop e mobile senza overflow ed errori pagina',async()=>{
    await page.reload();await page.locator('.timeline-scroll').waitFor();for(const [width,height] of [[1366,768],[1920,1080],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow a ${width}x${height}`);const screenshot=path.join(artifacts,`planner-fluidity-${width}x${height}.png`);await page.screenshot({path:screenshot,fullPage:false});report.layouts.push({width,height,screenshot});}assert.deepEqual(report.pageErrors,[]);
  });
}catch(error){await recordFailure(caseName,error);}
finally{
  report.finishedAt=new Date().toISOString();writeFileSync(path.join(artifacts,'planner-fluidity-report.json'),JSON.stringify(report,null,2));await browser?.close();child.kill();if(child.exitCode===null)await once(child,'exit');assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'aloven-planner-fluidity-'));rmSync(temp,{recursive:true,force:true});
}
if(report.failures.length){console.error(`FAIL planner fluidity: ${report.failures.length} casi; report ${path.join(artifacts,'planner-fluidity-report.json')}`);process.exitCode=1;}else console.log(`PASS planner fluidity: ${report.passed.length} scenari`);
