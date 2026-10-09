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

 const seed=spawn(process.execPath,['seed-history.mjs'],{env:{...process.env,DATA_DIR:temp},stdio:['ignore','ignore','pipe']});assert.equal((await once(seed,'exit'))[0],0);
 await page.locator('#refresh').click();const seeded=await(await page.request.get(base+'/api/state')).json();await page.waitForFunction(revision=>document.querySelector('.shell')?.dataset.revision===String(revision),seeded.revision);
 const groups={machines:'catalogues',types:'catalogues',articles:'catalogues',setupRules:'catalogues',scrapReasons:'catalogues',machineStopReasons:'catalogues',calendar:'settings',users:'settings'};
 const navigate=async view=>{if(groups[view])await page.locator('[data-nav-group="'+groups[view]+'"]').click();await page.locator('[data-nav="'+view+'"]').click();if(view==='statistics')await page.locator('.statistics-chart-grid').waitFor();};
 const views=['planning','tasks','machines','types','articles','setupRules','scrapReasons','machineStopReasons','calendar','users','statistics'];
 for(const profile of [{width:1920,height:1080},{width:1366,height:768},{width:1093,height:614}]){
 await page.setViewportSize(profile);
 for(const view of views){await navigate(view);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),view+' horizontal');assert.ok(await page.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),view+' outer scroll '+profile.width);const body=page.locator(view==='planning'?'.dispatch-plan':'.console-content');assert.ok(await body.evaluate(el=>el.clientHeight>=180),view+' usable body');if(view==='calendar'){const save=await page.getByRole('button',{name:'Salva settimana',exact:true}).boundingBox();assert.ok(save&&save.y+save.height<=profile.height,'Weekly save visible '+profile.width);}if(profile.width===1366)await page.screenshot({path:'.artifacts/premium-'+view+'.png',fullPage:true});}
 }
 await navigate('tasks');assert.equal(await page.locator('tbody tr').count(),25);const first=await page.locator('tbody tr').first().innerText();await page.locator('#list-next').click();assert.notEqual(await page.locator('tbody tr').first().innerText(),first);await page.getByLabel('Cerca attività',{exact:true}).fill('nessun-risultato-premium');assert.match(await page.locator('tbody').innerText(),/Nessun elemento/);await page.getByLabel('Cerca attività',{exact:true}).fill(seeded.tasks.at(-1).title);assert.ok(await page.locator('tbody tr').count()>0);assert.match(await page.locator('.list-pagination').innerText(),/^1/);await page.getByLabel('Cerca attività',{exact:true}).fill('');await page.getByLabel('Righe per pagina').selectOption('50');assert.equal(await page.locator('tbody tr').count(),50);
 const forms={tasks:'Nuova attività',machines:'Nuova macchina',types:'Nuova tipologia',articles:'Nuovo articolo',setupRules:'Nuova regola',scrapReasons:'Nuova causale',machineStopReasons:'Nuova causale',users:'Nuovo utente',calendar:'Imposta periodo'};
 for(const [view,label]of Object.entries(forms)){await navigate(view);await page.getByRole('button',{name:label,exact:true}).click();await page.locator('#modal').waitFor({state:'visible'});const input=page.locator('#modal input:not([type=hidden]),#modal select').first();if(await input.count())await input.focus();const box=await page.locator('#modal [type=submit]').boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=614,view+' visible save');assert.ok(await page.locator('#modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),view+' modal width');if(view==='tasks')await page.screenshot({path:'.artifacts/premium-task-dialog.png',fullPage:true});await page.getByRole('button',{name:'Chiudi',exact:true}).click();}
 await navigate('articles');await page.getByRole('button',{name:'Nuovo articolo',exact:true}).click();await page.getByLabel('Codice articolo',{exact:true}).fill('ZZ-PREMIUM-NAV');await page.getByLabel('Descrizione articolo',{exact:true}).fill('Articolo prova navigazione dopo salvataggio');await page.getByRole('button',{name:'Salva',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#modal').open||document.querySelector('#modal h2')?.textContent==='Conferma la modifica');if(await page.getByRole('button',{name:'Conferma e salva'}).isVisible())await page.getByRole('button',{name:'Conferma e salva'}).click();await page.locator('#modal').waitFor({state:'hidden'});await page.getByRole('row').filter({hasText:'ZZ-PREMIUM-NAV'}).waitFor();assert.ok(await page.getByRole('row').filter({hasText:'ZZ-PREMIUM-NAV'}).getByRole('button',{name:'Modifica'}).evaluate(el=>document.activeElement===el),'Saved item revealed and focused');
 await page.setViewportSize({width:390,height:844});for(const view of views){await navigate(view);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),view+' mobile overflow');}
 assert.deepEqual(errors,[]);console.log('PASS premium: 33 desktop views, 11 mobile views, 9 forms, historical paging/search/empty.');
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(temp,{recursive:true,force:true});}
