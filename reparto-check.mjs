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

 // avanzamento e operatore (il test ha avviato l'attrezzaggio con l'utente admin)
 assert.equal(await card.locator('.reparto-progress').count(),1,'barra di avanzamento sulla macchina in corso');
 assert.match(await card.locator('.reparto-progress').innerText(),/^[0-9]+ %$/);
 assert.match(await card.locator('.reparto-lines').innerText(),/Operatore Reparto test/,'operatore che ha avviato l attività');
 assert.equal(await page.locator('.reparto-tv-link').getAttribute('href'),'/reparto-tv');
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

 // 4b. Monitor a schermo intero: stesse macchine, caratteri grandi, nessun menu
 const tv=await browser.newPage({viewport:{width:1920,height:1080}});const tvErrors=[];tv.on('pageerror',e=>tvErrors.push(e.message));
 await tv.context().addCookies(await page.context().cookies());
 await tv.goto(base+'/reparto-tv');await tv.locator('.tv-card').first().waitFor();
 assert.equal(await tv.locator('.tv-card').count(),initial.machines.length);
 assert.equal(await tv.locator('[data-nav]').count(),0,'nessun menu nel monitor');
 const tvCard=tv.locator('.tv-card').first();assert.match(await tvCard.innerText(),/CNC-01|ACC-01/);
 assert.match(await tv.locator('.tv-top strong').innerText(),/1 in corso/);
 assert.equal(await tv.locator('.tv-progress').count(),1);
 assert.equal(await tv.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Tutte le macchine visibili senza scorrere, schede uguali tra loro
 assert.equal(await tv.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),true,'il monitor non deve scorrere');
 {const boxes=await tv.locator('.tv-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),inside:r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1,clipped:card.scrollHeight>card.clientHeight+1};}));assert.ok(boxes.every(b=>b.inside),'Una scheda esce dallo schermo');assert.ok(boxes.every(b=>b.w===boxes[0].w&&b.h===boxes[0].h),'Le schede devono avere la stessa dimensione');assert.ok(boxes.every(b=>!b.clipped),'Il contenuto di una scheda è tagliato');}
 await tv.screenshot({path:path.join('.artifacts','reparto-tv.png')});
 // senza sessione: invito ad accedere, nessun dato
 const anon=await browser.newContext();const anonPage=await anon.newPage();await anonPage.goto(base+'/reparto-tv');await anonPage.locator('.tv-message a').waitFor();
 assert.match(await anonPage.locator('.tv-message').innerText(),/Accedi/);await anon.close();assert.deepEqual(tvErrors,[]);await tv.close();
 ok('monitor a schermo intero: schede, avanzamento, sessione scaduta');

 // 5. Mobile
 await page.setViewportSize({width:375,height:812});await page.reload();await openReparto();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'nessun overflow orizzontale su mobile');

 await page.screenshot({path:path.join('.artifacts','reparto-mobile.png')});
 ok('mobile senza overflow');
 assert.deepEqual(errors,[],'nessun errore JavaScript');ok('nessun errore JavaScript');
 console.log(`Reparto suite: ${passed.length}/${passed.length} passed`);
}finally{await browser?.close();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}rmSync(temp,{recursive:true,force:true});}
