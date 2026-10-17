import {TEST_NOW} from './test-clock.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-planning-density-'));
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
let browser;const passed=[],errors=[];
try{
 const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',b=>{out+=b;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('aloven-planning-layout','resource'));await page.goto(base);await page.getByLabel('Nome e cognome').fill('Verifica densità');await page.getByLabel('Nome utente',{exact:true}).fill('density');await page.getByLabel('Password',{exact:true}).fill('DensityCheck123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.locator('.timeline-scroll').waitFor();
 const state=async()=>await(await page.request.get(base+'/api/state')).json();
 const action=async action=>{const s=await state(),r=await page.request.post(base+'/api/preview',{data:{revision:s.revision,action},headers:{'X-Aloven-Request':'1'}});assert.equal(r.status(),200,await r.text());const p=await r.json(),c=await page.request.post(base+'/api/commit',{data:{token:p.token},headers:{'X-Aloven-Request':'1'}});assert.equal(c.status(),200,await c.text());};
 const initial=await state(),machine=initial.machines[0],tasks=initial.tasks.filter(t=>t.machineId===machine.id&&t.status==='unplanned').slice(0,3);
 for(let i=0;i<tasks.length;i++){await action({kind:'task',id:tasks[i].id,values:{...tasks[i],setupMinutes:0,runMinutes:60,calculationMode:'manual'}});await action({kind:'plan',id:tasks[i].id,fixedStart:['2026-10-08T08:00','2026-10-12T08:00','2026-10-19T08:00'][i]});}
 await page.reload();await page.locator('#date-start').fill('2026-10-12');await page.locator('#date-start').dispatchEvent('change');
 assert.equal(await page.locator('[data-dispatch-mode]').count(),0);assert.equal(await page.locator('.temporal-machine').count(),4);passed.push('Timeline iniziale unica con tutte le macchine, anche con preferenza precedente');
 mkdirSync('.artifacts',{recursive:true});
 for(const [width,height] of [[1366,768],[1920,1080],[1024,768],[390,844]]){
  await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await page.locator('.planning-titlebar').isVisible());assert.ok(await page.locator('.planning-toolbar').isVisible());assert.ok(await page.locator('.backlog').isVisible());assert.ok(await page.locator('.timeline-scroll').isVisible());
  if(width>=1024){const box=await page.locator('.timeline-scroll').boundingBox();assert.ok(box.y<=260,JSON.stringify(box));assert.ok(box.y+box.height<=height+1);}
  if(width===1366){const visible=await page.locator('.backlog .task-card').evaluateAll(rows=>rows.filter(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight}).length);assert.ok(visible>=6);}
  await page.screenshot({path:`.artifacts/planning-density-${width}.png`,fullPage:false});
 }
 passed.push('Desktop, tablet e mobile: comandi visibili, scorrimento interno e nessun overflow');
 await page.setViewportSize({width:1366,height:768});
 const button=page.locator(`[data-sequence="${machine.id}"]`),menu=page.locator('.machine-actions').filter({has:button});if(await menu.count()&&!await menu.evaluate(el=>el.open))await menu.locator('summary').click();await button.click();await page.locator('#planning-selection .sequence-dock').waitFor();
 assert.deepEqual(await page.locator('.production-sequence-row').evaluateAll(rows=>rows.map(r=>r.dataset.task)),tasks.map(t=>t.id));assert.deepEqual(await page.locator('.sequence-position').allTextContents(),['1','2','3']);
 passed.push('Sequenza completa della macchina, incluse attività prima e dopo il periodo visibile');
 {const pinned=(await state()).tasks.find(t=>t.id===tasks[0].id);assert.ok(pinned.fixedStart,'serve un\u2019attività con data fissata');const revision=(await state()).revision;await page.locator(`[data-move-task="${pinned.id}"][data-direction="down"]`).click();await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();assert.match(await page.locator('#modal').textContent(),/data fissata/i);await page.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});assert.equal((await state()).revision,revision,'Annullare non scrive');passed.push('Spostare un’attività con data fissata chiede conferma e avvisa che la data sarà tolta');}
 const search=page.locator('#modal #sequence-search');if(await search.count()){await search.fill('nessun risultato verifica');assert.equal(await page.locator('.planning-candidate:visible').count(),0);await search.fill('');assert.ok(await page.locator('.planning-candidate').count()>0);}passed.push('Ricerca disponibile e stato vuoto nel pannello macchina');
 for(const [width,height] of [[1920,1080],[1366,768],[1024,768],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const modal=await page.locator('#planning-selection').boundingBox();assert.ok(modal.y>=0&&modal.y+modal.height<=height+1,`Pannello sequenza fuori dal viewport a ${width}`);assert.ok(modal.x>=0&&modal.x+modal.width<=width+1);const close=await page.locator('#sequence-close').boundingBox();assert.ok(close.x>=modal.x&&close.x+close.width<=modal.x+modal.width+1);assert.ok(modal.width>=300,`Pannello sequenza troppo stretto: ${modal.width}`);if(width>=1500){const planner=await page.locator('.planner').boundingBox();assert.ok(planner.x+planner.width<=modal.x+1,`Il calendario è coperto dal pannello a ${width}px`);}await page.screenshot({path:`.artifacts/planning-sequence-${width}.png`,fullPage:false});}
 passed.push('Sequenza contestuale raggiungibile e contenuta nel viewport desktop/mobile');
 assert.deepEqual(errors,[]);writeFileSync('.artifacts/planning-density-report.json',JSON.stringify({passed,errors},null,2));console.log('PASS planning density:',passed.length,'scenari');
}finally{await browser?.close();child.kill();if(child.exitCode===null)await once(child,'exit');assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'aloven-planning-density-'));rmSync(temp,{recursive:true,force:true});}
