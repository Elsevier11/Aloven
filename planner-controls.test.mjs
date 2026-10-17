import test from 'node:test';
import assert from 'node:assert/strict';
import {placementAction,placementChoices,theoreticalSetup,setupOverrideAction} from './public/planner-controls.js';
const task=(id,position,status='planned',machineId='m1')=>({id,position,status,machineId});
test('il posizionamento è solo per sequenza: le modalità a data non esistono più e «In coda» toglie un vecchio inizio fissato',()=>{
 const tasks=[{...task('a',0),fixedStart:'2026-11-12T10:15'}];
 assert.throws(()=>placementAction(tasks,'a','date','','2026-12-14T14:07'),/posizione valida/);
 assert.throws(()=>placementAction(tasks,'a','cascade',''),/posizione valida/);
 assert.deepEqual(placementAction(tasks,'a','end',''),{kind:'plan',id:'a',beforeId:''});
});
test('comandi prima/dopo rispettano la sequenza della stessa macchina',()=>{
 const tasks=[task('a',0),task('b',1),task('c',2),task('new',null,'unplanned'),task('other',0,'planned','m2')];
 assert.deepEqual(placementAction(tasks,'new','after','b'),{kind:'plan',id:'new',beforeId:'c'});
 assert.deepEqual(placementAction(tasks,'new','after','c'),{kind:'plan',id:'new',beforeId:''});
 assert.deepEqual(placementAction(tasks,'c','before','a'),{kind:'plan',id:'c',beforeId:'a'});
 assert.throws(()=>placementAction(tasks,'new','before','other'));
 assert.throws(()=>placementAction(tasks,'c','after','c'));
 assert.equal(placementAction(tasks,'b','after','a'),null);
 assert.equal(placementAction(tasks,'c','end',''),null);
});
test('le posizioni anteriori alle attività bloccate non sono selezionabili',()=>{
 const tasks=[task('done',0,'completed'),task('run',1,'in_progress'),task('a',2),task('b',3),task('new',null,'unplanned')];
 assert.deepEqual(placementChoices(tasks,tasks[4],'before').map(t=>t.id),['a','b']);
 assert.deepEqual(placementChoices(tasks,tasks[4],'after').map(t=>t.id),['run','a','b']);
 assert.throws(()=>placementAction(tasks,'new','after','done'));
 assert.throws(()=>placementAction(tasks,'new','before','run'));
 assert.throws(()=>placementAction(tasks,'run','end',''));
 assert.throws(()=>placementAction(tasks,'new','unknown',''));
 assert.deepEqual(placementAction(tasks,'new','after','run'),{kind:'plan',id:'new',beforeId:'a'});
});
test('attrezzaggio teorico: regola di catalogo dalla seconda posizione, valore base altrimenti; l’override uguale al teorico si azzera',()=>{
 const state={setupRules:[{machineId:'m1',fromTypeId:'t1',toTypeId:'t2',minutes:15}],tasks:[{id:'a',position:0,machineId:'m1',typeId:'t1',setupMinutes:40,status:'planned'},{id:'b',position:1,machineId:'m1',typeId:'t2',setupMinutes:40,status:'planned'},{id:'c',position:null,machineId:'m1',typeId:'t2',setupMinutes:25,status:'unplanned'}]};
 const [a,b,c]=state.tasks;
 assert.equal(theoreticalSetup(state,a),40,'la prima della coda usa il valore base');assert.equal(theoreticalSetup(state,b),15,'la regola vale dalla seconda posizione');assert.equal(theoreticalSetup(state,c),25);
 assert.deepEqual(setupOverrideAction(state,b,0),{kind:'setupOverride',id:'b',minutes:0});assert.deepEqual(setupOverrideAction(state,b,90),{kind:'setupOverride',id:'b',minutes:90},'si può anche allungare');
 assert.equal(setupOverrideAction(state,b,15),null,'uguale al teorico e senza override: nulla da fare');
 assert.deepEqual(setupOverrideAction(state,{...b,setupOverrideMinutes:90},15),{kind:'setupOverride',id:'b',minutes:null},'tornare al teorico ripristina');
 assert.equal(setupOverrideAction(state,{...b,setupOverrideMinutes:90},90),null);
 for(const bad of [-1,1.5,NaN])assert.throws(()=>setupOverrideAction(state,b,bad),/minuti interi/);
});
