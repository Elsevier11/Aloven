// Browser check of the week view (Monday-Saturday, Sunday only when needed). Needs Playwright (PLAYWRIGHT_PATH) and Microsoft Edge.
import {TEST_NOW} from './test-clock.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-week-'));
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
let browser;const passed=[];const ok=name=>{passed.push(name);console.log(`PASS ${name}`);};
try{
 const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',b=>{out+=b;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.on('exit',()=>reject(new Error('Server exit')));});
 browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
 const context=await browser.newContext({viewport:{width:1366,height:768}});
 // Preferenza di una versione precedente ("five") equivale alla vista Settimana
 await context.addInitScript(()=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('aloven-plan-view','five');sessionStorage.setItem('seeded','1');}});
 const page=await context.newPage();await page.clock.install({time:new Date(TEST_NOW)});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByLabel('Nome e cognome').fill('Week test');await page.getByLabel('Nome utente',{exact:true}).fill('week-test');await page.getByLabel('Password',{exact:true}).fill('WeekTest123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
 const post=async(endpoint,data)=>{const r=await page.request.post(`${base}/api/${endpoint}`,{data,headers:{'X-Aloven-Request':'1'}});assert.equal(r.status(),200,await r.text());return r.json();};
 const state=async()=>(await page.request.get(`${base}/api/state`)).json();
 const headings=async()=>page.locator('.gantt-dates .day-heading').evaluateAll(items=>items.map(item=>item.dataset.focusDay));
 const weekday=date=>new Date(`${date}T12:00:00Z`).getUTCDay();
 const range=()=>page.locator('#plan-range').innerText();

 // 1. Preferenza "five" migrata: Settimana attiva, lunedì-sabato della settimana 41 (7 ottobre 2026 è mercoledì)
 await page.reload();await page.locator('#plan-range').waitFor();
 assert.equal(await page.getByRole('button',{name:'Settimana',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await range(),'Settimana 41 · 5–10 ott 2026');
 let days=await headings();assert.deepEqual(days,['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10']);
 assert.ok(days.every(day=>weekday(day)!==0),'nessuna domenica');assert.equal(weekday(days.at(-1)),6,'il sabato c\'è');
 assert.equal(await page.locator('#date-start').inputValue(),'2026-10-05','il campo mostra il lunedì della settimana');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 ok('settimana lunedì-sabato con etichetta e preferenza migrata');

 // 2. Navigazione per settimane
 await page.locator('#next-days').click();assert.equal(await range(),'Settimana 42 · 12–17 ott 2026');assert.equal((await headings())[0],'2026-10-12');
 assert.equal(await page.locator('#next-days').getAttribute('aria-label'),'Settimana successiva');
 await page.locator('#next-days').click();await page.locator('#prev-days').click();await page.locator('#prev-days').click();assert.equal(await range(),'Settimana 41 · 5–10 ott 2026');
 await page.locator('#date-start').fill('2026-10-28');await page.locator('#date-start').dispatchEvent('change');assert.equal(await range(),'Settimana 44 · 26–31 ott 2026');
 await page.locator('#date-start').fill('2026-11-02');await page.locator('#date-start').dispatchEvent('change');assert.equal(await range(),'Settimana 45 · 2–7 nov 2026');
 await page.locator('#date-start').fill('2026-10-29');await page.locator('#date-start').dispatchEvent('change');
 assert.equal(await range(),'Settimana 44 · 26–31 ott 2026');
 await page.locator('#go-today').click();assert.equal(await range(),'Settimana 41 · 5–10 ott 2026');
 ok('frecce, salto data e Oggi');

 // 3. Clic sul giorno: vista Giorno; poi ritorno alla settimana
 await page.locator('.gantt-dates .day-heading').nth(2).click();
 assert.equal(await page.getByRole('button',{name:'Giorno',exact:true}).getAttribute('aria-pressed'),'true');assert.deepEqual(await headings(),['2026-10-07']);
 assert.match(await range(),/^mer 7 ott 2026$/);assert.equal(await page.locator('#next-days').getAttribute('aria-label'),'Giorno successivo');
 await page.locator('#next-days').click();assert.deepEqual(await headings(),['2026-10-08']);
 await page.getByRole('button',{name:'Settimana',exact:true}).click();assert.equal(await range(),'Settimana 41 · 5–10 ott 2026');
 ok('clic sul giorno e ritorno alla settimana');

 // 4. La domenica compare quando una macchina è disponibile quel giorno
 let s=await state();const weekly={...s.calendar.weekly,0:[['08:00','12:00']]};
 await post('preview',{revision:s.revision,action:{kind:'calendar',values:{weekly,exceptions:s.calendar.exceptions||{},machineExceptions:s.calendar.machineExceptions||{},maintenanceBlocks:s.calendar.maintenanceBlocks||[]}}}).then(p=>post('commit',{token:p.token}));
 await page.reload();await page.locator('#plan-range').waitFor();
 days=await headings();assert.equal(days.length,7);assert.equal(weekday(days.at(-1)),0);assert.equal(await range(),'Settimana 41 · 5–11 ott 2026');
 ok('domenica visibile quando una macchina lavora');

 // 5. Mobile
 await page.setViewportSize({width:375,height:812});await page.reload();await page.locator('#plan-range').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'nessun overflow orizzontale su mobile');
 ok('mobile senza overflow');
 assert.deepEqual(errors,[],'nessun errore JavaScript');ok('nessun errore JavaScript');
 console.log(`Week suite: ${passed.length}/${passed.length} passed`);
}finally{await browser?.close();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}rmSync(temp,{recursive:true,force:true});}
