import {TEST_NOW} from './test-clock.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync} from 'node:crypto';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-planning-drag-'));
const copySource=process.env.PLANNING_COPY_SOURCE;
if(copySource){
 const source=new DatabaseSync(path.resolve(copySource),{readOnly:true});
 try{source.exec(`VACUUM INTO '${path.join(temp,'aloven.sqlite').replaceAll("'","''")}'`);}finally{source.close();}
 const copy=new DatabaseSync(path.join(temp,'aloven.sqlite')),salt=randomBytes(16).toString('hex'),password=`${salt}:${scryptSync('DragCheck123!',salt,64).toString('hex')}`;
 try{copy.prepare('INSERT INTO users(id,name,username,password,role) VALUES (?,?,?,?,?)').run('copy-drag-review','Verifica copia','copy-drag-review',password,'admin');}finally{copy.close();}
}
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,DATA_DIR:temp,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;const report={startedAt:new Date().toISOString(),source:copySource?'copia del database operativo':'database temporaneo',cases:[]};
try{
 const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',b=>{out+=b;const url=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(url){clearTimeout(timer);resolve(url[0]);}});});
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[],planResponses=[];page.on('response',async r=>{if(r.url().endsWith('/api/preview')){const action=r.request().postDataJSON()?.action;if(action?.kind==='plan')planResponses.push({action,status:r.status(),body:r.status()===200?undefined:await r.text()});}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('aloven-planning-layout','overview'));
 await page.goto(base);if(!copySource)await page.getByLabel('Nome e cognome').fill('Test trascinamento');await page.getByLabel('Nome utente',{exact:true}).fill(copySource?'copy-drag-review':'drag');await page.getByLabel('Password',{exact:true}).fill('DragCheck123!');await page.getByRole('button',{name:copySource?'Accedi':'Crea amministratore'}).click();await page.locator('.timeline-scroll').waitFor();
 const state=async()=>await(await page.request.get(base+'/api/state')).json();
 const action=async action=>{const s=await state(),r=await page.request.post(base+'/api/preview',{data:{revision:s.revision,action},headers:{'X-Aloven-Request':'1'}});assert.equal(r.status(),200,await r.text());const p=await r.json(),commit=await page.request.post(base+'/api/commit',{data:{token:p.token},headers:{'X-Aloven-Request':'1'}});assert.equal(commit.status(),200,await commit.text());};
 let s=await state(),m=s.machines[0],other=s.machines[1],tasks=s.tasks.filter(t=>t.machineId===m.id&&t.status==='unplanned').slice(0,4);
 if(copySource){
  const create=async(kind,values)=>{const collection=kind==='machine'?'machines':'tasks',ids=new Set((await state())[collection].map(x=>x.id));await action({kind,values});return (await state())[collection].find(x=>!ids.has(x.id));};
  m=await create('machine',{name:'QA-01 · Verifica copia',description:'Prova isolata',anchor:'2026-09-14T08:00',speed:10,speedUnit:'m'});
  other=await create('machine',{name:'QA-02 · Verifica copia',description:'Prova isolata',anchor:'2026-09-14T08:00',speed:10,speedUnit:'m'});
  const template=s.tasks.find(t=>t.status==='unplanned');assert.ok(template);
  tasks=[];for(let i=0;i<5;i++)tasks.push(await create('task',{...template,machineId:m.id,compatibleMachineIds:[m.id,other.id],preferredMachineId:null,title:`Prova copia ${i}`,setupMinutes:0,runMinutes:60,calculationMode:'manual'}));
  s=await state();await page.reload();await page.locator('#machine-filter').selectOption(m.id);
 }
 assert.ok(tasks.length>=4);
 await action({kind:'machine',id:m.id,values:{...m,anchor:'2026-09-14T08:00'}});await action({kind:'machine',id:other.id,values:{...other,anchor:'2026-09-14T08:00'}});
 for(const t of tasks)await action({kind:'task',id:t.id,values:{...t,setupMinutes:0,runMinutes:60,calculationMode:'manual',compatibleMachineIds:[m.id,other.id]}});
 await action({kind:'plan',id:tasks[0].id,machineId:m.id,fixedStart:'2026-10-12T08:00'});await action({kind:'plan',id:tasks[1].id,machineId:m.id,fixedStart:'2026-10-12T11:00'});
 await page.reload();await page.locator('#date-start').fill('2026-10-12');await page.locator('#date-start').dispatchEvent('change');
 const card=page.locator(`.backlog .task-card[data-task="${tasks[2].id}"]`),target=page.locator(`[data-drop-machine="${m.id}"]`).first();
 const point=async(cell,time)=>cell.evaluate((el,time)=>({x:(time-Number(el.dataset.lo))*Number(el.dataset.scale),y:40}),time);
 assert.equal(await card.locator('.task-machine-chip').count(),2);
 const chipColors=await card.locator('.task-machine-chip').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).getPropertyValue('--machine-color').trim()));assert.equal(new Set(chipColors).size,2);
 await page.evaluate(id=>{document.addEventListener('drop',()=>{window.dropTiming={start:performance.now()};const observer=new MutationObserver(()=>{if(document.querySelector(`.time-block[data-task="${id}"]`)){window.dropTiming.elapsed=performance.now()-window.dropTiming.start;observer.disconnect();}});observer.observe(document.querySelector('#app'),{childList:true,subtree:true});},{capture:true,once:true});},tasks[2].id);
 await card.dragTo(target,{targetPosition:await point(target,9*60)});
 await card.waitFor({state:'detached'});const dropTiming=await page.evaluate(()=>window.dropTiming);assert.ok(Number.isFinite(dropTiming.elapsed));console.log('Drop → barra (ms):',Math.round(dropTiming.elapsed));assert.equal(await page.locator('#modal').isVisible(),false);
 let current=await state(),queue=current.tasks.filter(t=>t.machineId===m.id&&t.position!==null).sort((a,b)=>a.position-b.position);
 assert.deepEqual(queue.map(t=>t.id),[tasks[0].id,tasks[2].id,tasks[1].id]);assert.equal(current.planning.hasDraftChanges,true);assert.equal(current.planning.version,s.planning.version);
 assert.equal(queue[1].start,'2026-10-12T09:00');assert.equal(queue[2].start,'2026-10-12T11:00');assert.equal(queue[1].fixedStart,null,'il rilascio sceglie la posizione, non fissa un orario');
  // Il rilascio sceglie la posizione nella sequenza: nessun orario fisso, le date escono dalla compattazione.
 if(copySource)await page.locator('#machine-filter').selectOption('');
 const empty=page.locator(`[data-drop-machine="${other.id}"]`).first(),moving=page.locator(`.time-block.run[data-task="${tasks[2].id}"]`).first();
 await empty.scrollIntoViewIfNeeded();await moving.scrollIntoViewIfNeeded();
 const movingBox=await moving.boundingBox(),emptyBox=await empty.boundingBox(),dropPoint=await point(empty,10*60+15);
 await page.mouse.move(movingBox.x+5,movingBox.y+5);await page.mouse.down();await page.mouse.move(movingBox.x+15,movingBox.y+15,{steps:3});await page.mouse.move(emptyBox.x+dropPoint.x,emptyBox.y+dropPoint.y,{steps:12});await page.mouse.up();
 for(let attempt=0;attempt<40&&(await state()).tasks.find(t=>t.id===tasks[2].id).machineId!==other.id;attempt++)await page.waitForTimeout(200);
 await page.screenshot({path:'.artifacts/planning-drag-after-move.png',fullPage:false}).catch(()=>{});
 let moved=(await state()).tasks.find(t=>t.id===tasks[2].id);
 await page.locator('#date-start').fill(moved.start.slice(0,10));await page.locator('#date-start').dispatchEvent('change');await page.locator(`.time-block.run[data-task="${tasks[2].id}"][data-machine="${other.id}"]`).first().waitFor();
 assert.equal(moved.machineId,other.id);assert.equal(await page.locator('#modal').isVisible(),false);
 assert.equal(moved.fixedStart,null,'su una macchina vuota l’attività entra in sequenza, non a un orario scelto');assert.ok(moved.start,'la sequenza assegna comunque le date');
 // Rilascio sulla metà sinistra di un'attività: entra prima, la sequenza si ricompatta e compare l'anteprima.
 const candidate=page.locator(`.backlog .task-card[data-task="${tasks[3].id}"]`),busy=page.locator(`.temporal-cell[data-drop-machine="${other.id}"]:has(.time-block[data-task="${tasks[2].id}"])`).first();
 await busy.scrollIntoViewIfNeeded();
 const cellBox=await busy.boundingBox(),blockBox=await busy.locator(`.time-block[data-task="${tasks[2].id}"]`).first().boundingBox();
 await candidate.dragTo(busy,{targetPosition:{x:blockBox.x-cellBox.x+4,y:40}});
 await page.getByRole('heading',{name:'La sequenza si ricompatta'}).waitFor();
 assert.equal((await state()).tasks.find(t=>t.id===tasks[3].id).position,null,'prima della conferma la bozza non cambia');
 await page.getByRole('button',{name:'Inserisci e ricompatta',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});
 current=await state();queue=current.tasks.filter(t=>t.machineId===other.id&&t.position!==null).sort((a,b)=>a.position-b.position);
 assert.deepEqual(queue.map(t=>t.id),[tasks[3].id,tasks[2].id]);assert.equal(queue[0].fixedStart,null);assert.ok(queue[1].start>=queue[0].end&&queue[1].start<=queue[0].end.slice(0,10)+'T23:59','la seconda attività segue la prima senza buchi inutili');
 // Il pannello offre solo posizioni in sequenza: nessuna data precisa.
 await page.locator(`.time-block.run[data-task="${tasks[2].id}"]`).first().click();await page.locator('.selection-placement-box summary').evaluate(summary=>{if(!summary.parentElement.open)summary.click();});
 assert.deepEqual(await page.getByLabel('Inserisci attività').locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),['end','before','after']);assert.equal(await page.getByLabel('Data e ora di inizio').count(),0);
 await page.reload();await page.locator('#date-start').fill('2026-10-12');await page.locator('#date-start').dispatchEvent('change');
 await page.getByRole('button',{name:'Settimana',exact:true}).click();
 mkdirSync('.artifacts',{recursive:true});
 for(const [width,height] of [[1366,768],[1920,1080],[390,844]]){
  await page.setViewportSize({width,height});
  const scroll=page.locator('.timeline-scroll');
  const bounds=await scroll.evaluate(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,width:el.clientWidth,full:el.scrollWidth,overflow:getComputedStyle(el).overflowX}));
  assert.ok(['auto','scroll'].includes(bounds.overflow));assert.ok(width>=1700||bounds.full>bounds.width);
  if(bounds.full>bounds.width){await scroll.focus();await page.keyboard.press('End');await scroll.evaluate(el=>el.scrollLeft=el.scrollWidth);
  assert.ok(await scroll.evaluate(el=>el.scrollLeft)>0);}
  if(width===1366){assert.ok(bounds.top<230,JSON.stringify(bounds));assert.ok(bounds.bottom<=height,JSON.stringify(bounds));}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`.artifacts/planning-${copySource?'copy-':''}drag-${width}.png`,fullPage:false});
 }
 await page.setViewportSize({width:1366,height:768});
 report.finishedAt=new Date().toISOString();report.cases=['inserimento in spazio libero senza spostare le altre attività','trascinamento con mouse su macchina vuota: entra in sequenza, senza orario fisso','rilascio prima di un’attività: anteprima, conferma e compattazione','pannello di posizionamento senza data precisa','scroll orizzontale e layout desktop/mobile'];report.javascriptErrors=errors;report.dropToVisibleMs=Math.round(dropTiming.elapsed);writeFileSync(`.artifacts/planning-deep-${copySource?'copy':'fixture'}-report.json`,JSON.stringify(report,null,2));
 assert.deepEqual(errors,[]);console.log('PASS: inserimento libero senza spostare le altre attività, rilascio per posizione in sequenza con anteprima e compattazione, nessuna data precisa, layout desktop/mobile');
}finally{await browser?.close();child.kill();if(child.exitCode===null)await once(child,'exit');assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'aloven-planning-drag-'));rmSync(temp,{recursive:true,force:true});}
