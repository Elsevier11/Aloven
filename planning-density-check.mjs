import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';

const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-planning-density-'));
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
let browser;const passed=[];
try{
  const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',b=>{out+=b;const found=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(found){clearTimeout(timer);resolve(found[0]);}});child.on('exit',()=>reject(new Error('Server exit')));});
  browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
  const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('aloven-planning-layout','resource'));await page.goto(base);await page.getByLabel('Nome e cognome').fill('Verifica densità');await page.getByLabel('Nome utente',{exact:true}).fill('density-check');await page.getByLabel('Password',{exact:true}).fill('DensityCheck123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.locator('.essential-planner').waitFor();
  const state=async()=>await(await page.request.get(base+'/api/state')).json();
  const action=async value=>{const current=await state(),response=await page.request.post(base+'/api/preview',{data:{revision:current.revision,action:value},headers:{'X-Aloven-Request':'1'}});assert.equal(response.status(),200,await response.text());const preview=await response.json(),commit=await page.request.post(base+'/api/commit',{data:{token:preview.token},headers:{'X-Aloven-Request':'1'}});assert.equal(commit.status(),200,await commit.text());return state();};
  const addDays=(date,n)=>{const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+n);return value.toISOString().slice(0,10);};
  const nextMonday=date=>{const value=new Date(date+'T12:00:00Z'),days=(8-value.getUTCDay())%7||7;value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),periodStart=nextMonday(today),previousMonday=addDays(periodStart,-7);
  let current=await state();const type=current.types[0],originalMachine=current.machines[0];
  await action({kind:'machine',id:originalMachine.id,values:{name:originalMachine.name,description:originalMachine.description,anchor:previousMonday+'T08:00',speed:originalMachine.speed,speedUnit:originalMachine.speedUnit}});
  current=await state();const machine=current.machines.find(item=>item.id===originalMachine.id);assert.ok(machine);
  const createTask=async(title,runMinutes)=>{const before=new Set((await state()).tasks.map(task=>task.id));const updated=await action({kind:'task',values:{title,typeId:type.id,machineId:machine.id,setupMinutes:0,runMinutes,calculationMode:'manual'}});const created=updated.tasks.find(task=>!before.has(task.id));assert.ok(created,`Attività ${title} non creata`);return created;};
  const before=await createTask('DENSITY Prima del periodo',2400),inside=await createTask('DENSITY Nel periodo',2400),after=await createTask('DENSITY Dopo il periodo',60);
  await action({kind:'plan',id:before.id,machineId:machine.id});await action({kind:'plan',id:inside.id,machineId:machine.id});await action({kind:'plan',id:after.id,machineId:machine.id});
  for(let index=1;index<=6;index++)await createTask(`DENSITY Candidato ${index}`,45+index);
  await page.reload();await page.locator('.essential-planner').waitFor();await page.locator('#machine-filter').selectOption(machine.id);await page.locator('#date-start').fill(periodStart);await page.locator('#date-start').dispatchEvent('change');await page.locator('.planning-candidate').first().waitFor();

  assert.equal(await page.locator('[data-sequence-scope="period"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await page.locator('.production-sequence-row').evaluateAll(rows=>rows.map(row=>row.dataset.task)),[inside.id]);
  assert.equal(await page.locator('.production-sequence-row .sequence-position').textContent(),'2');passed.push('Il periodo mostra solo l’attività realmente sovrapposta, mantenendo la posizione globale');

  await page.locator('[data-sequence-scope="all"]').click();
  assert.deepEqual(await page.locator('.production-sequence-row').evaluateAll(rows=>rows.map(row=>row.dataset.task)),[before.id,inside.id,after.id]);
  assert.deepEqual(await page.locator('.production-sequence-row .sequence-position').allTextContents(),['1','2','3']);
  await page.locator(`[data-task="${inside.id}"] [data-select-task]`).click();await page.locator('#planning-selection').waitFor({state:'visible'});assert.ok((await page.locator('#planning-selection').innerText()).includes('DENSITY Nel periodo'));
  await page.locator('[data-sequence-scope="period"]').click();assert.equal(await page.locator(`[data-task="${inside.id}"]`).count(),1);assert.equal(await page.locator('#planning-selection').isVisible(),true);
  await page.getByRole('button',{name:'Chiudi riepilogo attività'}).click();assert.equal(await page.locator('#planning-selection').isVisible(),false);passed.push('Il toggle conserva ordine, posizione e selezione/dettaglio');

  await page.locator('#queue-search').fill('DENSITY Candidato 3');assert.equal(await page.locator('.planning-candidate').count(),1);assert.ok((await page.locator('.planning-candidate').innerText()).includes('DENSITY Candidato 3'));
  await page.locator('#queue-search').fill('risultato inesistente densità');assert.equal(await page.locator('.planning-candidate').count(),0);assert.ok((await page.locator('.candidate-panel .empty-small').innerText()).includes('Nessuna attività'));
  await page.locator('#queue-search').fill('');assert.ok(await page.locator('.planning-candidate').count()>=6);const other=(await state()).machines.find(item=>item.id!==machine.id);await page.locator('#machine-filter').selectOption(other.id);assert.equal(await page.locator('#machine-filter').inputValue(),other.id);await page.locator('#machine-filter').selectOption(machine.id);assert.equal(await page.locator('#machine-filter').inputValue(),machine.id);passed.push('Ricerca con risultati e vuoto, più cambio macchina');

  mkdirSync('.artifacts',{recursive:true});
  for(const [width,height] of [[1366,768],[1920,1080],[1024,768],[390,844]]){
    await page.setViewportSize({width,height});await page.locator('.essential-planner').waitFor();
    const layout=await page.evaluate(()=>{const box=selector=>{const element=document.querySelector(selector);if(!element)return null;const rect=element.getBoundingClientRect();return {clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)};};return {scrollWidth:document.documentElement.scrollWidth,boxes:Object.fromEntries(['html','body','.shell','.sidebar','.sidebar nav','main','.workspace','.essential-planner','.candidate-list'].map(selector=>[selector,box(selector)])),offenders:[...document.querySelectorAll('body *')].filter(element=>{const rect=element.getBoundingClientRect(),clipped=[...element.parentElement?.closest?.('*')?[element.parentElement.closest('.sidebar nav,.candidate-list,.production-sequence')]:[]].some(parent=>parent&&['auto','scroll','hidden','clip'].includes(getComputedStyle(parent).overflowX));return rect.right>innerWidth+1&&rect.width>0&&!clipped;}).slice(0,5).map(element=>{const rect=element.getBoundingClientRect();return {tag:element.tagName.toLowerCase(),id:element.id,className:typeof element.className==='string'?element.className:'',text:(element.textContent||'').trim().replace(/\s+/g,' ').slice(0,80),left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)};})};});
    if(width===390)await page.screenshot({path:'.artifacts/planning-density-390-overflow.png',fullPage:false});
    assert.ok(layout.scrollWidth<=width+1,`Overflow orizzontale a ${width}px: ${layout.scrollWidth}px ${JSON.stringify(layout.offenders)}`);
    const top=await page.locator('.essential-planner').evaluate(element=>element.getBoundingClientRect().top);
    if(width===1366)assert.ok(top<=280,`Planner troppo in basso a 1366px: ${top}px`);
    if(width===1024)assert.ok(top<=340,`Planner troppo in basso a 1024px: ${top}px`);
    if(width>=1024){
      const dimensions=await page.evaluate(()=>{const height=selector=>document.querySelector(selector).getBoundingClientRect().height;return {sidebar:document.querySelector('.sidebar').getBoundingClientRect().width,title:parseFloat(getComputedStyle(document.querySelector('.planning-title h1')).fontSize),date:height('#date-start'),machine:height('#machine-filter'),radius:getComputedStyle(document.querySelector('.candidate-panel')).borderRadius};});
      assert.ok(dimensions.sidebar<=230,`Sidebar troppo larga: ${dimensions.sidebar}`);
      assert.ok(dimensions.title>=28&&dimensions.title<=32,`Titolo fuori scala: ${dimensions.title}`);
      assert.equal(dimensions.date,40);assert.equal(dimensions.machine,40);assert.equal(dimensions.radius,'8px');
    }
    assert.ok(await page.locator('.planning-titlebar').isVisible());assert.ok(await page.locator('.planning-toolbar').isVisible());assert.ok(await page.locator('.candidate-panel').isVisible());assert.ok(await page.locator('.machine-sequence').isVisible());
    if(width===1366){const visible=await page.locator('.planning-candidate').evaluateAll(rows=>rows.filter(row=>{const r=row.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.width>0&&r.height>0;}).length);assert.ok(visible>=5,`Solo ${visible} candidati interamente visibili`);const heights=await page.locator('.planning-candidate').evaluateAll(rows=>rows.slice(0,5).map(row=>row.getBoundingClientRect().height));assert.ok(heights.every(height=>height<=64),`Righe candidate troppo alte: ${heights.join(', ')}`);}
    const titleSizes=await page.locator('.planning-candidate .task-select strong,.production-sequence-row .task-select strong').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));assert.ok(titleSizes.length&&titleSizes.every(size=>size>=12),`Titoli sotto 12px a ${width}px`);
    await page.screenshot({path:`.artifacts/planning-density-${width}.png`,fullPage:false});
  }
  passed.push('Densità verificata a desktop, tablet e mobile senza overflow o contenuti collassati');

  await page.setViewportSize({width:1366,height:768});await page.getByRole('button',{name:'Piano per macchine'}).click();await page.locator('.timeline-scroll').waitFor();
  const timelineTop=await page.locator('.timeline-scroll').evaluate(element=>element.getBoundingClientRect().top);assert.ok(timelineTop<=280,`Calendario troppo in basso: ${timelineTop}px`);
  const machineRows=page.locator('.temporal-machine');assert.equal(await machineRows.count(),4);const lastBottom=await machineRows.last().evaluate(element=>element.getBoundingClientRect().bottom);await page.screenshot({path:'.artifacts/mes-excellence/density-machine-rows.png',fullPage:false});assert.ok(lastBottom<=768,`La quarta macchina termina a ${lastBottom}px`);await page.screenshot({path:'.artifacts/planning-density-calendar.png',fullPage:false});passed.push('Calendario settimanale con quattro macchine visibili nella prima schermata');
  assert.deepEqual(errors,[]);console.log('PASS planning density:',passed.length,'scenari');
}finally{await browser?.close();child.kill();if(child.exitCode===null)await once(child,'exit').catch(()=>{});assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'aloven-planning-density-'));rmSync(temp,{recursive:true,force:true});}
