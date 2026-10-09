import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scheduleMachine, validateCalendar } from './scheduler.mjs';
import { migrateTextile } from './textile.mjs';
import { migrateProduction } from './production.mjs';
import { migrateShopfloor, performShopfloorAction, shopfloorExecutions } from './shopfloor.mjs';
import { migrateQuality } from './quality.mjs';
import { machineStops, migrateDowntime, performMachineStopAction } from './downtime.mjs';
import { migrateReasonCatalogs, reasonCatalog, updateReasonCatalog } from './scrap-reasons.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'aloven.sqlite'));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','operator')));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS machines(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,description TEXT NOT NULL,anchor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS types(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,typeId TEXT NOT NULL REFERENCES types(id),machineId TEXT NOT NULL REFERENCES machines(id),setupMinutes INTEGER NOT NULL,runMinutes INTEGER NOT NULL,status TEXT NOT NULL,position INTEGER,start TEXT,end TEXT,segments TEXT NOT NULL DEFAULT '[]',notes TEXT NOT NULL DEFAULT '');`);
const uid = () => randomBytes(12).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
function passwordHash(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function passwordMatches(password, encoded) { const [salt, value] = encoded.split(':'); return timingSafeEqual(Buffer.from(value, 'hex'), scryptSync(password, salt, 64)); }
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
const weekly = {0:[],1:[['08:00','12:00'],['13:00','17:00']],2:[['08:00','12:00'],['13:00','17:00']],3:[['08:00','12:00'],['13:00','17:00']],4:[['08:00','12:00'],['13:00','17:00']],5:[['08:00','12:00'],['13:00','17:00']],6:[]};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
if (!db.prepare('SELECT 1 FROM meta WHERE key=?').get('revision')) {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO meta VALUES (?,?)').run('revision','1');
    db.prepare('INSERT INTO meta VALUES (?,?)').run('calendar',JSON.stringify({weekly,exceptions:{},machineExceptions:{}}));
    const machines = [['CNC-01','Centro di lavoro CNC','Fresatura e lavorazioni di precisione'],['TOR-02','Tornio automatico','Tornitura componenti'],['LAS-03','Taglio laser','Taglio lamiera']];
    for (const [id,name,description] of machines) db.prepare('INSERT INTO machines VALUES (?,?,?,?)').run(id,name,description,`${today}T08:00`);
    for (const [id,name,color] of [['fresatura','Fresatura','#2563eb'],['tornitura','Tornitura','#0891b2'],['taglio','Taglio','#a855f7']]) db.prepare('INSERT INTO types VALUES (?,?,?)').run(id,name,color);
    const samples = [['Staffa supporto · lotto 240','fresatura','CNC-01',30,180],['Piastra di fissaggio · lotto 241','fresatura','CNC-01',45,360],['Albero motore · lotto 118','tornitura','TOR-02',20,210],['Pannelli laterali · lotto 086','taglio','LAS-03',15,90]];
    for (const [title,typeId,machineId,setupMinutes,runMinutes] of samples) db.prepare('INSERT INTO tasks(id,title,typeId,machineId,setupMinutes,runMinutes,status) VALUES (?,?,?,?,?,?,?)').run(uid(),title,typeId,machineId,setupMinutes,runMinutes,'unplanned');
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
migrateTextile(db,`${today}T08:00`);
migrateProduction(db);
migrateShopfloor(db);
migrateQuality(db);
migrateDowntime(db);
migrateReasonCatalogs(db);
function snapshot() {
  return {revision:Number(db.prepare('SELECT value FROM meta WHERE key=?').get('revision').value),machines:db.prepare('SELECT * FROM machines ORDER BY name').all(),types:db.prepare('SELECT * FROM types ORDER BY name').all(),articles:db.prepare('SELECT * FROM articles ORDER BY code COLLATE NOCASE').all(),setupRules:db.prepare('SELECT * FROM setupRules ORDER BY machineId,fromTypeId,toTypeId').all(),scrapReasons:reasonCatalog(db,'scrap'),machineStopReasons:reasonCatalog(db,'machineStop'),tasks:db.prepare('SELECT * FROM tasks').all().map(t=>({...t,segments:JSON.parse(t.segments)})),executions:shopfloorExecutions(db),machineStops:machineStops(db),calendar:JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('calendar').value)};
}
function text(value,label,max=200) { if(typeof value!=='string'||!value.trim()||value.length>max) fail(`${label}: inserisci un valore valido (massimo ${max} caratteri).`); return value.trim(); }
function duration(value,label,zero=false) { if(!Number.isInteger(value)||value<(zero?0:1)||value>525600) fail(`${label}: inserisci minuti interi ${zero?'non negativi':'maggiori di zero'} (massimo 525600).`); return value; }
function positiveNumber(value,label) {if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e9)fail(`${label}: inserisci un valore maggiore di zero (massimo 1000000000).`);return value;}
function checkDate(value) { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'Z'))||new Date(value+'Z').toISOString().slice(0,16)!==value) fail('Data e ora non valide.'); return value; }
function calendarFor(state,id) { return {weekly:state.calendar.weekly,exceptions:{...state.calendar.exceptions,...(state.calendar.machineExceptions[id]||{})}}; }
const locked = t => ['in_progress','completed'].includes(t.status);
const units=['m','m2','kg'],articleKinds=['component','product','both'];
const supportsRole=(article,role)=>article.kind===role||article.kind==='both';
function applyAction(state,action,actorRole='admin') {
  const affected = new Set();
  const taskById = id => {const t=state.tasks.find(x=>x.id===id); if(!t) fail('Attività non trovata.',404); return t;};
  const machineById = id => {const m=state.machines.find(x=>x.id===id); if(!m) fail('Macchina non trovata.',404); return m;};
  const articleById = id => {const a=state.articles.find(x=>x.id===id);if(!a)fail('Articolo non trovato.',404);return a;};
  const resolveArticle=(values,prefix,role,existing)=>{
    const idField=`${prefix}ArticleId`,codeField=`${prefix}Code`,descriptionField=`${prefix}Description`;
    if(!Object.hasOwn(values,idField)&&!Object.hasOwn(values,codeField)&&!Object.hasOwn(values,descriptionField)&&existing?.[idField])return articleById(existing[idField]);
    if(values[idField]){const article=articleById(values[idField]);if(!supportsRole(article,role))fail(`L'articolo ${article.code} non è utilizzabile come ${role==='product'?'prodotto':'componente'}.`);return article;}
    const code=String(values[codeField]??'').trim(),description=String(values[descriptionField]??'').trim();
    if(!code&&!description)return null;
    const cleanCode=text(values[codeField],`Codice ${role==='product'?'prodotto':'componente'}`,80),cleanDescription=text(values[descriptionField],`Descrizione ${role==='product'?'prodotto':'componente'}`,200);
    let article=state.articles.find(item=>item.code.toLowerCase()===cleanCode.toLowerCase());
    if(article){
      if(article.description.toLowerCase()!==cleanDescription.toLowerCase())fail(`Il codice ${article.code} esiste già con una descrizione diversa.`);
      if(!supportsRole(article,role)){if(actorRole!=='admin')fail('Chiedi a un amministratore di abilitare questo articolo per l’utilizzo richiesto.',403);article.kind='both';}
    } else {if(actorRole!=='admin')fail('Seleziona un articolo esistente. La creazione è riservata agli amministratori.',403);article={id:uid(),code:cleanCode,description:cleanDescription,unit:'m',kind:role};state.articles.push(article);}
    return article;
  };
  const taskArticleFields=(values,existing)=>{
    const result={};
    for(const [prefix,role] of [['component1','component'],['component2','component'],['product','product']]){
      const article=resolveArticle(values,prefix,role,existing);
      result[`${prefix}ArticleId`]=article?.id??null;result[`${prefix}Code`]=article?.code??'';result[`${prefix}Description`]=article?.description??'';
    }
    return result;
  };
  if(action.kind==='plan') {
    const t=taskById(action.id); if(locked(t)||t.status==='cancelled') fail('Questa attività non può essere spostata.');
    const machine=machineById(t.machineId); const oldSequence=state.tasks.filter(x=>x.machineId===machine.id&&x.position!==null).sort((a,b)=>a.position-b.position);
    const sequence=oldSequence.filter(x=>x.id!==t.id);
    if(action.unplan) { t.position=null;t.start=null;t.end=null;t.segments=[];t.status='unplanned';t.effectiveSetupMinutes=null; }
    else {
      const index=action.beforeId?sequence.findIndex(x=>x.id===action.beforeId):sequence.length;
      if(index<0) fail('Posizione non più disponibile.');
      if(sequence.slice(index).some(locked)) fail('Inserisci l’attività dopo le attività in corso o completate.');
      sequence.splice(index,0,t);t.status='planned';
    }
    sequence.forEach((x,i)=>x.position=i); affected.add(machine.id);
  } else if(action.kind==='task') {
    const existing=action.id?taskById(action.id):null;
    if(existing&&locked(existing)) fail('Le attività in corso o completate sono protette da modifiche e cancellazione.');
    if(action.remove) { state.tasks=state.tasks.filter(x=>x.id!==existing.id);affected.add(existing.machineId); }
    else {
      const v=action.values||{},machine=machineById(v.machineId); if(!state.types.some(x=>x.id===v.typeId)) fail('Seleziona una tipologia valida.');
      const calculationMode=v.calculationMode??existing?.calculationMode??'manual';if(!['manual','automatic'].includes(calculationMode))fail('Modalità di calcolo non valida.');
      const articleFields=taskArticleFields(v,existing);let quantity=v.quantity??null,runMinutes;
      if(calculationMode==='automatic'){
        quantity=positiveNumber(quantity,'Quantità');const product=articleFields.productArticleId?articleById(articleFields.productArticleId):null;
        if(!product)fail('Seleziona un articolo prodotto per il calcolo automatico.');if(product.unit!==machine.speedUnit)fail(`L'unità del prodotto (${product.unit}) non coincide con quella della macchina (${machine.speedUnit}).`);
        runMinutes=Math.ceil(quantity/machine.speed);duration(runMinutes,'Esecuzione');
      } else {if(quantity!==null)quantity=positiveNumber(quantity,'Quantità');runMinutes=duration(v.runMinutes,'Esecuzione');}
      const clean={title:text(v.title,'Titolo'),typeId:v.typeId,machineId:v.machineId,setupMinutes:duration(v.setupMinutes,'Attrezzaggio',true),runMinutes,quantity,calculationMode,notes:typeof v.notes==='string'?v.notes.slice(0,2000):'',...articleFields};
      // Validate even unplanned activities: the setup must fit an available shift.
      scheduleMachine([{id:'validation',...clean,status:'planned'}],machineById(v.machineId).anchor,calendarFor(state,v.machineId));
      if(existing) { affected.add(existing.machineId); if(existing.machineId!==clean.machineId) Object.assign(existing,{position:null,start:null,end:null,segments:[],status:'unplanned',effectiveSetupMinutes:null});Object.assign(existing,clean); }
      else state.tasks.push({id:uid(),...clean,status:'unplanned',position:null,start:null,end:null,segments:[],effectiveSetupMinutes:null});
      affected.add(clean.machineId);
    }
  } else if(action.kind==='status') {
    const t=taskById(action.id);const allowed={unplanned:['cancelled'],planned:['in_progress','cancelled'],in_progress:['completed'],cancelled:['unplanned'],completed:[]};
    if(state.executions?.some(execution=>execution.taskId===t.id))fail('Usa le azioni di reparto per aggiornare questa attività.');
    if(!allowed[t.status]?.includes(action.status)) fail('Cambio di stato non consentito.');
    if(action.status==='in_progress') {
      if(state.machineStops?.some(stop=>stop.machineId===t.machineId&&stop.endedAt===null)) fail('La macchina è ferma. Registra la ripresa della macchina prima di avviare l’attività.');
      if(state.tasks.some(x=>x.machineId===t.machineId&&x.status==='in_progress')) fail('La macchina ha già un’attività in corso.');
      if(state.tasks.some(x=>x.machineId===t.machineId&&x.position!==null&&x.position<t.position&&x.status!=='completed')) fail('Completa prima le attività precedenti della macchina.');
    }
    t.status=action.status;
    if(action.status==='cancelled'||action.status==='unplanned') Object.assign(t,{position:null,start:null,end:null,segments:[],effectiveSetupMinutes:null});
    affected.add(t.machineId);
  } else if(action.kind==='machine') {
    const existing=action.id?machineById(action.id):null;
    if(action.remove) {
      if(state.tasks.some(x=>x.machineId===existing.id)) fail('La macchina è utilizzata da attività. Elimina o trasferisci prima le attività.');
      if(state.setupRules.some(x=>x.machineId===existing.id))fail('La macchina è utilizzata da regole di attrezzaggio.');
      state.machines=state.machines.filter(x=>x.id!==existing.id);delete state.calendar.machineExceptions[existing.id];
    } else {
      const clean={name:text(action.values?.name,'Nome macchina'),description:String(action.values?.description||'').slice(0,500),anchor:checkDate(action.values?.anchor),speed:positiveNumber(action.values?.speed??existing?.speed??10,'Velocità'),speedUnit:action.values?.speedUnit??existing?.speedUnit??'m'};if(!units.includes(clean.speedUnit))fail('Unità velocità non valida.');
      if(state.machines.some(x=>x.id!==existing?.id&&x.name.toLowerCase()===clean.name.toLowerCase())) fail('Esiste già una macchina con questo nome.');
      if(existing) {Object.assign(existing,clean);for(const task of state.tasks.filter(t=>t.machineId===existing.id&&t.calculationMode==='automatic'&&!locked(t))){const product=task.productArticleId?articleById(task.productArticleId):null;if(!product||product.unit!==clean.speedUnit)fail('La nuova unità della macchina non è compatibile con le attività automatiche.');task.runMinutes=duration(Math.ceil(task.quantity/clean.speed),'Esecuzione');}affected.add(existing.id);} else state.machines.push({id:uid(),...clean});
    }
  } else if(action.kind==='article') {
    const existing=action.id?articleById(action.id):null;
    if(action.remove){if(!existing)fail('Articolo non trovato.',404);if(state.tasks.some(t=>['component1ArticleId','component2ArticleId','productArticleId'].some(field=>t[field]===existing.id)))fail('L’articolo è utilizzato da attività.');state.articles=state.articles.filter(a=>a.id!==existing.id);}
    else {
      const clean={code:text(action.values?.code,'Codice articolo',80),description:text(action.values?.description,'Descrizione articolo',200),unit:action.values?.unit,kind:action.values?.kind};if(!units.includes(clean.unit))fail('Unità articolo non valida.');if(!articleKinds.includes(clean.kind))fail('Tipo articolo non valido.');
      if(state.articles.some(a=>a.id!==existing?.id&&a.code.toLowerCase()===clean.code.toLowerCase()))fail('Esiste già un articolo con questo codice.');
      if(existing&&clean.kind==='component'&&state.tasks.some(t=>t.productArticleId===existing.id))fail('L’articolo è utilizzato come prodotto.');
      if(existing&&clean.kind==='product'&&state.tasks.some(t=>t.component1ArticleId===existing.id||t.component2ArticleId===existing.id))fail('L’articolo è utilizzato come componente.');
      if(existing&&existing.unit!==clean.unit&&state.tasks.some(t=>['component1ArticleId','component2ArticleId','productArticleId'].some(field=>t[field]===existing.id)))fail('Non puoi cambiare l’unità di un articolo utilizzato da attività.');
      if(existing){Object.assign(existing,clean);for(const task of state.tasks){if(locked(task))continue;for(const prefix of ['component1','component2','product'])if(task[`${prefix}ArticleId`]===existing.id){task[`${prefix}Code`]=clean.code;task[`${prefix}Description`]=clean.description;}}}
      else state.articles.push({id:uid(),...clean});
    }
  } else if(action.kind==='setupRule') {
    const existing=state.setupRules.find(rule=>rule.id===action.id);if(action.id&&!existing)fail('Regola di attrezzaggio non trovata.',404);
    if(action.remove){if(!existing)fail('Regola di attrezzaggio non trovata.',404);state.setupRules=state.setupRules.filter(rule=>rule.id!==existing.id);affected.add(existing.machineId);}
    else {const clean={machineId:action.values?.machineId,fromTypeId:action.values?.fromTypeId,toTypeId:action.values?.toTypeId,minutes:duration(action.values?.minutes,'Attrezzaggio',true)};machineById(clean.machineId);if(!state.types.some(type=>type.id===clean.fromTypeId)||!state.types.some(type=>type.id===clean.toTypeId))fail('Seleziona tipologie valide.');if(state.setupRules.some(rule=>rule.id!==existing?.id&&rule.machineId===clean.machineId&&rule.fromTypeId===clean.fromTypeId&&rule.toTypeId===clean.toTypeId))fail('Esiste già una regola per questa transizione.');if(existing){affected.add(existing.machineId);Object.assign(existing,clean);}else state.setupRules.push({id:uid(),...clean});affected.add(clean.machineId);}
  } else if(action.kind==='type') {
    const existing=state.types.find(x=>x.id===action.id); if(action.id&&!existing) fail('Tipologia non trovata.',404);
    if(action.remove) {if(state.tasks.some(x=>x.typeId===existing.id)) fail('Tipologia utilizzata da attività.');if(state.setupRules.some(x=>x.fromTypeId===existing.id||x.toTypeId===existing.id))fail('Tipologia utilizzata da regole di attrezzaggio.');state.types=state.types.filter(x=>x.id!==existing.id);}
    else {
      const clean={name:text(action.values?.name,'Nome tipologia'),color:action.values?.color};if(!/^#[0-9a-fA-F]{6}$/.test(clean.color||'')) fail('Colore non valido.');
      if(state.types.some(x=>x.id!==existing?.id&&x.name.toLowerCase()===clean.name.toLowerCase())) fail('Tipologia già esistente.');
      if(existing)Object.assign(existing,clean);else state.types.push({id:uid(),...clean});
    }
  } else if(action.kind==='calendar') {
    const value=action.values; if(!value||!value.weekly||!value.exceptions||!value.machineExceptions) fail('Calendario non valido.');
    validateCalendar({weekly:value.weekly,exceptions:value.exceptions});
    for(const [id,exceptions] of Object.entries(value.machineExceptions)) {machineById(id);validateCalendar({weekly:value.weekly,exceptions});}
    state.calendar=value;state.machines.forEach(m=>affected.add(m.id));
  } else fail('Operazione non riconosciuta.');
  for(const id of affected) {
    const sequence=state.tasks.filter(t=>t.machineId===id&&t.position!==null).sort((a,b)=>a.position-b.position);
    sequence.forEach((t,i)=>t.position=i);
    const prepared=sequence.map((task,index)=>{let actual=task.setupMinutes;if(locked(task))actual=task.effectiveSetupMinutes??task.setupMinutes;else if(index>0){const previous=sequence[index-1];actual=state.setupRules.find(rule=>rule.machineId===id&&rule.fromTypeId===previous.typeId&&rule.toTypeId===task.typeId)?.minutes??task.setupMinutes;}return {...task,setupMinutes:actual};});
    const scheduled=scheduleMachine(prepared,machineById(id).anchor,calendarFor(state,id));
    for(let index=0;index<scheduled.length;index++){const target=taskById(scheduled[index].id),baseSetup=sequence[index].setupMinutes;Object.assign(target,scheduled[index]);target.setupMinutes=baseSetup;target.effectiveSetupMinutes=prepared[index].setupMinutes;}
  }
  return state;
}
function save(state) {
  db.exec('DELETE FROM tasks; DELETE FROM setupRules; DELETE FROM articles; DELETE FROM types; DELETE FROM machines;');
  const m=db.prepare('INSERT INTO machines(id,name,description,anchor,speed,speedUnit) VALUES (?,?,?,?,?,?)');state.machines.forEach(x=>m.run(x.id,x.name,x.description,x.anchor,x.speed,x.speedUnit));
  const y=db.prepare('INSERT INTO types VALUES (?,?,?)');state.types.forEach(x=>y.run(x.id,x.name,x.color));
  const a=db.prepare('INSERT INTO articles(id,code,description,unit,kind) VALUES (?,?,?,?,?)');state.articles.forEach(x=>a.run(x.id,x.code,x.description,x.unit,x.kind));
  const r=db.prepare('INSERT INTO setupRules(id,machineId,fromTypeId,toTypeId,minutes) VALUES (?,?,?,?,?)');state.setupRules.forEach(x=>r.run(x.id,x.machineId,x.fromTypeId,x.toTypeId,x.minutes));
  const t=db.prepare(`INSERT INTO tasks(id,title,typeId,machineId,setupMinutes,runMinutes,status,position,start,end,segments,notes,component1Code,component1Description,component2Code,component2Description,productCode,productDescription,quantity,calculationMode,effectiveSetupMinutes,component1ArticleId,component2ArticleId,productArticleId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  state.tasks.forEach(x=>t.run(x.id,x.title,x.typeId,x.machineId,x.setupMinutes,x.runMinutes,x.status,x.position??null,x.start??null,x.end??null,JSON.stringify(x.segments),x.notes,x.component1Code||'',x.component1Description||'',x.component2Code||'',x.component2Description||'',x.productCode||'',x.productDescription||'',x.quantity??null,x.calculationMode||'manual',x.effectiveSetupMinutes??null,x.component1ArticleId??null,x.component2ArticleId??null,x.productArticleId??null));
  db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify(state.calendar),'calendar');
  db.prepare('UPDATE meta SET value=? WHERE key=?').run(String(state.revision+1),'revision');
}
function publicUsers() {return db.prepare('SELECT id,name,username,role FROM users ORDER BY name').all();}
const previews=new Map(),attempts=new Map();
async function body(req) {let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1048576)fail('Richiesta troppo grande.',413);}try{return JSON.parse(raw||'{}');}catch{fail('Richiesta non valida.');}}
function send(res,status,data,headers={}) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
function session(req) {const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('aloven_session='))?.slice(15);if(!token)return null;return db.prepare('SELECT u.id,u.name,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(token),Date.now());}
function cookie(token,req,clear=false) {return `aloven_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:43200}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`;}
const server=http.createServer(async(req,res)=>{
  try {
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/api/')) {
      if(req.method!=='GET')fail('Metodo non consentito.',405);
      const files={'/':['index.html','text/html'],'/bordo-macchina':['index.html','text/html'],'/operatore':['operator.html','text/html'],'/operator.js':['operator.js','text/javascript'],'/operator.css':['operator.css','text/css'],'/app.js':['app.js','text/javascript'],'/planning-insights.js':['planning-insights.js','text/javascript'],'/shopfloor.js':['shopfloor.js','text/javascript'],'/timeline.js':['timeline.js','text/javascript'],'/style.css':['style.css','text/css'],'/shopfloor.css':['shopfloor.css','text/css'],'/timeline.css':['timeline.css','text/css']};const file=files[url.pathname];if(!file)fail('Pagina non trovata.',404);
      res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(path.join(root,'public',file[0])));return;
    }
    if(req.method==='POST') {if(req.headers['x-aloven-request']!=='1')fail('Richiesta non autorizzata.',403);if(req.headers.origin&&req.headers.origin!==`${process.env.COOKIE_SECURE==='1'?'https':'http'}://${req.headers.host}`)fail('Origine non autorizzata.',403);}
    const user=session(req);const payload=req.method==='POST'?await body(req):{};
    if(url.pathname==='/api/session'&&req.method==='GET') {send(res,200,{user,needsSetup:!db.prepare('SELECT 1 FROM users LIMIT 1').get()});return;}
    if(url.pathname==='/api/setup'&&req.method==='POST') {
      if(db.prepare('SELECT 1 FROM users LIMIT 1').get())fail('Configurazione già completata.',409);
      const name=text(payload.name,'Nome'),username=text(payload.username,'Nome utente',80).toLowerCase();const password=text(payload.password,'Password',200);if(password.length<10)fail('La password deve contenere almeno 10 caratteri.');
      const id=uid();db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id,name,username,passwordHash(password),'admin');
      const token=uid()+uid();db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),id,Date.now()+43200000);send(res,200,{ok:true},{'Set-Cookie':cookie(token,req)});return;
    }
    if(url.pathname==='/api/login'&&req.method==='POST') {
      const key=req.socket.remoteAddress;const a=attempts.get(key)||{count:0,time:Date.now()};if(Date.now()-a.time>900000){a.count=0;a.time=Date.now();}if(a.count>=10)fail('Troppi tentativi. Riprova tra 15 minuti.',429);
      const username=text(payload.username,'Nome utente',80).toLowerCase(),password=text(payload.password,'Password',200);const found=db.prepare('SELECT * FROM users WHERE username=?').get(username);
      if(!found||!passwordMatches(password,found.password)){a.count++;attempts.set(key,a);fail('Nome utente o password errati.',401);}attempts.delete(key);
      db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());const token=uid()+uid();db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),found.id,Date.now()+43200000);send(res,200,{ok:true},{'Set-Cookie':cookie(token,req)});return;
    }
    if(!user)fail('Accedi per continuare.',401);
    if(url.pathname==='/api/logout'&&req.method==='POST') {const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('aloven_session='))?.slice(15);if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));send(res,200,{ok:true},{'Set-Cookie':cookie('',req,true)});return;}
    if(url.pathname==='/api/state'&&req.method==='GET') {send(res,200,{...snapshot(),user,users:user.role==='admin'?publicUsers():[]});return;}
    if(url.pathname==='/api/shopfloor/action'&&req.method==='POST') {send(res,200,performShopfloorAction(db,payload,user,uid));return;}
    if(url.pathname==='/api/machine-stop'&&req.method==='POST') {send(res,200,performMachineStopAction(db,payload,user,uid));return;}
    if(url.pathname==='/api/scrap-reasons'&&req.method==='POST') {if(user.role!=='admin')fail('Operazione riservata agli amministratori.',403);send(res,200,updateReasonCatalog(db,'scrap',payload,uid));return;}
    if(url.pathname==='/api/machine-stop-reasons'&&req.method==='POST') {if(user.role!=='admin')fail('Operazione riservata agli amministratori.',403);send(res,200,updateReasonCatalog(db,'machineStop',payload,uid));return;}
    if(url.pathname==='/api/preview'&&req.method==='POST') {
      if(['machine','type','calendar','article','setupRule'].includes(payload.action?.kind)&&user.role!=='admin')fail('Operazione riservata agli amministratori.',403);
      const old=snapshot();if(payload.revision!==old.revision)fail('I dati sono cambiati. Aggiorna la pagina e riprova.',409);
      const next=applyAction(structuredClone(old),payload.action,user.role);const changes=next.tasks.filter(t=>{const p=old.tasks.find(x=>x.id===t.id);return p&&(p.start!==t.start||p.end!==t.end||p.machineId!==t.machineId||p.runMinutes!==t.runMinutes||p.effectiveSetupMinutes!==t.effectiveSetupMinutes);}).map(t=>{const p=old.tasks.find(x=>x.id===t.id);return {id:t.id,title:t.title,oldStart:p.start,oldEnd:p.end,start:t.start,end:t.end,oldRunMinutes:p.runMinutes,runMinutes:t.runMinutes,oldSetupMinutes:p.effectiveSetupMinutes,setupMinutes:t.effectiveSetupMinutes};});
      const token=uid()+uid();for(const [k,v] of previews)if(v.expires<Date.now())previews.delete(k);previews.set(token,{userId:user.id,revision:old.revision,action:payload.action,next,expires:Date.now()+300000});send(res,200,{token,changes});return;
    }
    if(url.pathname==='/api/commit'&&req.method==='POST') {
      const p=previews.get(payload.token);if(!p||p.userId!==user.id||p.expires<Date.now())fail('Anteprima scaduta. Ripeti l’operazione.',409);
      if(['machine','type','calendar','article','setupRule'].includes(p.action?.kind)&&user.role!=='admin')fail('Operazione riservata agli amministratori.',403);
      db.exec('BEGIN IMMEDIATE');try {if(snapshot().revision!==p.revision)fail('Un altro utente ha modificato i dati. Aggiorna e riprova.',409);save(p.next);db.exec('COMMIT');previews.delete(payload.token);}catch(e){db.exec('ROLLBACK');throw e;}
      send(res,200,{ok:true});return;
    }
    if(url.pathname==='/api/users'&&req.method==='POST') {
      if(user.role!=='admin')fail('Operazione riservata agli amministratori.',403);
      const existing=payload.id?db.prepare('SELECT * FROM users WHERE id=?').get(payload.id):null;if(payload.id&&!existing)fail('Utente non trovato.',404);
      if(existing?.id===user.id&&payload.remove)fail('Non puoi eliminare il tuo account.');
      if(existing?.role==='admin'&&(payload.remove||payload.role!=='admin')&&db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n<=1)fail('Deve rimanere almeno un amministratore.');
      if(payload.remove)db.prepare('DELETE FROM users WHERE id=?').run(existing.id);
      else {
        const name=text(payload.name,'Nome'),username=text(payload.username,'Nome utente',80).toLowerCase();if(!['admin','operator'].includes(payload.role))fail('Ruolo non valido.');
        if(db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username,existing?.id||''))fail('Nome utente già esistente.');
        let encoded=existing?.password;if(payload.password||!existing){const password=text(payload.password,'Password',200);if(password.length<10)fail('La password deve contenere almeno 10 caratteri.');encoded=passwordHash(password);}
        if(existing){db.prepare('UPDATE users SET name=?,username=?,password=?,role=? WHERE id=?').run(name,username,encoded,payload.role,existing.id);if(payload.password)db.prepare('DELETE FROM sessions WHERE user_id=?').run(existing.id);}
        else db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(uid(),name,username,encoded,payload.role);
      }
      db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();send(res,200,{ok:true});return;
    }
    fail('Endpoint non trovato.',404);
  } catch(e) {const expected=e.status||(!/SQLITE|ENOENT|TypeError/.test(String(e))?400:500);if(expected===500)console.error(e);send(res,expected,{error:expected===500?'Errore interno. Controlla i dati e riprova.':e.message});}
});
const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Aloven disponibile su http://${host}:${server.address().port}`));
