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
