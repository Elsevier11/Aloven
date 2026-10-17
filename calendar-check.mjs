import {TEST_NOW} from './test-clock.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const playwrightPath=process.env.PLAYWRIGHT_PATH;
if(!playwrightPath)throw new Error('Imposta PLAYWRIGHT_PATH sul modulo Playwright disponibile.');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const temp=mkdtempSync(path.join(tmpdir(),'aloven-calendar-')),artifacts=path.resolve('.artifacts');
mkdirSync(artifacts,{recursive:true});
let browser,server;

try{
  server=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,HOST:'127.0.0.1',PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Avvio server scaduto: ${output}`)),15000);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.stderr.on('data',chunk=>process.stderr.write(chunk));server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server terminato: ${code} ${output}`));});});
  browser=await chromium.launch({headless:process.env.HEADFUL!=='1',channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  await page.goto(base);
  await page.getByLabel('Nome e cognome').fill('Verifica calendario');
  await page.getByLabel('Nome utente',{exact:true}).fill('calendario');
  await page.getByLabel('Password',{exact:true}).fill('PasswordTest123!');
  await page.getByRole('button',{name:'Crea amministratore'}).click();
  await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
  await page.locator('[data-nav-group="settings"]').click();
  await page.locator('[data-nav="calendar"]').click();
  await page.locator('#weekly-form').waitFor();

  for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);
    const tag=`${viewport.width}x${viewport.height}`;
    await page.screenshot({path:path.join(artifacts,`calendar-${tag}.png`)});
    // Tutti e sette i giorni visibili senza scorrere dentro la scatola
    const weekly=await page.locator('.weekly-days').evaluate(box=>({overflow:box.scrollHeight-box.clientHeight,rows:box.querySelectorAll('.weekly-row').length,rowHeight:Math.round(box.querySelector('.weekly-row').getBoundingClientRect().height),inputHeight:Math.round(box.querySelector('input[type=time]').getBoundingClientRect().height),client:box.clientHeight}));
    assert.equal(weekly.rows,7);assert.ok(weekly.overflow<=1,`Settimana standard con scorrimento interno a ${tag} (${JSON.stringify(weekly)})`);
    // Le due fasce di ogni giorno stanno sulla stessa riga
    const sameLine=await page.locator('.weekly-row').first().evaluate(row=>{const t=[...row.querySelectorAll('input[type=time]')].map(i=>Math.round(i.getBoundingClientRect().top));return new Set(t).size===1;});
    assert.ok(sameLine,`Fasce su righe diverse a ${tag}`);
    // Il mese entra intero nel suo riquadro
    const month=await page.locator('.month-panel').evaluate(panel=>panel.scrollHeight-panel.clientHeight);
    assert.ok(month<=1,`Mese tagliato a ${tag} (${month}px)`);
    // Sabato e domenica standard senza testo ripetuto, ma con nome accessibile
    const weekend=page.locator('.calendar-day.off:not(.exception)').first();
    assert.equal(await weekend.locator('small').count(),0,'Non lavorativo ripetuto nei fine settimana');
    assert.match(await weekend.getAttribute('aria-label'),/Non lavorativo/);
    // Testi secondari mai sotto 12 px
    const tiny=await page.locator('.weekly-labels *,.weekday,.calendar-legend span,.calendar-day small,.calendar-day em').evaluateAll(els=>els.filter(el=>el.offsetParent&&parseFloat(getComputedStyle(el).fontSize)<12).map(el=>el.className||el.tagName));
    assert.deepEqual(tiny,[],`Testi sotto 12px a ${tag}`);
    await page.screenshot({path:path.join(artifacts,`calendar-${tag}.png`)});
  }
  // Pulsanti raggruppati, etichetta del selettore, menu secondario con più voci per l'amministratore
  assert.equal(await page.locator('.heading-actions button').count(),2);
  assert.equal(await page.locator('.scope-picker span').innerText(),'Mostra');
  assert.ok(await page.locator('.section-navigation [data-nav]').count()>=2);
  // Un giorno non lavorativo spegne gli orari
  const monday=page.locator('.weekly-row').first();
  await monday.locator('input[type=checkbox]').uncheck();
  assert.ok(Number(await monday.locator('.shift-inputs').evaluate(el=>getComputedStyle(el).opacity))<1);
  assert.deepEqual(errors,[]);
  console.log('PASS calendario: sette giorni senza scorrimento, fasce affiancate, mese intero, testi ≥12px, pulsanti raggruppati.');
}finally{
  await browser?.close();
  if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}
  rmSync(temp,{recursive:true,force:true});
}
