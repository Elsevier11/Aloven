// Browser check of the owner/planner insights: consegne a rischio, Attività (colonne, duplica),
// suggerimento di attrezzaggio, rilascio compatto, stampa del piano e statistiche con tendenza.
// Needs Playwright (PLAYWRIGHT_PATH) and Microsoft Edge. Runs on a disposable database.
import {TEST_NOW} from './test-clock.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-insights-'));
mkdirSync('.artifacts',{recursive:true});
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
let browser;const ok=name=>console.log(`PASS ${name}`);
try{
 const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',b=>{out+=b;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.on('exit',()=>reject(new Error('Server exit')));});
 browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
 const page=await browser.newPage({viewport:{width:1440,height:900}});await page.clock.install({time:new Date(TEST_NOW)});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base);await page.getByLabel('Nome e cognome').fill('Insights test');await page.getByLabel('Nome utente',{exact:true}).fill('insights');await page.getByLabel('Password',{exact:true}).fill('InsightsTest123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
 const post=async(endpoint,data)=>{const r=await page.request.post(`${base}/api/${endpoint}`,{data,headers:{'X-Aloven-Request':'1'}});assert.equal(r.status(),200,await r.text());return r.json();};
 const state=async()=>(await page.request.get(`${base}/api/state`)).json();
 const commit=async action=>{const s=await state();const p=await post('preview',{revision:s.revision,action});return post('commit',{token:p.token});};
 const seed=spawn(process.execPath,['seed-history.mjs'],{env:{...process.env,DATA_DIR:temp},stdio:['ignore','ignore','pipe']});let seedError='';seed.stderr.on('data',b=>seedError+=b);assert.equal((await once(seed,'exit'))[0],0,seedError);

 // Tre attività pianificate sulla stessa macchina; la prima con consegna già superata, la seconda con consegna lontana
 const initial=await state();
 const machine=initial.machines[0];
 const [first,second,third]=initial.tasks.filter(t=>t.machineId===machine.id&&t.status==='unplanned');
 for(const t of [first,second,third])await commit({kind:'plan',id:t.id});
 const planned=await state();const startOf=id=>planned.tasks.find(t=>t.id===id).start.slice(0,10);
 const shiftDay=(day,delta)=>new Date(Date.parse(day+'T00:00Z')+delta*864e5).toISOString().slice(0,10);
 const db=new DatabaseSync(path.join(temp,'aloven.sqlite'));db.exec('PRAGMA busy_timeout=5000');
 db.prepare('UPDATE tasks SET dueDate=?,customer=? WHERE id=?').run(shiftDay(startOf(first.id),-2),'Cliente Prova',first.id);
 db.prepare('UPDATE tasks SET dueDate=? WHERE id=?').run(shiftDay(startOf(second.id),30),second.id);
 db.close();
 await page.reload();await page.locator('.timeline-scroll').waitFor();

 // 1. Piano: blocco oltre la consegna e conteggio testuale
 await page.getByRole('button',{name:'Giorno',exact:true}).click();
 await page.locator('#plan-date,input[type=date]').first().fill(startOf(first.id));
 await page.waitForTimeout(300);
 assert.ok(await page.locator('.time-block.due-late').count()>=1,'blocco con filo rosso della consegna superata');
 const dueLabel=await page.locator('.time-block.due-late').first().getAttribute('aria-label');assert.match(dueLabel,/oltre la consegna/);
 assert.match(await page.locator('.period-due').innerText(),/^1 oltre la consegna$/);
 assert.equal(await page.locator(`.time-block.due-late[data-task="${second.id}"]`).count(),0,'consegna lontana: nessun segnale');
 ok('piano: attività oltre la consegna segnalata sul blocco e nel conteggio');

 // 2. Rilascio compatto: attività nuove raggruppate per macchina
 await page.locator('#release-plan').click();await page.locator('#modal .release-new').first().waitFor();
 const groups=await page.locator('#modal .release-new').count();assert.equal(groups,1,'una sola macchina coinvolta');
 assert.match(await page.locator('#modal .release-new summary').innerText(),/3 attività nuove da inviare/);
 assert.equal(await page.locator('#modal .release-new li').count(),3,'una riga per attività');
 assert.equal(await page.locator('#modal .release-change').count(),0,'nessuna scheda estesa per attività nuove');
 assert.match(await page.locator('#modal .dialog-body').first().innerText(),/3 nuove/);
 await page.screenshot({path:'.artifacts/insights-release.png'});
 await page.keyboard.press('Escape');
 ok('rilascio: attività nuove su una riga ciascuna');

 // 3. Stampa: il foglio contiene la macchina, le attività e il periodo
 await page.evaluate(()=>{window.print=()=>{window.__printed=document.getElementById('print-sheet')?.innerText||'';};});
 await page.locator('#planning-options summary,.plan-toolbar summary').filter({hasText:'Altro'}).first().click();
 await page.locator('#planning-print').click();
 const printed=await page.evaluate(()=>window.__printed);
 assert.match(printed,/Piano di produzione/);assert.ok(printed.includes(machine.name));assert.match(printed,/Cliente Prova/);assert.match(printed,/Piano non ancora rilasciato/);
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal(await page.locator('#print-sheet').count(),0,'il foglio non resta nella pagina dopo la stampa');assert.equal(await page.evaluate(()=>document.body.classList.contains('printing-plan')),false);
 ok('stampa del piano per macchina');

 // 4. Attività: ordine, colonna Cliente / consegna, Duplica
 await page.locator('[data-nav="tasks"]').click();await page.locator('.task-table').waitFor();
 const firstRow=page.locator('.task-table tbody tr').first();
 assert.doesNotMatch(await firstRow.innerText(),/Completata/,'prima il lavoro da fare, non lo storico');
 assert.ok((await page.locator('.task-table thead th').allInnerTexts()).includes('Cliente / consegna'));
 const customerRow=page.locator('.task-table tbody tr').filter({hasText:'Cliente Prova'});assert.equal(await customerRow.count(),1);
 assert.match(await customerRow.innerText(),/Consegna .*\+2 gg|\+\d+ gg/,'ritardo previsto visibile nell\'elenco');
 await page.locator('#status-filter').selectOption('active');
 assert.equal(await page.locator('.task-table tbody tr:has-text("Completata")').count(),0,'filtro Attive senza storico');
 await customerRow.locator('[data-duplicate]').click();await page.locator('#modal').waitFor({state:'visible'});
 assert.match(await page.locator('#modal .dialog-heading,#modal h2').first().innerText(),/Nuova attività/);
 assert.equal(await page.locator('#modal [name="customer"]').inputValue(),'Cliente Prova');
 assert.equal(await page.locator('#modal [name="orderReference"]').inputValue(),'','il riferimento ordine non si copia');
 assert.equal(await page.locator('#modal [name="dueDate"]').inputValue(),'','la consegna non si copia');
 assert.equal(await page.locator('#modal [name="productArticleId"]').inputValue(),first.productArticleId);
 ok('Attività: ordine, Cliente / consegna, filtro Attive e Duplica');

 // 5. Suggerimento di attrezzaggio dallo storico
 const suggestion=(await (await page.request.get(`${base}/api/setup-suggestion?machineId=${machine.id}&productArticleId=${first.productArticleId}`)).json()).suggestion;
 assert.ok(suggestion&&suggestion.minutes>0,'lo storico demo dà un suggerimento');
 await page.locator('#modal [name="setupMinutes"]').fill(String(suggestion.minutes+17));
 await page.locator('#modal [name="productArticleId"]').selectOption(first.productArticleId);
 await page.locator('#setup-suggestion:not([hidden])').waitFor();
 assert.match(await page.locator('#setup-suggestion').innerText(),new RegExp(`${suggestion.minutes} min`));
 await page.locator('#use-setup-suggestion').click();
 assert.equal(await page.locator('#modal [name="setupMinutes"]').inputValue(),String(suggestion.minutes));
 await page.screenshot({path:'.artifacts/insights-setup-suggestion.png'});
 await page.keyboard.press('Escape');
 if(await page.locator('#modal [data-discard],#modal button:has-text("Scarta")').count())await page.locator('#modal [data-discard],#modal button:has-text("Scarta")').first().click();
 ok('attrezzaggio suggerito dallo storico, applicato solo su richiesta');

 // 6. Statistiche: puntualità, tendenza e scostamento per macchina
 await page.locator('[data-nav="statistics"]').click();await page.locator('.statistics-chart-grid').waitFor();
 await page.locator('.statistics-kpis').waitFor();
 assert.ok(await page.locator('.statistics-kpi:has-text("Puntualità")').count()===1);
 assert.match(await page.locator('.statistics-kpi:has-text("Puntualità")').innerText(),/Data di consegna non indicata|in ritardo su/);
 assert.ok(await page.locator('.statistics-trend').count()>=1,'tendenza rispetto al periodo precedente');
 assert.match(await page.locator('.statistics-trend').first().innerText(),/^[▲▼▬] /,'freccia e segno, non solo colore');
 await page.locator('[data-statistics-dashboard=machines]').click();await page.locator('#machine-performance').waitFor();
 assert.ok((await page.locator('#machine-performance th').allInnerTexts()).some(t=>/scost\. lavoraz\./i.test(t)));
 assert.match(await page.locator('#machine-performance tbody tr').first().innerText(),/[+−]?\d+(,\d+)?%|—/);
 await page.screenshot({path:'.artifacts/insights-statistics.png'});
 ok('statistiche: puntualità, tendenza e scostamento per macchina');

 assert.deepEqual(errors,[]);ok('nessun errore JavaScript');
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done.catch(()=>{});}rmSync(temp,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
