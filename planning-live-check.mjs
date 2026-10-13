// Browser check of the "Adesso in reparto" strip. Needs Playwright (PLAYWRIGHT_PATH) and Microsoft Edge.
import {TEST_NOW} from './test-clock.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-live-'));
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
let browser;const passed=[];const ok=name=>{passed.push(name);console.log(`PASS ${name}`);};
try{
 const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',b=>{out+=b;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.on('exit',()=>reject(new Error('Server exit')));});
 browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
 const page=await browser.newPage({viewport:{width:1366,height:768}});await page.clock.install({time:new Date(TEST_NOW)});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByLabel('Nome e cognome').fill('Live test');await page.getByLabel('Nome utente',{exact:true}).fill('live-test');await page.getByLabel('Password',{exact:true}).fill('LiveTest123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
 const post=async(endpoint,data)=>{const r=await page.request.post(`${base}/api/${endpoint}`,{data,headers:{'X-Aloven-Request':'1'}});assert.equal(r.status(),200,await r.text());return r.json();};
 const state=async()=>(await page.request.get(`${base}/api/state`)).json();
 const commit=async action=>{const s=await state();const p=await post('preview',{revision:s.revision,action});return post('commit',{token:p.token});};

 // 1. Nessuna attività in corso: una cella "Libera" per macchina, nessun pulsante, nessuno scroll di pagina
 await page.reload();await page.locator('#live-strip').waitFor();
 let initial=await state();const cells=page.locator('#live-strip .live-cell');
 assert.equal(await cells.count(),initial.machines.length);assert.equal(await page.locator('#live-strip [data-live-task]').count(),0);
 for(const label of await cells.locator('.live-state').allTextContents())assert.equal(label,'Libera');
 assert.match(await page.locator('#live-strip .live-summary').innerText(),/^0 in corso/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),true,'nessuno scroll della pagina a 1366×768');
 ok('fascia con tutte le macchine libere');

 // 2. Attività in corso: attrezzaggio, produzione, fermo — anche cambiando giorno
 const task=initial.tasks.find(t=>t.machineId==='CNC-01'&&t.status==='unplanned');
 await commit({kind:'plan',id:task.id});let s=await state();await post('planning/release',{revision:s.revision,reason:'Prova fascia'});
 const floor=async(action,extra={})=>post('shopfloor/action',{revision:(await state()).revision,taskId:task.id,action,...extra});
 await floor('start_setup');await page.reload();await page.locator('#live-strip').waitFor();
 let cell=page.locator('#live-strip [data-live-task]');assert.equal(await cell.count(),1);
 assert.match(await cell.locator('.live-state').innerText(),/^Attrezzaggio( da \d\d:\d\d)?$/);assert.match(await cell.getAttribute('aria-label'),/Attrezzaggio/);
 assert.match(await page.locator('#live-strip .live-summary').innerText(),/^1 in corso/);
 await page.locator('#date-start').fill('2026-12-01');await page.locator('#date-start').dispatchEvent('change');
 assert.equal(await page.locator('#live-strip [data-live-task]').count(),1,'la fascia non dipende dal giorno mostrato');
 await page.locator('#go-today').click();
 await floor('finish_setup');await floor('start_run');await page.reload();await page.locator('#live-strip').waitFor();
 assert.match(await page.locator('#live-strip [data-live-task] .live-state').innerText(),/^Produzione/);
 s=await state();const reason=s.machineStopReasons.find(r=>r.active);await post('machine-stop',{action:'stop',machineId:'CNC-01',reasonId:reason.id,revision:s.revision});
 await page.reload();await page.locator('#live-strip').waitFor();
 assert.match(await page.locator('#live-strip [data-live-task] .live-state').innerText(),/^Fermo/);assert.equal(await page.locator('#live-strip [data-live-task] .live-alert').count()>0,true);
 assert.match(await page.locator('#live-strip .live-summary').innerText(),/1 ferma/);
 ok('stati in corso: attrezzaggio, produzione, fermo');

 // 3. Clic: pannello dell'attività e macchina in primo piano
 await page.locator('#live-strip [data-live-task]').click();
 await page.locator('#planning-selection:not([hidden]) h3').first().waitFor();
 assert.match(await page.locator('#planning-selection h3').first().innerText(),new RegExp(task.title.slice(0,12)));
 assert.equal(await page.locator('#machine-filter').inputValue(),'CNC-01');
 assert.equal(await page.locator('#live-strip .live-cell').count(),1,'il filtro macchina vale anche per la fascia');
 ok('clic sulla cella: riepilogo e macchina');

 // 4. Compressione persistente
 await page.locator('#machine-filter').selectOption('');
 await page.locator('#live-toggle').click();assert.equal(await page.locator('#live-cells').isHidden(),true);assert.equal(await page.locator('#live-toggle').getAttribute('aria-expanded'),'false');
 await page.reload();await page.locator('#live-strip').waitFor();assert.equal(await page.locator('#live-cells').isHidden(),true,'la scelta resta dopo il ricaricamento');
 assert.match(await page.locator('#live-strip .live-summary').innerText(),/1 in corso/);
 await page.locator('#live-toggle').click();assert.equal(await page.locator('#live-cells').isVisible(),true);
 ok('compressione ricordata');

 // 5. Barra in corso oltre la fine prevista: prolungata fino all'ora corrente
 s=await state();const running=s.tasks.find(t=>t.id===task.id);
 await page.clock.setFixedTime(new Date(`${running.end.slice(0,10)}T23:30:00+02:00`));await page.reload();await page.locator('#date-start').fill(running.end.slice(0,10));await page.locator('#date-start').dispatchEvent('change');
 await page.locator('#live-strip').waitFor();
 assert.equal(await page.locator(`.overrun-bar[data-overrun="${task.id}"]`).count()>=1,true,'barra di sforamento visibile');
 assert.match(await page.locator('#live-strip [data-live-task] .live-alert').last().innerText(),/fermo|\+/i);
 ok('sforamento della fine prevista');

 // 6. Mobile
 await page.setViewportSize({width:375,height:812});await page.reload();await page.locator('#live-strip').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'nessun overflow orizzontale su mobile');
 ok('mobile senza overflow');
 assert.deepEqual(errors,[],'nessun errore JavaScript');ok('nessun errore JavaScript');
 console.log(`Live strip suite: ${passed.length}/${passed.length} passed`);
}finally{await browser?.close();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}rmSync(temp,{recursive:true,force:true});}
