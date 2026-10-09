import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const { chromium }=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-operational-'));
const artifacts=path.resolve('.artifacts');mkdirSync(artifacts,{recursive:true});
const results=[];let shot=0,browser,child,base,page;
const stamp=()=>new Date().toISOString();
async function screenshot(name,p=page){const file=path.join(artifacts,`operational-${String(++shot).padStart(2,'0')}-${name}.png`);await p.screenshot({path:file,fullPage:true});return path.relative(process.cwd(),file);}
async function test(name,fn){const started=Date.now();try{await fn();results.push({name,status:'passed',durationMs:Date.now()-started});console.log(`PASS ${name}`);}catch(error){let image=null;try{image=await screenshot(`failure-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`);}catch{}results.push({name,status:'failed',durationMs:Date.now()-started,error:error.stack||String(error),screenshot:image});console.error(`FAIL ${name}: ${error.message}`);}}
const state=async(p=page)=>p.evaluate(async()=>{const r=await fetch('/api/state');if(!r.ok)throw new Error(`state ${r.status}`);return r.json();});
const nav=async(name,p=page)=>{await p.locator(`[data-nav="${name}"]`).click();};
async function confirmPreview(p=page){const heading=p.getByRole('heading',{name:'Conferma la modifica'});if(await heading.isVisible().catch(()=>false)){await p.getByRole('button',{name:'Conferma e salva'}).click();await p.locator('#modal').waitFor({state:'hidden'});}}
async function cancelPreview(p=page){await p.getByRole('heading',{name:'Conferma la modifica'}).waitFor();await p.locator('#modal').getByRole('button',{name:'Annulla',exact:true}).click();await p.locator('#modal').waitFor({state:'hidden'});}
async function settleMutation(p=page,{confirm=true}={}){
  await p.waitForFunction(()=>!document.querySelector('#modal')?.open||document.querySelector('#modal h2')?.textContent==='Conferma la modifica'||Boolean(document.querySelector('#modal .dialog-error:not([hidden])')));
  if(await p.locator('.dialog-error:not([hidden])').isVisible().catch(()=>false))throw new Error(await p.locator('.dialog-error:not([hidden])').textContent());
  if(await p.getByRole('heading',{name:'Conferma la modifica'}).isVisible().catch(()=>false)){if(confirm)await confirmPreview(p);else await cancelPreview(p);}
  else if(await p.locator('#modal').isVisible().catch(()=>false))await p.locator('#modal').waitFor({state:'hidden'});
}
async function saveModal(p=page,label='Salva'){
  await p.locator('#modal').getByRole('button',{name:label,exact:true}).click();
  await p.waitForFunction(()=>!document.querySelector('#modal')?.open||document.querySelector('#modal h2')?.textContent==='Conferma la modifica'||Boolean(document.querySelector('#modal .dialog-error:not([hidden])')));
  if(await p.locator('.dialog-error:not([hidden])').isVisible().catch(()=>false))throw new Error(await p.locator('.dialog-error:not([hidden])').textContent());
  await confirmPreview(p);if(await p.locator('#modal').isVisible().catch(()=>false))await p.locator('#modal').waitFor({state:'hidden'});
}
async function article(code,description,unit='m',kind='product'){
  await nav('articles');await page.getByRole('button',{name:'Nuovo articolo'}).click();
  await page.getByLabel('Codice articolo').fill(code);await page.getByLabel('Descrizione articolo').fill(description);
  await page.getByLabel('Unità di misura').selectOption(unit);await page.getByLabel('Utilizzo').selectOption(kind);await saveModal();
}
async function createTask(productLabel,{machine='CNC-01',setup=20,run=90,automatic=false,quantity=''}={}){
  await nav('planning');await page.getByRole('button',{name:'Nuova attività',exact:true}).click();
  assert.equal(await page.getByLabel('Titolo attività').count(),0);
  await page.getByLabel('Prodotto da realizzare').selectOption({label:productLabel});
  await page.getByLabel('Macchina',{exact:true}).selectOption(machine);
  await page.getByLabel('Attrezzaggio (minuti)').fill(String(setup));await page.getByLabel('Esecuzione (minuti)').fill(String(run));
  const componentA=await page.getByLabel('Componente 1',{exact:true}).locator('option').filter({hasText:'COMP-A'}).getAttribute('value');
  const componentB=await page.getByLabel('Componente 2',{exact:true}).locator('option').filter({hasText:'COMP-B'}).getAttribute('value');
  await page.getByLabel('Componente 1',{exact:true}).selectOption(componentA);await page.getByLabel('Componente 2',{exact:true}).selectOption(componentB);
  if(quantity)await page.getByLabel('Quantità da produrre').fill(String(quantity));
  if(automatic)await page.getByLabel('Calcolo del tempo').selectOption('automatic');
  await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).click();
  if(await page.locator('.dialog-error:not([hidden])').isVisible().catch(()=>false))throw new Error(await page.locator('.dialog-error').textContent());
  await confirmPreview();if(await page.locator('#modal').isVisible().catch(()=>false))await page.locator('#modal').waitFor({state:'hidden'});
  return (await state()).tasks.find(t=>t.productDescription===productLabel.match(/ · (.*?) \(/)?.[1]);
}
async function openTask(id,p=page){const task=(await state(p)).tasks.find(t=>t.id===id);assert.ok(task,`Attività ${id} non trovata`);await nav('tasks',p);await p.getByRole('row').filter({hasText:task.title}).getByRole('button',{name:'Apri'}).click();}
async function planTask(id,beforeId=''){
  await openTask(id);await page.getByLabel('Posizione nella sequenza').selectOption(beforeId);await page.getByRole('button',{name:'Pianifica',exact:true}).click();await settleMutation();
}
async function moveTask(id,beforeId,confirm=true){await openTask(id);await page.getByLabel('Posizione nella sequenza').selectOption(beforeId);await page.getByRole('button',{name:'Sposta',exact:true}).click();await settleMutation(page,{confirm});}

const report={startedAt:stamp(),dataDir:temp,headless:process.env.HEADFUL!=='1',browser:'Microsoft Edge',results};
try{
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);child.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.stderr.on('data',c=>process.stderr.write(c));child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Server exit ${code}`));});});
  browser=await chromium.launch({headless:process.env.HEADFUL!=='1',channel:'msedge'});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();
  await page.goto(base);await page.getByRole('heading',{name:'Configura il tuo reparto'}).waitFor();
  await page.getByLabel('Nome e cognome').fill('Amministratore operativo');await page.getByLabel('Nome utente',{exact:true}).fill('adminop');await page.getByLabel('Password',{exact:true}).fill('PasswordTest123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();

  await test('catalogo: articoli distintivi e ruoli',async()=>{
    await article('COMP-A','Componente operativo A','m','component');await article('COMP-B','Componente operativo B','m','component');
    await article('PROD-A','Prodotto operativo Alfa','m');await article('PROD-B','Prodotto operativo Beta','m');await article('PROD-C','Prodotto operativo Gamma','m');await article('PROD-KG','Prodotto incompatibile','kg');
    const s=await state();assert.equal(s.articles.filter(a=>a.code.startsWith('PROD-')).length,4);await screenshot('catalogue');
  });

  let a,b,c;
  await test('attività: creazione da prodotto con identità unica',async()=>{
    a=await createTask('PROD-A · Prodotto operativo Alfa (m lineari)',{setup:30,run:540});
    b=await createTask('PROD-B · Prodotto operativo Beta (m lineari)',{setup:20,run:120});
    c=await createTask('PROD-C · Prodotto operativo Gamma (m lineari)',{setup:15,run:75});
    assert.ok(a&&b&&c);assert.deepEqual(new Set([a.title,b.title,c.title]).size,3);
  });

  await test('attività: modifica durata manuale',async()=>{
    await nav('tasks');const row=page.getByRole('row').filter({hasText:'Prodotto operativo Beta'});await row.getByRole('button',{name:'Modifica'}).click();await page.getByLabel('Esecuzione (minuti)').fill('150');await saveModal();
    b=(await state()).tasks.find(t=>t.id===b.id);assert.equal(b.runMinutes,150);
  });

  await test('pianificazione: trascinamento con anteprima obbligatoria',async()=>{
    await nav('planning');const card=page.locator(`.backlog [data-task="${a.id}"]`),drop=page.locator('[data-drop-machine="CNC-01"]').first();await card.dragTo(drop,{targetPosition:{x:80,y:50}});
    await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();await page.getByRole('button',{name:'Conferma e salva'}).click();await page.locator('#modal').waitFor({state:'hidden'});assert.equal((await state()).tasks.find(t=>t.id===a.id).status,'planned');
  });

  await test('pianificazione: assegnazione da dettaglio',async()=>{await planTask(b.id);await planTask(c.id);const seq=(await state()).tasks.filter(t=>t.machineId==='CNC-01'&&t.position!==null).sort((x,y)=>x.position-y.position);assert.deepEqual(seq.slice(-3).map(t=>t.id),[a.id,b.id,c.id]);});

  await test('sequenza: annullamento anteprima non modifica i dati',async()=>{
    const before=await state();await moveTask(c.id,a.id,false);const after=await state();assert.equal(after.revision,before.revision);assert.deepEqual(after.tasks.find(t=>t.id===c.id),before.tasks.find(t=>t.id===c.id));
  });

  await test('sequenza: spostamenti primo, centrale e ultimo',async()=>{
    await moveTask(c.id,a.id,true);let seq=(await state()).tasks.filter(t=>t.machineId==='CNC-01'&&t.position!==null).sort((x,y)=>x.position-y.position);assert.deepEqual(seq.slice(-3).map(t=>t.id),[c.id,a.id,b.id]);
    await moveTask(c.id,b.id,true);seq=(await state()).tasks.filter(t=>t.machineId==='CNC-01'&&t.position!==null).sort((x,y)=>x.position-y.position);assert.deepEqual(seq.slice(-3).map(t=>t.id),[a.id,c.id,b.id]);
    await moveTask(c.id,'',true);seq=(await state()).tasks.filter(t=>t.machineId==='CNC-01'&&t.position!==null).sort((x,y)=>x.position-y.position);assert.deepEqual(seq.slice(-3).map(t=>t.id),[a.id,b.id,c.id]);await screenshot('sequence');
  });

  await test('attività: torna da assegnare, annulla e ripristina',async()=>{
    await openTask(b.id);await page.getByRole('button',{name:'Torna da assegnare'}).click();await settleMutation();assert.equal((await state()).tasks.find(t=>t.id===b.id).status,'unplanned');
    await openTask(b.id);await page.getByRole('button',{name:'Annulla attività'}).click();await settleMutation();assert.equal((await state()).tasks.find(t=>t.id===b.id).status,'cancelled');
    await nav('tasks');await page.getByRole('row').filter({hasText:'Prodotto operativo Beta'}).getByRole('button',{name:'Apri'}).click();await page.getByRole('button',{name:'Ripristina attività'}).click();await settleMutation();assert.equal((await state()).tasks.find(t=>t.id===b.id).status,'unplanned');
  });

  await test('attività: cambio macchina valido e reset pianificazione',async()=>{
    await nav('tasks');await page.getByRole('row').filter({hasText:'Prodotto operativo Beta'}).getByRole('button',{name:'Modifica'}).click();await page.getByLabel('Macchina',{exact:true}).selectOption('TOR-02');await saveModal();b=(await state()).tasks.find(t=>t.id===b.id);assert.equal(b.machineId,'TOR-02');assert.equal(b.position,null);
  });

  await test('validazione: unità automatica incompatibile rifiutata',async()=>{
    const before=await state();await nav('planning');await page.getByRole('button',{name:'Nuova attività'}).click();await page.getByLabel('Prodotto da realizzare').selectOption({label:'PROD-KG · Prodotto incompatibile (kg)'});await page.getByLabel('Macchina',{exact:true}).selectOption('CNC-01');const compA=await page.getByLabel('Componente 1',{exact:true}).locator('option').filter({hasText:'COMP-A'}).getAttribute('value'),compB=await page.getByLabel('Componente 2',{exact:true}).locator('option').filter({hasText:'COMP-B'}).getAttribute('value');await page.getByLabel('Componente 1',{exact:true}).selectOption(compA);await page.getByLabel('Componente 2',{exact:true}).selectOption(compB);await page.getByLabel('Quantità da produrre').fill('100');await page.getByLabel('Calcolo del tempo').selectOption('automatic');assert.match(await page.locator('#calculation-summary').textContent(),/Unità incompatibili/);await page.locator('#modal').getByRole('button',{name:'Salva'}).click();await page.locator('.dialog-error:not([hidden])').waitFor();assert.match(await page.locator('.dialog-error').textContent(),/non coincide/);await page.getByRole('button',{name:'Chiudi'}).click();assert.equal((await state()).revision,before.revision);
  });

  await test('calendario: lavorazione lunga distribuita e giorno di chiusura saltato',async()=>{
    await nav('tasks');await page.getByRole('row').filter({hasText:'Prodotto operativo Gamma'}).getByRole('button',{name:'Modifica'}).click();await page.getByLabel('Esecuzione (minuti)').fill('1100');await saveModal();
    const long=(await state()).tasks.find(t=>t.id===c.id),run=long.segments.filter(s=>s.kind==='run');assert.equal(long.segments.filter(s=>s.kind==='setup').length,1);assert.ok(new Set(run.map(s=>s.start.slice(0,10))).size>=3);
    const total=run.reduce((sum,s)=>sum+(Date.parse(s.end+'Z')-Date.parse(s.start+'Z'))/60000,0);assert.equal(total,1100);assert.ok(run.every(s=>![0,6].includes(new Date(s.start.slice(0,10)+'T12:00Z').getUTCDay())));
    const first=run[0].start.slice(0,10),closed=run.find(s=>s.start.slice(0,10)!==first).start.slice(0,10);await nav('calendar');await page.getByRole('button',{name:'Imposta periodo'}).click();const dialog=page.locator('#modal');await dialog.getByLabel('Dal',{exact:true}).fill(closed);await dialog.getByLabel('Al',{exact:true}).fill(closed);await dialog.getByLabel('Giorno lavorativo',{exact:true}).uncheck();await dialog.getByRole('button',{name:'Salva eccezioni'}).click();await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();await confirmPreview();const changed=(await state()).tasks.find(t=>t.id===c.id);assert.ok(changed.segments.every(s=>s.start.slice(0,10)!==closed));assert.ok(changed.end>long.end);assert.equal(changed.segments.filter(s=>s.kind==='setup').length,1);await screenshot('long-run-closure');
  });

  await test('attrezzaggio impossibile rifiutato senza alterare la sequenza',async()=>{
    const before=await state();await nav('tasks');await page.getByRole('row').filter({hasText:'Prodotto operativo Gamma'}).getByRole('button',{name:'Modifica'}).click();await page.getByLabel('Attrezzaggio (minuti)').fill('600');await page.locator('#modal').getByRole('button',{name:'Salva',exact:true}).click();await page.locator('.dialog-error:not([hidden])').waitFor();assert.match(await page.locator('.dialog-error').textContent(),/attrezz|fascia|turno/i);await page.getByRole('button',{name:'Chiudi',exact:true}).click();const after=await state();assert.equal(after.revision,before.revision);assert.deepEqual(after.tasks,before.tasks);
  });

  await test('calendario: sovrapposizione rifiutata senza modifica',async()=>{
    const before=await state();await nav('calendar');await page.getByRole('button',{name:'Imposta periodo'}).click();const dialog=page.locator('#modal');await dialog.getByLabel('Dal',{exact:true}).fill(new Date().toISOString().slice(0,10));await dialog.getByLabel('Al',{exact:true}).fill(new Date().toISOString().slice(0,10));await dialog.getByLabel('Inizio fascia 1').fill('08:00');await dialog.getByLabel('Fine fascia 1').fill('14:00');await dialog.getByLabel('Inizio fascia 2').fill('13:00');await dialog.getByLabel('Fine fascia 2').fill('17:00');await dialog.getByRole('button',{name:'Salva eccezioni'}).click();await dialog.locator('.dialog-error').waitFor();assert.match(await dialog.locator('.dialog-error').textContent(),/sovrapporsi/);await dialog.getByRole('button',{name:'Chiudi'}).click();assert.equal((await state()).revision,before.revision);
  });

  await test('calendario: eccezione su periodo pianificato ricalcola inizio e fine',async()=>{
    const old=(await state()).tasks.find(t=>t.id===a.id);assert.ok(old.start&&old.end);const d=old.start.slice(0,10);await nav('calendar');await page.getByRole('button',{name:'Imposta periodo'}).click();const dialog=page.locator('#modal');await dialog.getByLabel('Dal',{exact:true}).fill(d);await dialog.getByLabel('Al',{exact:true}).fill(d);await dialog.getByLabel('Inizio fascia 1').fill('10:00');await dialog.getByLabel('Fine fascia 1').fill('12:00');await dialog.getByLabel('Inizio fascia 2').fill('13:00');await dialog.getByLabel('Fine fascia 2').fill('16:00');await dialog.getByRole('button',{name:'Salva eccezioni'}).click();await page.getByRole('heading',{name:'Conferma la modifica'}).waitFor();assert.ok(await page.locator('.change-list').count());await confirmPreview();const changed=(await state()).tasks.find(t=>t.id===a.id);assert.notEqual(changed.start,old.start);assert.notEqual(changed.end,old.end);assert.equal(changed.segments.filter(s=>s.kind==='setup').length,1);assert.ok(changed.segments.every(s=>![0,6].includes(new Date(s.start.slice(0,10)+'T12:00Z').getUTCDay())));await screenshot('calendar-replanned');
  });

  await test('concorrenza: form obsoleto rifiutato e stato integro',async()=>{
    const p2=await context.newPage();await p2.goto(base);await p2.getByRole('heading',{name:'Piano di produzione'}).waitFor();await nav('tasks');await page.getByRole('row').filter({hasText:'Prodotto operativo Gamma'}).getByRole('button',{name:'Modifica'}).click();
    await nav('tasks',p2);await p2.getByRole('row').filter({hasText:'Prodotto operativo Beta'}).getByRole('button',{name:'Modifica'}).click();await p2.getByLabel('Note').fill('Modifica concorrente valida');await saveModal(p2);
    await page.getByLabel('Note').fill('Modifica da form obsoleto');await page.locator('#modal').getByRole('button',{name:'Salva'}).click();await page.locator('.dialog-error').waitFor();assert.match(await page.locator('.dialog-error').textContent(),/dati sono cambiati/i);const current=await state(p2);assert.equal(current.tasks.find(t=>t.id===c.id).notes,'');assert.equal(current.tasks.find(t=>t.id===b.id).notes,'Modifica concorrente valida');await screenshot('concurrency-rejection');await page.getByRole('button',{name:'Chiudi'}).click();await p2.close();await page.getByRole('button',{name:'Aggiorna'}).click();
  });

  let lockedTask;
  await test('blocco attività in corso: modifica, spostamento e cancellazione non esposti',async()=>{
    await page.goto(base+'/bordo-macchina?machine=CNC-01');await page.getByLabel('Postazione macchina').selectOption('CNC-01');await page.locator('[data-shop-action="start_setup"]').click();await page.locator('#modal').getByRole('button',{name:'Conferma'}).click();await page.locator('#modal').waitFor({state:'hidden'});await page.goto(base);await page.getByRole('heading',{name:'Piano di produzione'}).waitFor();lockedTask=(await state()).tasks.find(t=>t.machineId==='CNC-01'&&t.status==='in_progress');assert.ok(lockedTask);await openTask(lockedTask.id);assert.equal(await page.getByRole('button',{name:/Modifica attività|Sposta|Torna da assegnare|Annulla attività/}).count(),0);await page.getByRole('button',{name:'Chiudi'}).click();await nav('tasks');const row=page.getByRole('row').filter({hasText:lockedTask.title});assert.equal(await row.getByRole('button',{name:'Modifica'}).count(),0);assert.equal(await row.getByRole('button',{name:'Elimina'}).count(),0);await screenshot('locked-running');
  });

  await test('calendario: chiusura in conflitto con attività in corso rifiutata',async()=>{
    const before=await state(),original=before.tasks.find(t=>t.id===lockedTask.id),date=original.segments[0].start.slice(0,10);await nav('calendar');await page.getByRole('button',{name:'Imposta periodo'}).click();const dialog=page.locator('#modal');await dialog.getByLabel('Dal',{exact:true}).fill(date);await dialog.getByLabel('Al',{exact:true}).fill(date);await dialog.getByLabel('Giorno lavorativo',{exact:true}).uncheck();await dialog.getByRole('button',{name:'Salva eccezioni'}).click();await dialog.locator('.dialog-error:not([hidden])').waitFor();assert.match(await dialog.locator('.dialog-error').textContent(),/corso|blocc|calendario|fascia/i);await screenshot('calendar-locked-conflict');await dialog.getByRole('button',{name:'Chiudi'}).click();const after=await state(),current=after.tasks.find(t=>t.id===lockedTask.id);assert.equal(after.revision,before.revision);assert.equal(current.start,original.start);assert.equal(current.end,original.end);assert.deepEqual(current.segments,original.segments);
  });

  await test('permessi operatore: utenti assenti e calendario in sola lettura',async()=>{
    await nav('users');await page.getByRole('button',{name:'Nuovo utente'}).click();await page.getByLabel('Nome e cognome').fill('Operatore prova');await page.getByLabel('Nome utente').fill('operatore');await page.getByLabel('Password').fill('PasswordTest123!');await saveModal();
    const ctx=await browser.newContext({viewport:{width:1280,height:900}}),op=await ctx.newPage();await op.goto(base);await op.getByLabel('Nome utente').fill('operatore');await op.getByLabel('Password').fill('PasswordTest123!');await op.getByRole('button',{name:'Accedi'}).click();await op.getByRole('heading',{name:'Piano di produzione'}).waitFor();assert.equal(await op.locator('[data-nav="users"]').count(),0);await op.locator('[data-nav="calendar"]').click();assert.equal(await op.getByRole('button',{name:'Imposta periodo'}).count(),0);assert.ok(await op.locator('#weekly-form fieldset').evaluate(el=>el.hasAttribute('disabled')));await screenshot('operator-readonly',op);await ctx.close();
  });
} catch(error){results.push({name:'bootstrap',status:'failed',error:error.stack||String(error)});console.error(error);} finally {
  report.finishedAt=stamp();report.summary={passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,total:results.length};
  writeFileSync(path.join(artifacts,'operational-report.json'),JSON.stringify(report,null,2));
  await browser?.close();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(temp,{recursive:true,force:true});
}
if(report.summary.failed)process.exitCode=1;else console.log(`Operational suite: ${report.summary.passed}/${report.summary.total} passed`);
