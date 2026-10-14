// Browser check of the "In reparto" view. Needs Playwright (PLAYWRIGHT_PATH) and Microsoft Edge.
import {TEST_NOW} from './test-clock.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-reparto-'));
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
let browser;const passed=[];const ok=name=>{passed.push(name);console.log(`PASS ${name}`);};
try{
 const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',b=>{out+=b;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.on('exit',()=>reject(new Error('Server exit')));});
 browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
 const page=await browser.newPage({viewport:{width:1366,height:768}});await page.clock.install({time:new Date(TEST_NOW)});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByLabel('Nome e cognome').fill('Reparto test');await page.getByLabel('Nome utente',{exact:true}).fill('reparto-test');await page.getByLabel('Password',{exact:true}).fill('RepartoTest123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
 const post=async(endpoint,data)=>{const r=await page.request.post(`${base}/api/${endpoint}`,{data,headers:{'X-Aloven-Request':'1'}});assert.equal(r.status(),200,await r.text());return r.json();};
 const state=async()=>(await page.request.get(`${base}/api/state`)).json();
 const commit=async action=>{const s=await state();const p=await post('preview',{revision:s.revision,action});return post('commit',{token:p.token});};
 const openReparto=async()=>{await page.locator('[data-nav="reparto"]').click();await page.locator('#reparto-view').waitFor();};

 // 1. Voce di menu e schede: tutte le macchine libere, nessuna attività in programma
 await page.reload();await page.locator('#live-strip').waitFor();
 const initial=await state();
 await openReparto();
 assert.equal(await page.locator('.reparto-card').count(),initial.machines.length);
 for(const label of await page.locator('.reparto-card .live-state').allTextContents())assert.equal(label.trim(),'Libera');
 assert.equal(await page.locator('.reparto-card [data-reparto-task]').count(),0);
 assert.match(await page.locator('.reparto-summary').innerText(),/^0 in corso/);
 ok('vista In reparto: una scheda per macchina, tutte libere');

 // 2. Attività in corso e prossime della stessa macchina
 const [first,second,third]=initial.tasks.filter(t=>t.machineId==='CNC-01'&&t.status==='unplanned');
 for(const t of [first,second,third])await commit({kind:'plan',id:t.id});
 const s=await state();await post('planning/release',{revision:s.revision,reason:'Prova reparto'});
 await post('shopfloor/action',{revision:(await state()).revision,taskId:first.id,action:'start_setup'});
 await page.reload();await openReparto();
 const card=page.locator('.reparto-card[data-machine="CNC-01"]');
 assert.match(await card.locator('.live-state').innerText(),/^Attrezzaggio/);
 assert.equal(await card.locator('.reparto-current').count(),1);
 assert.match(await card.locator('.reparto-current').innerText(),new RegExp(first.title.slice(0,12)));
 const next=card.locator('.reparto-next li');assert.equal(await next.count(),2,'seconda e terza attività sono le prossime');
 assert.match(await next.nth(0).innerText(),new RegExp(second.title.slice(0,12)));assert.match(await next.nth(1).innerText(),new RegExp(third.title.slice(0,12)));
 assert.match(await next.nth(0).locator('.reparto-when').innerText(),/\d\d:\d\d/,'inizio previsto visibile');
 assert.match(await card.locator('.reparto-lines').innerText(),/attrezzaggio .+ su .+/,'tempo trascorso su previsto leggibile senza tooltip');
 assert.match(await page.locator('.reparto-summary').innerText(),/^1 in corso/);
 assert.equal(await card.locator('.reparto-badge').count(),0,'piano rilasciato: nessun badge');

 await page.screenshot({path:path.join('.artifacts','reparto-desktop.png')});
 ok('in corso con tempi e prossime attività in ordine');

 // 3. Una modifica non ancora rilasciata viene segnalata
 await commit({kind:'plan',id:third.id,beforeId:second.id});
 await page.reload();await openReparto();
 assert.match(await card.locator('.reparto-next li').first().innerText(),new RegExp(third.title.slice(0,12)),'la sequenza mostrata è quella della bozza');
 assert.equal(await card.locator('.reparto-badge').count()>0,true,'badge sulle attività da inviare');
 ok('bozza non rilasciata segnalata con badge');

 // 4. Clic su una prossima attività: ritorno in Pianificazione con l'attività selezionata
 await card.locator('.reparto-next button').first().click();
 await page.locator('#planning-selection:not([hidden]) h3').first().waitFor();
 assert.equal(await page.locator('#live-strip').count(),1,'siamo tornati nella Pianificazione');
 ok('clic su una prossima attività apre la Pianificazione');

 // 5. Mobile
 await page.setViewportSize({width:375,height:812});await page.reload();await openReparto();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'nessun overflow orizzontale su mobile');

 await page.screenshot({path:path.join('.artifacts','reparto-mobile.png')});
 ok('mobile senza overflow');
 assert.deepEqual(errors,[],'nessun errore JavaScript');ok('nessun errore JavaScript');
 console.log(`Reparto suite: ${passed.length}/${passed.length} passed`);
}finally{await browser?.close();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}rmSync(temp,{recursive:true,force:true});}
