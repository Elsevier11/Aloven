import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {proposePeriod,compatibilityFields,migratePlanningCompatibility} from './planning-proposal.mjs';

const base=()=>({machines:[{id:'m',anchor:'2026-10-05T08:00'}],tasks:[],calendar:{weekly:{0:[],1:[['08:00','12:00'],['13:00','17:00']],2:[['08:00','12:00'],['13:00','17:00']],3:[['08:00','12:00'],['13:00','17:00']],4:[['08:00','12:00'],['13:00','17:00']],5:[['08:00','12:00'],['13:00','17:00']],6:[]},exceptions:{},machineExceptions:{}},setupRules:[],machineStops:[]});
const task=(id,runMinutes,extra={})=>({id,title:id,machineId:'m',typeId:'type',setupMinutes:30,runMinutes,status:'unplanned',position:null,start:null,end:null,segments:[],...extra});
const propose=(s,extra={})=>proposePeriod(s,{from:'2026-10-12',to:'2026-10-16',machineIds:['m'],taskIds:s.tasks.map(t=>t.id),...extra});

test('proposal fills capacity by delivery, skips indivisible work beyond period and leaves source untouched',()=>{
 const s=base();s.tasks=[task('late',600,{dueDate:'2026-10-20'}),task('early',1800,{dueDate:'2026-10-13'}),task('small',60)];const original=structuredClone(s);const p=propose(s);
 assert.deepEqual(p.included,['early','small']);assert.equal(p.excluded[0].id,'late');assert.equal(p.load[0].available,2400);assert.equal(p.load[0].occupied,1920);assert.equal(p.load[0].residual,480);assert.deepEqual(s,original);assert.ok(p.state.tasks.find(t=>t.id==='early').start>='2026-10-12');
});
test('proposal retains existing scheduled work and only appends in requested week',()=>{
 const s=base();const existing=task('old',60,{status:'planned',position:0,start:'2026-10-05T08:00',end:'2026-10-05T09:30',segments:[{kind:'setup',start:'2026-10-05T08:00',end:'2026-10-05T08:30'},{kind:'run',start:'2026-10-05T08:30',end:'2026-10-05T09:30'}]});s.tasks=[existing,task('new',60)];const p=propose(s);assert.deepEqual(p.state.tasks[0],existing);assert.equal(p.state.tasks[1].start,'2026-10-12T08:00');assert.deepEqual(p.included,['new']);assert.equal(p.excluded[0].id,'old');
});
test('proposal does not add new work before the injected current time',()=>{
 const s=base();s.tasks=[task('new',60)];const p=proposePeriod(s,{from:'2026-10-12',to:'2026-10-16',machineIds:['m'],taskIds:['new']},{notBefore:'2026-10-13T14:15'});
 assert.deepEqual(p.included,['new']);assert.equal(p.state.tasks[0].start,'2026-10-13T14:15');
});
test('machine closures, setup transitions and open stops constrain proposal',()=>{
 const s=base();s.calendar.machineExceptions.m={'2026-10-12':[]};s.tasks=[task('a',60),task('b',60,{typeId:'second'})];s.setupRules=[{machineId:'m',fromTypeId:'type',toTypeId:'second',minutes:0}];let p=propose(s);assert.equal(p.state.tasks[0].start,'2026-10-13T08:00');assert.equal(p.state.tasks[1].effectiveSetupMinutes,0);assert.equal(p.load[0].available,1920);s.machineStops=[{machineId:'m',endedAt:null}];p=propose(s);assert.equal(p.included.length,0);assert.equal(p.excluded.length,2);assert.equal(p.load[0].uncertain,true);
});
test('no availability and invalid selectors do not mutate data',()=>{
 const s=base();s.tasks=[task('a',60)];const p=propose(s,{from:'2026-10-11',to:'2026-10-11'});assert.equal(p.included.length,0);assert.equal(p.load[0].available,0);assert.equal(p.load[0].occupied,0);assert.throws(()=>propose(s,{from:'2026-02-30'}));assert.throws(()=>propose(s,{taskIds:['missing']}));assert.throws(()=>propose(s,{machineIds:['missing']}));
});
test('compatibility validates destination and preference, legacy explicit reassignment retained',()=>{
 const machines=[{id:'a'},{id:'b'}];assert.deepEqual(compatibilityFields({machineId:'a'},null,machines),{compatibleMachineIds:['a'],preferredMachineId:null});assert.throws(()=>compatibilityFields({machineId:'b',compatibleMachineIds:['a']},null,machines));assert.throws(()=>compatibilityFields({machineId:'a',compatibleMachineIds:['a'],preferredMachineId:'b'},null,machines));assert.deepEqual(compatibilityFields({machineId:'b'},{machineId:'a',compatibleMachineIds:['a']},machines).compatibleMachineIds,['b']);assert.deepEqual(compatibilityFields({machineId:'b',compatibleMachineIds:['a','b'],preferredMachineId:'a'},null,machines).compatibleMachineIds,['a','b']);
});
test('compatibility migration additive and idempotent with historical destination preserved',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES('revision','1'); CREATE TABLE tasks(id TEXT PRIMARY KEY,machineId TEXT);INSERT INTO tasks VALUES('t','m');");assert.equal(migratePlanningCompatibility(db).migrated,true);assert.equal(db.prepare('SELECT compatibleMachineIds FROM tasks').get().compatibleMachineIds,'["m"]');assert.equal(migratePlanningCompatibility(db).migrated,false);assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'2');db.close();
});
test('proposal honours a manual setup time over catalog rules and the base setup',()=>{
 const s=base();s.setupRules=[{machineId:'m',fromTypeId:'type',toTypeId:'second',minutes:15}];
 s.tasks=[task('a',60,{setupOverrideMinutes:0}),task('b',60,{typeId:'second',setupOverrideMinutes:45}),task('c',60,{typeId:'second'})];
 const p=propose(s),by=id=>p.state.tasks.find(t=>t.id===id);
 assert.deepEqual(p.included,['a','b','c']);
 assert.equal(by('a').effectiveSetupMinutes,0);assert.equal(by('b').effectiveSetupMinutes,45,'il valore manuale prevale sulla regola');assert.equal(by('c').effectiveSetupMinutes,30,'senza override né regola second→second resta il valore base');
});

// --- Riempimento dei buchi (mode: 'fill') ---
import {scheduleTask} from './scheduler.mjs';
import {effectiveMachineCalendar} from './public/calendar.js';
const placed=(id,fixedStart,runMinutes,extra={})=>{
 const t=task(id,runMinutes,{status:'planned',...extra}),effective=extra.effectiveSetupMinutes??t.setupMinutes;
 const item=scheduleTask({...t,setupMinutes:effective},fixedStart,effectiveMachineCalendar(base().calendar,'m'));
 return {...t,start:item.start,end:item.end,segments:item.segments,fixedStart,effectiveSetupMinutes:effective};
};
// Lunedì 12 ottobre: A 08:00–09:30, pausa pranzo, B 13:00–14:30. Libero 09:30–12:00 e dopo B.
const withGap=extra=>{const s=base();s.tasks=[placed('A','2026-10-12T08:00',60,{position:0}),placed('B','2026-10-12T13:00',60,{position:1,...extra})];return s;};
const snapshot=(p,id)=>{const t=p.state.tasks.find(x=>x.id===id);return {start:t.start,end:t.end,segments:t.segments,fixedStart:t.fixedStart};};

test('fill: un candidato che entra nel buco viene messo lì con inizio fissato; le altre attività non cambiano',()=>{
 const s=withGap();s.tasks.push(task('fit',90));const before=structuredClone(s);
 const p=propose(s,{mode:'fill'}),by=id=>p.state.tasks.find(t=>t.id===id);
 assert.deepEqual(p.included,['fit']);
 assert.equal(by('fit').start,'2026-10-12T09:30');assert.equal(by('fit').end,'2026-10-12T11:30');assert.equal(by('fit').fixedStart,'2026-10-12T09:30','il buco richiede l’inizio fissato per restare stabile');
 for(const id of ['A','B'])assert.deepEqual(snapshot(p,id),snapshot({state:before},id),`${id} resta identica`);
 assert.deepEqual(['A','fit','B'].map(id=>by(id).position),[0,1,2],'le posizioni seguono l’ordine temporale');
 assert.deepEqual(s,before,'l’input non viene modificato');
});

test('append (predefinito): lo stesso candidato va dopo l’ultima attività, senza inizio fissato',()=>{
 const s=withGap();s.tasks.push(task('fit',90));
 const p=propose(s),fit=p.state.tasks.find(t=>t.id==='fit');
 assert.ok(fit.start>=p.state.tasks.find(t=>t.id==='B').end);assert.equal(fit.position,2);assert.equal(fit.fixedStart??null,null);
});

test('fill: un candidato troppo lungo per il buco viene accodato; con più candidati il buco va al primo che ci sta',()=>{
 const s=withGap();s.tasks.push(task('big',200,{dueDate:'2026-10-13'}),task('fit',60,{dueDate:'2026-10-14'}));
 const p=propose(s,{mode:'fill'}),by=id=>p.state.tasks.find(t=>t.id===id);
 assert.equal(by('fit').start,'2026-10-12T09:30','fit ci sta nel buco anche se arriva dopo per consegna');
 assert.ok(by('big').start>=by('B').end,'big non entra nel buco: coda');assert.equal(by('big').fixedStart??null,null);
 assert.deepEqual(p.included.sort(),['big','fit']);
});

test('fill: il buco prima della prima attività è usato, ma non nel passato',()=>{
 const s=base();s.tasks=[placed('A','2026-10-12T10:00',60,{position:0}),task('early',60)];
 let p=propose(s,{mode:'fill'});assert.equal(p.state.tasks.find(t=>t.id==='early').start,'2026-10-12T08:00');assert.equal(p.state.tasks.find(t=>t.id==='A').position,1);
 p=proposePeriod(s,{from:'2026-10-12',to:'2026-10-16',machineIds:['m'],taskIds:['early'],mode:'fill'},{notBefore:'2026-10-12T09:00'});
 assert.ok(p.state.tasks.find(t=>t.id==='early').start>=p.state.tasks.find(t=>t.id==='A').end,'con ora minima 09:00 il buco 09:00–10:00 non basta e il candidato va in coda');
});

test('fill: se l’inserimento cambierebbe il setup dell’attività seguente, il buco è scartato',()=>{
 const s=base();s.setupRules=[{machineId:'m',fromTypeId:'type',toTypeId:'second',minutes:0}];
 // B (second) segue A (type) con setup 0 da regola; un candidato di altro tipo davanti a B farebbe tornare il setup a 30
 s.tasks=[placed('A','2026-10-12T08:00',60,{position:0}),placed('B','2026-10-12T13:00',60,{position:1,typeId:'second',effectiveSetupMinutes:0}),task('other',60,{typeId:'other'})];
 const p=propose(s,{mode:'fill'}),other=p.state.tasks.find(t=>t.id==='other');
 assert.ok(other.start>=p.state.tasks.find(t=>t.id==='B').end,'in coda, il buco avrebbe spostato i tempi di B');
 assert.deepEqual(snapshot(p,'B'),snapshot({state:s},'B'));
});

test('fill: non usa buchi davanti ad attività bloccate e rifiuta una modalità sconosciuta',()=>{
 const s=base();const running=placed('run','2026-10-12T10:00',60,{position:0,status:'in_progress'});s.tasks=[running,task('x',30)];
 const p=propose(s,{mode:'fill'});assert.ok(p.state.tasks.find(t=>t.id==='x').start>=running.end);
 assert.throws(()=>propose(s,{mode:'altro'}),/Modalità/);
});
