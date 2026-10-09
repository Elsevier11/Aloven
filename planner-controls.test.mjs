import test from 'node:test';
import assert from 'node:assert/strict';
import {placementAction,placementChoices} from './public/planner-controls.js';
const task=(id,position,status='planned',machineId='m1')=>({id,position,status,machineId});
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
