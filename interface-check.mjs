// Read-only visual/keyboard checks across console views, on a disposable database.
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(join(tmpdir(),'aloven-interface-'));
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
let browser;
try{
 const base=await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',chunk=>{out+=chunk;const match=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.on('exit',()=>reject(new Error('Server terminated')));});
 browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.goto(base);await page.getByLabel('Nome e cognome').fill('Verifica interfacce');await page.getByLabel('Nome utente',{exact:true}).fill('interface');await page.getByLabel('Password',{exact:true}).fill('InterfaceTest123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
 mkdirSync('.artifacts',{recursive:true});
 const groups={machines:'catalogues',types:'catalogues',articles:'catalogues',setupRules:'catalogues',scrapReasons:'catalogues',machineStopReasons:'catalogues',calendar:'settings',users:'settings'};
 const navigate=async view=>{if(groups[view])await page.locator(`[data-nav-group="${groups[view]}"]`).click();await page.locator(`[data-nav="${view}"]`).click();};
 const primary=page.locator('.sidebar nav[aria-label="Menu principale"] > button');
 assert.equal(await primary.count(),6,'Il menu principale deve avere sei voci');
 assert.equal(await page.locator('.sidebar nav[aria-label="Menu principale"] > button[data-nav]').count(),4,'Solo quattro voci principali devono navigare direttamente');
 assert.equal(await page.locator('.sidebar nav[aria-label="Menu principale"] > button[data-nav-group]').count(),2,'Devono esserci due gruppi principali');
 assert.deepEqual((await primary.allTextContents()).map(text=>text.trim()),['Pianificazione','Attività','Bordo macchina','Statistiche','Anagrafiche','Configurazione']);
 const childForms={machines:'Nuova macchina',types:'Nuova tipologia',articles:'Nuovo articolo',setupRules:'Nuova regola',scrapReasons:'Nuova causale',machineStopReasons:'Nuova causale',calendar:'Imposta periodo',users:'Nuovo utente'};
 for(const [view,action] of Object.entries(childForms)){
  await navigate(view);assert.equal(await page.locator('.section-navigation [data-nav]').count(),groups[view]==='catalogues'?6:2,`${view}: menu secondario`);
  const trigger=page.getByRole('button',{name:action,exact:true});assert.equal(await trigger.count(),1,`${view}: form raggiungibile`);await trigger.click();await page.locator('#modal').waitFor({state:'visible'});await page.getByRole('button',{name:'Chiudi',exact:true}).click();
 }
 for(const profile of [{width:1920,height:1080},{width:1366,height:768}])for(const zoom of [1,1.25]){
  await page.setViewportSize({width:Math.floor(profile.width/zoom),height:Math.floor(profile.height/zoom)});await navigate('planning');
  assert.ok(await page.locator('.sidebar').evaluate(el=>el.scrollHeight<=el.clientHeight+1),`Sidebar con scroll a ${profile.width}x${profile.height}, zoom ${zoom*100}%`);
  assert.ok(await page.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),`Planning con scroll pagina a ${profile.width}x${profile.height}, zoom ${zoom*100}%`);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Planning con overflow orizzontale a ${profile.width}x${profile.height}, zoom ${zoom*100}%`);
  await page.locator('[data-select-task]').first().click();
  assert.ok(await page.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),'Riepilogo selezionato senza scroll pagina');
  assert.ok(await page.locator('.timeline-scroll').evaluate(el=>el.clientHeight>=180),'Timeline utilizzabile anche con riepilogo aperto');
  await page.getByRole('button',{name:'Chiudi riepilogo attività'}).click();
 }
 await page.locator('#planning-options > summary').click();await page.getByLabel('Densità schede').selectOption('compact');assert.ok(await page.locator('#planning-options').evaluate(el=>el.open),'Opzioni restano aperte durante modifica');await page.getByLabel('Densità schede').press('Escape');assert.equal(await page.locator('#planning-options').evaluate(el=>el.open),false);
 const views=['planning','tasks','machines','types','articles','setupRules','scrapReasons','machineStopReasons','calendar','users'];
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  for(const view of views){
   await navigate(view);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${view}: overflow ${width}`);
   const refresh=page.locator('#refresh');await page.keyboard.press('Tab');await refresh.focus();
   assert.equal(await refresh.evaluate(el=>getComputedStyle(el).outlineStyle),'solid',`${view}: keyboard focus`);
   if(['planning','tasks','calendar','users'].includes(view))await page.screenshot({path:`.artifacts/interface-${view}-${width}.png`,fullPage:true});
  }
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Nuovo utente'}).click();await page.locator('#modal').waitFor({state:'visible'});
 assert.ok(await page.locator('#modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Form utente mobile');
 await page.screenshot({path:'.artifacts/interface-dialog-mobile.png',fullPage:true});await page.getByRole('button',{name:'Chiudi',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('Navigazione a 6 voci, gruppi, form e layout desktop/mobile verificati.');
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(temp,{recursive:true,force:true});}
