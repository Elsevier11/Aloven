import {TEST_NOW} from './test-clock.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';

const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-maintenance-'));
const artifacts=path.resolve('.artifacts');
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
let browser,page;
const passed=[],pageErrors=[],geometries=[];

try{
  const base=await new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
    child.stderr.on('data',chunk=>process.stderr.write(chunk));
    child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Server exit ${code}`));});
  });

  browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  await context.addInitScript(()=>{localStorage.setItem('aloven-plan-view','day');localStorage.setItem('aloven-plan-zoom','1');});
  page=await context.newPage();
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(base);
  await page.getByLabel('Nome e cognome').fill('Verifica manutenzione');
  await page.getByLabel('Nome utente',{exact:true}).fill('maintenance-admin');
  await page.getByLabel('Password',{exact:true}).fill('MaintenanceCheck123!');
  await page.getByRole('button',{name:'Crea amministratore'}).click();
  await page.locator('.timeline-scroll').waitFor();

  const state=async(scope='')=>await (await page.request.get(base+'/api/state'+scope)).json();
  const post=async(endpoint,data)=>{
    const response=await page.request.post(base+endpoint,{data,headers:{'X-Aloven-Request':'1'}});
    assert.equal(response.status(),200,await response.text());
    return response.json();
  };
  const action=async value=>{
    const current=await state();
    const preview=await post('/api/preview',{revision:current.revision,action:value});
    await post('/api/commit',{token:preview.token});
    return state();
  };
  const taskSnapshot=(snapshot,id)=>{
    const task=snapshot.tasks.find(item=>item.id===id);
    assert.ok(task,`Attività ${id} assente`);
    return {start:task.start,end:task.end,segments:task.segments};
  };
  const openMaintenance=async machineId=>{
    const row=page.locator(`.gantt-row[data-resource="${machineId}"]`);
    await row.locator('.machine-actions summary').click();
    await row.locator(`[data-maintenance="${machineId}"]`).click();
    await page.getByRole('heading',{name:'Inserisci manutenzione / indisponibilità'}).waitFor();
  };
  const fillMaintenance=async(name,start,end)=>{
    await page.getByLabel('Descrizione').fill(name);
    await page.getByLabel('Inizio indisponibilità').fill(start);
    await page.getByLabel('Fine indisponibilità').fill(end);
  };
  const previewMaintenance=async()=>{
    await page.getByRole('button',{name:'Mostra anteprima',exact:true}).click();
    await page.getByRole('heading',{name:'Conferma indisponibilità'}).waitFor();
  };
  const confirmMaintenance=async()=>{
    await page.getByRole('button',{name:'Conferma e salva',exact:true}).click();
    await page.locator('#modal').waitFor({state:'hidden'});
  };

  const weekly={0:[],1:[['08:00','12:00'],['13:00','17:00']],2:[['08:00','12:00'],['13:00','17:00']],3:[['08:00','12:00'],['13:00','17:00']],4:[['08:00','12:00'],['13:00','17:00']],5:[['08:00','12:00'],['13:00','17:00']],6:[]};
  let fixture=await state();
  const machine=fixture.machines.find(item=>item.id==='CNC-01')||fixture.machines[0];
  const otherMachine=fixture.machines.find(item=>item.id!==machine.id);
  assert.ok(machine&&otherMachine,'Servono almeno due macchine');
  const tasks=fixture.tasks.filter(item=>item.machineId===machine.id&&item.status==='unplanned').slice(0,3);
  const otherTask=fixture.tasks.find(item=>item.machineId===otherMachine.id&&item.status==='unplanned');
  assert.equal(tasks.length,3,'Servono tre attività non pianificate sulla macchina test');
  assert.ok(otherTask,'Serve un’attività non pianificata su una seconda macchina');

  await action({kind:'calendar',values:{weekly,exceptions:{},machineExceptions:{},maintenanceBlocks:[]}});
  fixture=await state();
  for(const item of [machine,otherMachine]){
    const current=fixture.machines.find(value=>value.id===item.id);
    fixture=await action({kind:'machine',id:item.id,values:{...current,anchor:'2026-10-12T08:00'}});
  }
  for(const original of [...tasks,otherTask]){
    const current=fixture.tasks.find(item=>item.id===original.id);
    fixture=await action({kind:'task',id:original.id,values:{...current,setupMinutes:0,runMinutes:60,calculationMode:'manual'}});
  }
  for(const item of tasks)fixture=await action({kind:'plan',id:item.id,machineId:machine.id});
  fixture=await action({kind:'plan',id:otherTask.id,machineId:otherMachine.id});

  const baseline=await state();
  assert.deepEqual(tasks.map(item=>taskSnapshot(baseline,item.id).start),['2026-10-12T08:00','2026-10-12T09:00','2026-10-12T10:00']);
  const otherBaseline=taskSnapshot(baseline,otherTask.id);
  await page.reload();
  await page.locator('.timeline-scroll').waitFor();
  await page.locator('#date-start').fill('2026-10-12');
  await page.locator('#date-start').dispatchEvent('change');

  await openMaintenance(machine.id);
  await fillMaintenance('Manutenzione programmata test','2026-10-12T09:30','2026-10-12T10:30');
  const beforePreview=await state();
  await previewMaintenance();
  assert.ok(await page.locator('.maintenance-preview').getByText('Manutenzione programmata test',{exact:true}).count());
  assert.ok(await page.locator('.change-list').getByText(tasks[1].title,{exact:true}).count());
  const duringPreview=await state();
  assert.equal(duringPreview.revision,beforePreview.revision);
  assert.deepEqual(duringPreview.calendar.maintenanceBlocks,[]);
  assert.deepEqual(taskSnapshot(duringPreview,tasks[1].id),taskSnapshot(beforePreview,tasks[1].id));
  passed.push('Anteprima inserimento senza modifiche persistenti');

  await confirmMaintenance();
  const inserted=await state();
  assert.equal(inserted.calendar.maintenanceBlocks.length,1);
  const maintenanceId=inserted.calendar.maintenanceBlocks[0].id;
  assert.deepEqual(taskSnapshot(inserted,tasks[0].id),taskSnapshot(baseline,tasks[0].id),'L’attività precedente è cambiata');
  assert.ok(taskSnapshot(inserted,tasks[1].id).end>taskSnapshot(baseline,tasks[1].id).end);
  assert.ok(taskSnapshot(inserted,tasks[2].id).start>taskSnapshot(baseline,tasks[2].id).start);
  assert.deepEqual(taskSnapshot(inserted,otherTask.id),otherBaseline,'La seconda macchina è cambiata');
  assert.ok(await page.locator(`[data-maintenance-block="${maintenanceId}"][data-machine="${machine.id}"]`).count());
  passed.push('Inserimento in timeline con cascata limitata alla macchina');

  let block=page.locator(`[data-maintenance-block="${maintenanceId}"][data-machine="${machine.id}"]`);
  await block.click();
  await page.getByRole('heading',{name:'Modifica indisponibilità'}).waitFor();
  assert.equal(await page.getByLabel('Descrizione').inputValue(),'Manutenzione programmata test');
  assert.equal(await page.getByLabel('Inizio indisponibilità').inputValue(),'2026-10-12T09:30');
  assert.equal(await page.getByLabel('Fine indisponibilità').inputValue(),'2026-10-12T10:30');
  const longName='Manutenzione straordinaria pianificata con descrizione molto lunga per verifica compatta e contenimento del testo';
  await fillMaintenance(longName,'2026-10-12T09:15','2026-10-12T09:30');
  await previewMaintenance();
  await confirmMaintenance();
  const edited=await state();
  assert.equal(edited.calendar.maintenanceBlocks.length,1);
  assert.deepEqual(edited.calendar.maintenanceBlocks[0],{id:maintenanceId,machineId:machine.id,name:longName,start:'2026-10-12T09:15',end:'2026-10-12T09:30'});
  block=page.locator(`[data-maintenance-block="${maintenanceId}"][data-machine="${machine.id}"]`);
  assert.ok(await block.evaluate(element=>element.classList.contains('compact')));
  await block.hover();
  assert.ok(await block.evaluate(element=>element.matches(':hover')));
  await block.focus();
  assert.ok(await block.evaluate(element=>element===document.activeElement));
  assert.match(await block.getAttribute('aria-label'),new RegExp(longName.slice(0,35)));
  passed.push('Modifica dal blocco, focus/hover e resa compatta');

  mkdirSync(artifacts,{recursive:true});
  for(const [width,height] of [[1366,768],[1920,1080],[390,844],[1024,768]]){
    await page.setViewportSize({width,height});
    block=page.locator(`[data-maintenance-block="${maintenanceId}"][data-machine="${machine.id}"]`);
    await block.scrollIntoViewIfNeeded();
    const geometry=await block.evaluate(element=>{
      const box=element.getBoundingClientRect(),cell=element.closest('.temporal-cell').getBoundingClientRect(),strong=element.querySelector('strong');
      const visibleWidth=Math.max(0,Math.min(box.right,innerWidth)-Math.max(box.left,0));
      const visibleHeight=Math.max(0,Math.min(box.bottom,innerHeight)-Math.max(box.top,0));
      return {x:box.x,y:box.y,width:box.width,height:box.height,visibleWidth,visibleHeight,cellHeight:cell.height,strongClientWidth:strong.clientWidth,strongScrollWidth:strong.scrollWidth,rootOverflow:document.documentElement.scrollWidth-innerWidth,compact:element.classList.contains('compact'),spanDisplay:getComputedStyle(element.querySelector('span')).display,overflow:getComputedStyle(element).overflow};
    });
    assert.ok(geometry.width>0&&geometry.height>0&&geometry.height<=geometry.cellHeight+1,`Geometria non valida a ${width}x${height}`);
    assert.ok(geometry.visibleWidth>0&&geometry.visibleHeight>0,`Blocco non visibile a ${width}x${height}`);
    assert.ok(geometry.rootOverflow<=1,`Overflow pagina a ${width}x${height}`);
    assert.equal(geometry.compact,true);
    assert.equal(geometry.spanDisplay,'none');
    assert.equal(geometry.overflow,'hidden');
    geometries.push({viewport:{width,height},...geometry});
    if(process.env.SCREENSHOTS!=='0')await page.screenshot({path:path.join(artifacts,`maintenance-${width}x${height}.png`),fullPage:false});
  }
  passed.push('Geometrie desktop, mobile e tablet senza overflow');

  await page.setViewportSize({width:1366,height:768});
  block=page.locator(`[data-maintenance-block="${maintenanceId}"][data-machine="${machine.id}"]`);
  await block.click();
  await page.getByRole('heading',{name:'Modifica indisponibilità'}).waitFor();
  const beforeRemoval=await state();
  await page.getByRole('button',{name:'Rimuovi indisponibilità…',exact:true}).click();
  await page.getByRole('heading',{name:'Conferma indisponibilità'}).waitFor();
  assert.match(await page.locator('.maintenance-preview').textContent(),/blocco sarà rimosso/i);
  const removalPreview=await state();
  assert.equal(removalPreview.revision,beforeRemoval.revision);
  assert.equal(removalPreview.calendar.maintenanceBlocks.length,1);
  await confirmMaintenance();
  const removed=await state();
  assert.deepEqual(removed.calendar.maintenanceBlocks,[]);
  for(const item of tasks)assert.deepEqual(taskSnapshot(removed,item.id),taskSnapshot(baseline,item.id));
  assert.deepEqual(taskSnapshot(removed,otherTask.id),otherBaseline);
  assert.equal(await page.locator(`[data-maintenance-block="${maintenanceId}"]`).count(),0);
  passed.push('Rimozione con anteprima e ripristino della pianificazione');

  const cleanDraft=await state();
  await post('/api/planning/release',{revision:cleanDraft.revision,reason:'Base verifica manutenzione isolata'});
  await page.reload();
  await page.locator('.timeline-scroll').waitFor();
  await page.locator('#date-start').fill('2026-10-16');
  await page.locator('#date-start').dispatchEvent('change');
  const releasedBefore=await state('?view=shopfloor');
  assert.deepEqual(releasedBefore.calendar.maintenanceBlocks,[]);
  await openMaintenance(machine.id);
  await fillMaintenance('Controllo libero senza attività','2026-10-16T15:00','2026-10-16T16:00');
  await previewMaintenance();
  assert.match(await page.locator('#modal').textContent(),/Nessuna attività deve cambiare data/i);
  await confirmMaintenance();
  const maintenanceOnly=await state(),pendingBlock=maintenanceOnly.calendar.maintenanceBlocks.find(item=>item.name==='Controllo libero senza attività');
  assert.ok(pendingBlock);
  assert.equal(maintenanceOnly.planning.hasMaintenanceChanges,true);
  assert.equal(maintenanceOnly.planning.maintenanceChangeCount,1);
  assert.deepEqual(maintenanceOnly.planning.changedMaintenanceIds,[pendingBlock.id]);
  assert.equal(await page.locator('#release-plan').isEnabled(),true);
  const shopfloorPending=await state('?view=shopfloor');
  assert.deepEqual(shopfloorPending.calendar.maintenanceBlocks,[],'Il reparto vede una manutenzione ancora in bozza');
  await page.locator('#release-plan').click();
  await page.getByRole('button',{name:'Rilascia al reparto',exact:true}).click();
  await page.locator('#modal').waitFor({state:'hidden'});
  const shopfloorReleased=await state('?view=shopfloor');
  assert.deepEqual(shopfloorReleased.calendar.maintenanceBlocks,[pendingBlock]);
  const afterRelease=await state();
  assert.equal(afterRelease.planning.hasMaintenanceChanges,false);
  assert.equal(afterRelease.planning.maintenanceChangeCount,0);
  assert.deepEqual(afterRelease.planning.changedMaintenanceIds,[]);
  passed.push('Manutenzione senza attività resta in bozza fino al rilascio');

  // Sequenza e manutenzione: il rilascio sceglie la posizione, le date escono dalla compattazione attorno al blocco.
  await action({kind:'maintenance',machineId:machine.id,start:'2026-10-12T09:30',end:'2026-10-12T10:30',name:'Blocco dentro la sequenza'});
  await page.reload();
  await page.locator('.timeline-scroll').waitFor();
  await page.locator('#date-start').fill('2026-10-12');
  await page.locator('#date-start').dispatchEvent('change');
  const [first,second,third]=tasks;
  const dropCell=page.locator(`.temporal-cell[data-drop-machine="${machine.id}"][data-date="2026-10-12"]`).first();
  await dropCell.scrollIntoViewIfNeeded();
  const cellBox=await dropCell.boundingBox(),secondBox=await page.locator(`.time-block[data-task="${second.id}"]`).first().boundingBox();
  assert.ok(cellBox&&secondBox,'Servono la cella e la barra della seconda attività');
  await page.locator(`.time-block[data-task="${third.id}"]`).first().dragTo(dropCell,{sourcePosition:{x:6,y:12},targetPosition:{x:secondBox.x-cellBox.x+4,y:30}});
  await page.getByRole('heading',{name:'La sequenza si ricompatta'}).waitFor();
  assert.ok(await page.locator('.change-list').getByText(second.title,{exact:true}).count(),'l’anteprima mostra l’attività che slitta');
  await page.getByRole('button',{name:'Inserisci e ricompatta',exact:true}).click();
  await page.locator('#modal').waitFor({state:'hidden'});
  const around=await state();
  const queueIds=around.tasks.filter(item=>item.machineId===machine.id&&item.position!==null).sort((a,b)=>a.position-b.position).map(item=>item.id);
  assert.deepEqual(queueIds,[first.id,third.id,second.id],'l’attività trascinata entra prima della seconda');
  assert.deepEqual(taskSnapshot(around,first.id),taskSnapshot(baseline,first.id),'la prima attività non cambia');
  assert.deepEqual(taskSnapshot(around,third.id).segments.map(segment=>`${segment.start.slice(11)}→${segment.end.slice(11)}`),['09:00→09:30','10:30→11:00'],'la lavorazione si ferma sul blocco e riprende dopo');
  assert.equal(taskSnapshot(around,second.id).start,'2026-10-12T11:00');
  for(const item of tasks){const snapshot=taskSnapshot(around,item.id);assert.ok(!snapshot.segments.some(segment=>segment.start<'2026-10-12T10:30'&&segment.end>'2026-10-12T09:30'),'nessun segmento dentro la manutenzione');assert.equal(around.tasks.find(task=>task.id===item.id).fixedStart,null);}
  assert.ok(await page.locator(`[data-maintenance-block][data-machine="${machine.id}"]`).count(),'il blocco resta visibile sulla riga');
  passed.push('Rilascio nella sequenza attorno a una manutenzione: anteprima, lavorazione spezzata dal blocco, nessun orario fisso');

  assert.deepEqual(pageErrors,[]);
  const report={passed,pageErrors,geometries,maintenanceId,baseline:tasks.map(item=>({id:item.id,...taskSnapshot(baseline,item.id)})),inserted:tasks.map(item=>({id:item.id,...taskSnapshot(inserted,item.id)})),editedBlock:edited.calendar.maintenanceBlocks[0]};
  writeFileSync(path.join(artifacts,'maintenance-report.json'),JSON.stringify(report,null,2));
  console.log(`PASS maintenance: ${passed.length} scenari`);
}catch(error){
  mkdirSync(artifacts,{recursive:true});
  await page?.screenshot({path:path.join(artifacts,'maintenance-failure.png'),fullPage:false}).catch(()=>{});
  writeFileSync(path.join(artifacts,'maintenance-report.json'),JSON.stringify({passed,pageErrors,geometries,error:error.stack||String(error)},null,2));
  throw error;
}finally{
  await browser?.close();
  if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited.catch(()=>{});}
  assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'aloven-maintenance-'));
  rmSync(temp,{recursive:true,force:true});
}
