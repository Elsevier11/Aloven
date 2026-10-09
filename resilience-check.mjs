import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-browser-resilience-'));
const artifacts=path.resolve('.artifacts');
mkdirSync(artifacts,{recursive:true});
const results=[],screenshots=[];
let browser,child,context,page,base,shot=0;
const stamp=()=>new Date().toISOString();
const report={startedAt:stamp(),dataDir:temp,headless:process.env.HEADFUL!=='1',browser:'Microsoft Edge',results,screenshots};

async function screenshot(name,target=page){
  const file=path.join(artifacts,`resilience-${String(++shot).padStart(2,'0')}-${name}.png`);
  await target.screenshot({path:file,fullPage:true});
  const relative=path.relative(process.cwd(),file);screenshots.push(relative);return relative;
}
async function test(name,fn){
  const started=Date.now();
  try{await fn();results.push({name,status:'passed',durationMs:Date.now()-started});console.log(`PASS ${name}`);}
  catch(error){let image=null;try{image=await screenshot(`failure-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`);}catch{}results.push({name,status:'failed',durationMs:Date.now()-started,error:error.stack||String(error),screenshot:image});console.error(`FAIL ${name}: ${error.message}`);}
}
const state=async(target=page)=>target.evaluate(async()=>{const response=await fetch('/api/state');if(!response.ok)throw new Error(`state ${response.status}`);return response.json();});
const navGroups={machines:'catalogues',types:'catalogues',articles:'catalogues',setupRules:'catalogues',scrapReasons:'catalogues',machineStopReasons:'catalogues',calendar:'settings',users:'settings'};
const nav=async(name,target=page)=>{if(navGroups[name])await target.locator(`[data-nav-group="${navGroups[name]}"]`).click();await target.locator(`[data-nav="${name}"]`).click();};
async function openTask(task,target=page){
  await nav('tasks',target);await target.getByLabel('Cerca attività',{exact:true}).fill(task.title);
  await target.getByRole('row').filter({hasText:task.title}).getByRole('button',{name:'Apri'}).click();
}
async function editTask(task,target=page){
  await nav('tasks',target);await target.getByLabel('Cerca attività',{exact:true}).fill(task.title);
  await target.getByRole('row').filter({hasText:task.title}).getByRole('button',{name:'Modifica'}).click();
}
async function waitMutation(target=page){
  await target.waitForFunction(()=>!document.querySelector('#modal')?.open||document.querySelector('#modal h2')?.textContent==='Conferma la modifica'||Boolean(document.querySelector('#modal .dialog-error:not([hidden])')));
}
async function planTask(task,target=page){
  await openTask(task,target);
  await target.getByRole('button',{name:'Pianifica',exact:true}).click();
  await waitMutation(target);
  if(await target.getByRole('heading',{name:'Conferma la modifica'}).isVisible().catch(()=>false))await target.getByRole('button',{name:'Conferma e salva'}).click();
  await target.locator('#modal').waitFor({state:'hidden'});
}

try{
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Avvio server scaduto: ${output}`)),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>process.stderr.write(chunk));child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server terminato: ${code} ${output}`));});});
  browser=await chromium.launch({headless:process.env.HEADFUL!=='1',channel:'msedge'});
  context=await browser.newContext({viewport:{width:1440,height:1000}});
  page=await context.newPage();
  await page.goto(base);
  await page.getByRole('heading',{name:'Configura il tuo reparto'}).waitFor();
  await page.getByLabel('Nome e cognome').fill('Admin resilienza');
  await page.getByLabel('Nome utente',{exact:true}).fill('admin');
  await page.getByLabel('Password',{exact:true}).fill('PasswordTest123!');
  await page.getByRole('button',{name:'Crea amministratore'}).click();
  await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();

  let tasks=(await state()).tasks.filter(task=>task.machineId==='CNC-01'&&task.status==='unplanned');
  assert.ok(tasks.length>=4,'Servono almeno quattro attività iniziali non pianificate su CNC-01');

  await test('offline: errore visibile e form recuperabile',async()=>{
    const task=tasks[0],before=await state();
    await editTask(task);
    await page.getByLabel('Note').fill('Valore conservato durante offline');
    await context.setOffline(true);
    await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).click();
    await page.locator('#modal .dialog-error:not([hidden])').waitFor();
    await context.setOffline(false);
    assert.equal(await page.getByLabel('Note').inputValue(),'Valore conservato durante offline');
    assert.ok(await page.locator('#modal').evaluate(dialog=>dialog.open));
    assert.ok(await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).isEnabled());
    assert.equal((await state()).revision,before.revision);
    await screenshot('offline-form-recoverable');
    await page.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();
  });

  await test('risposta commit persa: un solo salvataggio recuperato al reload',async()=>{
    const task=tasks[0],before=await state();
    let commits=0;
    await page.route('**/api/commit',async route=>{commits++;await route.fetch();await route.abort('failed');});
    await editTask(task);
    await page.getByLabel('Note').fill('Commit confermato dal server');
    await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).click();
    await page.locator('#modal .dialog-error:not([hidden])').waitFor();
    assert.equal(commits,1);
    await page.unroute('**/api/commit');
    await page.reload();
    await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
    const after=await state();
    assert.equal(after.revision,before.revision+1);
    assert.equal(after.tasks.find(item=>item.id===task.id).notes,'Commit confermato dal server');
    assert.equal(after.tasks.filter(item=>item.id===task.id).length,1);
    await screenshot('lost-response-recovered');
  });

  await test('doppio clic sulla conferma: nessun duplicato',async()=>{
    let task=(await state()).tasks.find(item=>item.id===tasks[1].id);
    await planTask(task);
    task=(await state()).tasks.find(item=>item.id===task.id);
    const before=await state();let commits=0;
    await page.route('**/api/commit',async route=>{commits++;await route.continue();});
    await editTask(task);
    await page.getByLabel('Esecuzione (minuti)').fill(String(task.runMinutes+7));
    await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).click();
    await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();
    await page.getByRole('button',{name:'Conferma e salva'}).dblclick();
    await page.locator('#modal').waitFor({state:'hidden'});
    await page.unroute('**/api/commit');
    const after=await state();
    assert.equal(commits,1);
    assert.equal(after.revision,before.revision+1);
    assert.equal(after.tasks.filter(item=>item.id===task.id).length,1);
    assert.equal(after.tasks.find(item=>item.id===task.id).runMinutes,task.runMinutes+7);
    await screenshot('double-confirm-single-write');
  });

  let secondPage;
  await test('due pagine sulla stessa sequenza: una sola modifica accettata',async()=>{
    const before=await state();
    const candidates=before.tasks.filter(task=>task.machineId==='CNC-01'&&task.status==='unplanned').slice(0,2);
    assert.equal(candidates.length,2);
    secondPage=await context.newPage();await secondPage.goto(base);await secondPage.getByRole('heading',{name:'Piano di produzione'}).waitFor();
    await openTask(candidates[0],page);await openTask(candidates[1],secondPage);
    let release;const gate=new Promise(resolve=>release=resolve);let commitHits=0;
    await context.route('**/api/commit',async route=>{commitHits++;if(commitHits===2)release();await gate;await route.continue();});
    await Promise.all([
      page.getByRole('button',{name:'Pianifica',exact:true}).click(),
      secondPage.getByRole('button',{name:'Pianifica',exact:true}).click()
    ]);
    await page.waitForFunction(()=>!document.querySelector('#modal')?.open||Boolean(document.querySelector('#modal .dialog-error:not([hidden])')));
    await secondPage.waitForFunction(()=>!document.querySelector('#modal')?.open||Boolean(document.querySelector('#modal .dialog-error:not([hidden])')));
    await context.unroute('**/api/commit');
    const after=await state(page),affected=after.tasks.filter(task=>candidates.some(candidate=>candidate.id===task.id)&&task.position!==null);
    assert.equal(commitHits,2);
    assert.equal(after.revision,before.revision+1);
    assert.equal(affected.length,1);
    assert.equal(new Set(after.tasks.filter(task=>task.machineId==='CNC-01'&&task.position!==null).map(task=>task.position)).size,after.tasks.filter(task=>task.machineId==='CNC-01'&&task.position!==null).length);
    const errors=Number(await page.locator('#modal .dialog-error:not([hidden])').isVisible().catch(()=>false))+Number(await secondPage.locator('#modal .dialog-error:not([hidden])').isVisible().catch(()=>false));
    assert.equal(errors,1);
    await screenshot('two-pages-one-sequence',await page.locator('#modal').isVisible().catch(()=>false)?page:secondPage);
  });

  await test('sessione invalidata durante il form: login pulito e nessuna scrittura',async()=>{
    await page.reload();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
    const before=await state(),task=before.tasks.find(item=>item.status==='unplanned');
    await editTask(task,page);await page.getByLabel('Note').fill('Questa modifica non deve essere salvata');
    await secondPage.reload();await secondPage.getByRole('heading',{name:'Piano di produzione'}).waitFor();
    await secondPage.getByRole('button',{name:'Esci'}).click();await secondPage.getByRole('heading',{name:'Accedi ad Aloven'}).waitFor();
    await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).click();
    await page.getByRole('heading',{name:'Accedi ad Aloven'}).waitFor();
    assert.equal(await page.locator('#modal').evaluate(dialog=>dialog.open),false);
    const login=await context.request.post(base+'/api/login',{headers:{'X-Aloven-Request':'1'},data:{username:'admin',password:'PasswordTest123!'}});assert.equal(login.status(),200);
    await page.reload();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();
    const after=await state();
    assert.equal(after.revision,before.revision);
    assert.notEqual(after.tasks.find(item=>item.id===task.id).notes,'Questa modifica non deve essere salvata');
    await screenshot('session-invalidated-no-write');
  });
}catch(error){results.push({name:'bootstrap',status:'failed',error:error.stack||String(error)});console.error(error);}
finally{
  report.finishedAt=stamp();report.summary={passed:results.filter(result=>result.status==='passed').length,failed:results.filter(result=>result.status==='failed').length,total:results.length};
  writeFileSync(path.join(artifacts,'resilience-report.json'),JSON.stringify(report,null,2));
  await browser?.close();
  if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}
  rmSync(temp,{recursive:true,force:true});
}
if(report.summary.failed)process.exitCode=1;else console.log(`Browser resilience suite: ${report.summary.passed}/${report.summary.total} passed`);
