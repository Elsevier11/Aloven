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
const temp=mkdtempSync(path.join(tmpdir(),'aloven-planning-clarity-'));
const artifacts=path.resolve('.artifacts');
mkdirSync(artifacts,{recursive:true});
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,DATA_DIR:temp,PORT:'0'},stdio:['ignore','pipe','pipe']});
const report={startedAt:new Date().toISOString(),passed:[],failures:[],pageErrors:[],consoleErrors:[],layouts:[],visuals:[]};
let browser,page,base,caseName='bootstrap';

const flushReport=()=>writeFileSync(path.join(artifacts,'planning-clarity-report.json'),JSON.stringify(report,null,2));
const capture=async name=>{
  const screenshot=path.join(artifacts,`planning-clarity-${name}.png`);
  await page.screenshot({path:screenshot,fullPage:false});
  report.visuals.push({name,screenshot});
};
const recordFailure=async(name,error)=>{
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
  const screenshot=path.join(artifacts,`planning-clarity-failure-${slug}.png`);
  await page?.screenshot({path:screenshot,fullPage:false}).catch(()=>{});
  report.failures.push({name,error:error.stack||String(error),screenshot,reproduction:`PLAYWRIGHT_PATH=${playwrightPath} node planning-clarity-check.mjs`});
  flushReport();
};
const check=async(name,fn)=>{
  caseName=name;
  try{await fn();report.passed.push(name);flushReport();}
  catch(error){
    await recordFailure(name,error);
    await page?.keyboard.press('Escape').catch(()=>{});
    const modal=page?.locator('#modal');
    if(modal&&await modal.isVisible().catch(()=>false)){
      const close=modal.locator('[data-close], [data-close-bottom], button').filter({hasText:/^(Chiudi|Annulla)$/}).first();
      if(await close.count())await close.click().catch(()=>{});
    }
    if(modal&&await modal.isVisible().catch(()=>false))await modal.evaluate(element=>element.close()).catch(()=>{});
    await page?.setViewportSize({width:1366,height:768}).catch(()=>{});
    const date=page?.locator('#date-start');
    if(date&&await date.isVisible().catch(()=>false)){
      await date.fill('2026-10-12').catch(()=>{});
      await date.dispatchEvent('change').catch(()=>{});
    }
  }
};

try{
  base=await new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(new Error('Timeout avvio server')),15000);
    child.stdout.on('data',chunk=>{
      output+=chunk;
      const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if(match){clearTimeout(timer);resolve(match[0]);}
    });
    child.stderr.on('data',chunk=>process.stderr.write(chunk));
    child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Server terminato con codice ${code}`));});
  });

  browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  context.setDefaultTimeout(8000);
  await context.addInitScript(()=>{
    localStorage.setItem('aloven-plan-view','day');
    localStorage.setItem('aloven-plan-zoom','1');
    localStorage.setItem('aloven-drag-mode','single');
  });
  page=await context.newPage();
  page.on('pageerror',error=>report.pageErrors.push({case:caseName,message:error.message}));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push({case:caseName,message:message.text()});});

  await page.goto(base);
  await page.getByLabel('Nome e cognome').fill('Verifica chiarezza');
  await page.getByLabel('Nome utente',{exact:true}).fill('clarity-admin');
  await page.getByLabel('Password',{exact:true}).fill('ClarityCheck123!');
  await page.getByRole('button',{name:'Crea amministratore'}).click();
  await page.locator('.timeline-scroll').waitFor();

  const state=async(query='')=>await (await page.request.get(base+'/api/state'+query)).json();
  const post=async(endpoint,data,expected=200)=>{
    const response=await page.request.post(base+'/api/'+endpoint,{data,headers:{'X-Aloven-Request':'1'}});
    assert.equal(response.status(),expected,await response.text());
    return response.json();
  };
  const action=async value=>{
    const current=await state();
    const preview=await post('preview',{revision:current.revision,action:value});
    await post('commit',{token:preview.token});
    return state();
  };
  const setDay=async day=>{
    await page.locator('#date-start').fill(day);
    await page.locator('#date-start').dispatchEvent('change');
    await page.waitForFunction(value=>document.querySelector('#date-start')?.value===value,day);
  };
  const openSearch=async()=>{
    await page.locator('#planning-search').click();
    await page.locator('#planning-search-query').waitFor();
  };
  const searchFor=async term=>{
    const input=page.locator('#planning-search-query');
    await input.fill(term);
    await input.press('Enter');
  };
  const closeDialog=async()=>{
    const close=page.locator('#modal [data-close]');
    if(await close.count())await close.click();
    await page.locator('#modal').waitFor({state:'hidden'});
  };
  const taskSnapshot=(snapshot,id)=>{
    const task=snapshot.tasks.find(item=>item.id===id);
    assert.ok(task,`Attività ${id} assente`);
    return {machineId:task.machineId,status:task.status,position:task.position,start:task.start,end:task.end,fixedStart:task.fixedStart,planningState:task.planningState};
  };

  const weekly={0:[],1:[['08:00','12:00'],['13:00','17:00']],2:[['08:00','12:00'],['13:00','17:00']],3:[['08:00','12:00'],['13:00','17:00']],4:[['08:00','12:00'],['13:00','17:00']],5:[['08:00','12:00'],['13:00','17:00']],6:[]};
  let fixture=await action({kind:'calendar',values:{weekly,exceptions:{},machineExceptions:{},maintenanceBlocks:[]}});
  const machine=fixture.machines.find(item=>item.id==='CNC-01')||fixture.machines[0];
  const other=fixture.machines.find(item=>item.id!==machine.id);
  assert.ok(machine&&other,'La fixture richiede due macchine');
  for(const item of [machine,other]){
    const current=(await state()).machines.find(value=>value.id===item.id);
    await action({kind:'machine',id:item.id,values:{...current,anchor:'2026-10-09T08:00'}});
  }
  fixture=await state();
  const sourceTasks=fixture.tasks.filter(item=>item.status==='unplanned').slice(0,5);
  assert.equal(sourceTasks.length,5,'La fixture richiede cinque attività iniziali');
  const [pastTask,futureTask,modifiedTask,draftTask,singleMachineTask]=sourceTasks;
  const titles=['CL passato non avviato','CL futuro fuori periodo','CL modifica rilascio','CL nuova bozza','CL destinazione unica'];
  for(let index=0;index<sourceTasks.length;index++){
    const current=(await state()).tasks.find(item=>item.id===sourceTasks[index].id);
    const compatible=index===4?[machine.id]:[machine.id,other.id];
    await action({kind:'task',id:current.id,values:{...current,title:titles[index],machineId:machine.id,preferredMachineId:machine.id,compatibleMachineIds:compatible,setupMinutes:0,runMinutes:60,calculationMode:'manual',orderReference:index===3?'ORD-CL-UNPLANNED':`ORD-CL-${index+1}`,outputLot:index===0?'LOT-CL-1':`LOT-CL-${index+1}`}});
  }
  await action({kind:'plan',id:pastTask.id,machineId:machine.id,fixedStart:'2026-10-09T08:00'});
  await action({kind:'plan',id:modifiedTask.id,machineId:machine.id,fixedStart:'2026-10-12T10:00'});
  await action({kind:'plan',id:futureTask.id,machineId:machine.id,fixedStart:'2026-10-19T08:00'});
  let beforeRelease=await state();
  await post('planning/release',{revision:beforeRelease.revision,reason:'Base verifica chiarezza'});
  await action({kind:'plan',id:modifiedTask.id,machineId:other.id,fixedStart:'2026-10-13T08:00'});
  await action({kind:'plan',id:draftTask.id,machineId:machine.id,fixedStart:'2026-10-12T13:00'});
  await action({kind:'calendar',values:{...(await state()).calendar,maintenanceBlocks:[{id:'maintenance-clarity',machineId:other.id,name:'Manutenzione chiarezza',start:'2026-10-14T08:00',end:'2026-10-14T09:00'}]}});
  const prepared=await state();
  assert.equal(prepared.planning.version,1);
  assert.equal(prepared.tasks.find(item=>item.id===pastTask.id).planningState,'released');
  assert.equal(prepared.tasks.find(item=>item.id===modifiedTask.id).planningState,'modified');
  assert.equal(prepared.tasks.find(item=>item.id===draftTask.id).planningState,'unreleased');
  await page.reload();
  await page.locator('.timeline-scroll').waitFor();
  await setDay('2026-10-12');

  await check('Ricerca globale per ordine, lotto e codice con salto alla posizione',async()=>{
    await openSearch();
    await searchFor('ORD-CL-1');
    const plannedResult=page.locator(`#modal [data-find-planning-task="${pastTask.id}"]`);
    await plannedResult.waitFor();
    assert.match(await plannedResult.textContent(),/Vai alla posizione/);
    await plannedResult.press('Enter');
    await page.locator('#planning-selection:not([hidden])').waitFor();
    assert.equal(await page.locator('#machine-filter').inputValue(),machine.id);
    assert.equal(await page.locator('#date-start').inputValue(),'2026-10-09');
    assert.match(await page.locator('#planning-selection').textContent(),/CL passato non avviato/);
    await page.locator('#planning-search').click();
    await searchFor('LOT-CL-1');
    assert.ok(await page.locator(`#modal [data-find-planning-task="${pastTask.id}"]`).count());
    await closeDialog();
    await openSearch();
    const productCode=(await state()).tasks.find(item=>item.id===pastTask.id).productCode;
    assert.ok(productCode,'Codice prodotto assente nella fixture');
    await searchFor(productCode);
    assert.ok(await page.locator(`#modal [data-find-planning-task="${pastTask.id}"]`).count());
    await closeDialog();
    await openSearch();
    await searchFor('ORD-CL-5');
    const unplannedResult=page.locator(`#modal [data-find-planning-task="${singleMachineTask.id}"]`);
    assert.match(await unplannedResult.textContent(),/Seleziona attività/);
    await unplannedResult.click();
    await page.locator('#planning-selection:not([hidden])').waitFor();
    assert.match(await page.locator('#planning-selection').textContent(),/CL destinazione unica/);
  });

  await check('Sequenza diretta, riferimenti operativi e stati di invio leggibili',async()=>{
    await setDay('2026-10-12');
    const direct=page.locator(`[data-sequence="${machine.id}"]`);
    await direct.waitFor();
    assert.equal(await direct.isVisible(),true);
    assert.ok(await page.locator(`.task-reference[data-task="${singleMachineTask.id}"], [data-task="${singleMachineTask.id}"] .task-reference`).count(),'Riferimento assente nel backlog');
    assert.match(await page.locator(`.time-block[data-task="${draftTask.id}"] strong`).first().textContent(),/LOT-CL-4/,'Riferimento lotto assente nella barra');
    await openSearch();
    const tones=await page.locator('#modal .dispatch-state').evaluateAll(nodes=>nodes.map(node=>({tone:node.dataset.tone,label:(node.textContent||'').trim()||node.getAttribute('aria-label')||node.getAttribute('title')||''})));
    for(const expected of ['Da inviare al reparto','Inviata al reparto','Modificata · da inviare'])assert.ok(tones.some(item=>item.label.includes(expected)),`Stato mancante: ${expected}`);
    assert.ok(tones.every(item=>item.tone),`Ogni stato deve avere data-tone: ${JSON.stringify(tones)}`);
    await capture('references-and-dispatch');
    await closeDialog();
  });

  await check('Contatori nel periodo e fuori periodo aprono la sequenza completa',async()=>{
    await setDay('2026-10-12');
    const counts=page.locator('.temporal-machine').filter({has:page.locator(`[data-outside-sequence="${machine.id}"]`)});
    await counts.waitFor();
    assert.match((await counts.textContent()).replace(/\s+/g,' '),/nel periodo/i);
    assert.match((await counts.textContent()).replace(/\s+/g,' '),/\d+ fuori/i);
    await page.locator(`[data-outside-sequence="${machine.id}"]`).click();
    await page.getByRole('heading',{name:'Sequenza macchina',exact:true}).waitFor();
    assert.ok(await page.locator(`.production-sequence-row[data-task="${futureTask.id}"]`).count());
    await closeDialog();
  });

  await check('Inizio previsto passato e non avviato è segnalato nel piano e nella selezione',async()=>{
    await setDay('2026-10-09');
    const alert=page.locator('.planning-alert');
    await alert.waitFor();
    assert.match(await alert.textContent(),/passat|non avviat/i);
    await page.locator(`.time-block[data-task="${pastTask.id}"]`).first().click();
    const selection=page.locator('#planning-selection');
    await selection.waitFor();
    assert.ok(await selection.locator('.selection-warning').count());
    assert.match(await selection.locator('.selection-warning').textContent(),/passat|non avviat/i);
  });

  await check('Continuità di posizionamento, destinazione compatibile e anteprima',async()=>{
    await setDay('2026-10-12');
    if(await page.locator('#clear-planning-selection').isVisible())await page.locator('#clear-planning-selection').click();
    await page.locator(`.time-block[data-task="${draftTask.id}"]`).first().click();
    const placement=page.locator('#selection-placement');
    await placement.waitFor();
    const mode=placement.locator('select[name="mode"], select').filter({has:page.locator('option[value="end"]')}).first();
    const values=await mode.locator('option').evaluateAll(options=>options.map(option=>option.value));
    for(const value of ['end','date','before','after','cascade'])assert.ok(values.includes(value),`Modalità mancante: ${value}`);
    const destination=placement.locator('select[name="machineId"]');
    assert.equal(await destination.isVisible(),true);
    assert.deepEqual((await destination.locator('option').evaluateAll(options=>options.map(option=>option.value))).sort(),[machine.id,other.id].sort());
    await openSearch();await searchFor('CL destinazione unica');
    await page.locator(`#modal [data-find-planning-task="${singleMachineTask.id}"]`).click();
    const singleSelection=page.locator('#planning-selection'),singleDestination=singleSelection.getByRole('group',{name:'Macchina di destinazione'});
    await singleDestination.waitFor();
    assert.equal(await singleDestination.locator('select[name="machineId"]').count(),0);
    assert.equal(await singleDestination.locator('input[type="hidden"][name="machineId"]').inputValue(),machine.id);
    assert.match(await singleDestination.textContent(),new RegExp(machine.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(await singleSelection.textContent(),/Anteprima pianificazione/i);
    await openSearch();await searchFor('CL nuova bozza');
    await page.locator(`#modal [data-find-planning-task="${draftTask.id}"]`).click();
    assert.ok(await page.locator('#planning-selection').getByText('Togli dal piano',{exact:true}).count());
  });

  await check('Rilascio mostra differenze prima/dopo, ambito completo e manutenzioni; annulla senza scritture',async()=>{
    const before=await state(),snapshot=Object.fromEntries(before.tasks.map(task=>[task.id,taskSnapshot(before,task.id)]));
    await page.locator('#release-plan').click();
    await page.getByRole('heading',{name:'Rilascia le modifiche'}).waitFor();
    const modal=page.locator('#modal');
    assert.ok(await modal.locator('.release-changes').count());
    assert.ok(await modal.locator('.release-change').count()>=2);
    const text=(await modal.textContent()).replace(/\s+/g,' ');
    assert.match(text,/tutte le macchine/i);
    assert.match(text,/tutte le date/i);
    const taskChange=modal.locator('.release-change').filter({hasText:'ORD-CL-3'});
    await taskChange.waitFor();
    const oldPlan=(await taskChange.getByText(/^Al reparto:/).textContent()).replace(/\s+/g,' ');
    const newPlan=(await taskChange.getByText(/^Dopo l’invio:/).textContent()).replace(/\s+/g,' ');
    assert.ok(oldPlan.includes(machine.name),`Macchina precedente assente: ${oldPlan}`);
    assert.match(oldPlan,/12 ott.*10:00.*11:00/i);
    assert.ok(newPlan.includes(other.name),`Nuova macchina assente: ${newPlan}`);
    assert.match(newPlan,/13 ott.*08:00.*09:00/i);
    const maintenanceChange=modal.locator('.release-change').filter({hasText:'Manutenzione chiarezza'});
    await maintenanceChange.waitFor();
    assert.match((await maintenanceChange.textContent()).replace(/\s+/g,' '),/Al reparto:.*Non presente.*Dopo l’invio:.*14 ott.*08:00.*09:00/i);
    await capture('release-differences');
    await page.getByRole('button',{name:'Annulla',exact:true}).click();
    await modal.waitFor({state:'hidden'});
    const after=await state();
    assert.equal(after.revision,before.revision);
    assert.equal(after.planning.version,before.planning.version);
    assert.deepEqual(Object.fromEntries(after.tasks.map(task=>[task.id,taskSnapshot(after,task.id)])),snapshot);
    assert.deepEqual(after.calendar.maintenanceBlocks,before.calendar.maintenanceBlocks);
  });

  await check('Uso mouse e tastiera mantiene selezione e focus coerenti',async()=>{
    await page.locator('#planning-search').click();
    const input=page.locator('#planning-search-query');
    await input.fill('ORD-CL-3');
    await input.press('Enter');
    const result=page.locator(`#modal [data-find-planning-task="${modifiedTask.id}"]`);
    await result.focus();
    await result.press('Enter');
    await page.locator('#planning-selection:not([hidden])').waitFor();
    assert.match(await page.locator('#planning-selection').textContent(),/CL modifica rilascio/);
    assert.ok(await page.evaluate(()=>document.activeElement instanceof HTMLElement));
  });

  await check('Layout 1366, 1920, tablet e mobile senza overflow della pagina',async()=>{
    for(const [width,height] of [[1366,768],[1920,1080],[1024,768],[390,844]]){
      await page.setViewportSize({width,height});
      await setDay('2026-10-12');
      const geometry=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth,searchVisible:Boolean(document.querySelector('#planning-search')?.getClientRects().length),sequenceVisible:[...document.querySelectorAll('[data-sequence]')].some(element=>element.getClientRects().length)}));
      assert.ok(geometry.scrollWidth<=width+1,`Overflow ${width}x${height}: ${geometry.scrollWidth}px`);
      assert.equal(geometry.searchVisible,true,`Ricerca non visibile a ${width}x${height}`);
      assert.equal(geometry.sequenceVisible,true,`Sequenza non visibile a ${width}x${height}`);
      const screenshot=path.join(artifacts,`planning-clarity-${width}x${height}.png`);
      await page.screenshot({path:screenshot,fullPage:false});
      report.layouts.push({width,height,screenshot,...geometry});
    }
  });

  assert.deepEqual(report.pageErrors,[]);
  assert.deepEqual(report.consoleErrors,[]);
}catch(error){
  await recordFailure(caseName,error);
}finally{
  report.finishedAt=new Date().toISOString();
  flushReport();
  await browser?.close();
  if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited.catch(()=>{});}
  assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'aloven-planning-clarity-'));
  rmSync(temp,{recursive:true,force:true});
}

if(report.failures.length){
  console.error(`FAIL planning clarity: ${report.failures.length} casi; report ${path.join(artifacts,'planning-clarity-report.json')}`);
  for(const failure of report.failures)console.error(`- ${failure.name}: ${failure.error.split('\n')[0]}`);
  process.exitCode=1;
}else console.log(`PASS planning clarity: ${report.passed.length} scenari`);
