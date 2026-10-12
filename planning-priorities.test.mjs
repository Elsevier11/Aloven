import test from 'node:test';
import assert from 'node:assert/strict';
import {planningPriorities} from './public/planning-priorities.js';
const esc=s=>String(s??'').replaceAll('<','&lt;');
test('priorità di consegna: usa date dichiarate e filtro macchina, conserva riferimenti e distingue previsione da scadenza',()=>{
 const state={machines:[{id:'m',name:'ACC-01'}],tasks:[
  {id:'later',title:'B',machineId:'m',status:'planned',dueDate:'2026-10-14',end:'2026-10-15T08:00',orderReference:'ORD-2'},
  {id:'earlier',title:'<A',machineId:'m',status:'unplanned',dueDate:'2026-10-11',orderReference:'ORD-1'},
  {id:'done',title:'D',machineId:'m',status:'completed',dueDate:'2026-10-01'},
  {id:'other',title:'C',machineId:'x',status:'unplanned',dueDate:'2026-10-01'},
  {id:'unknown',title:'E',machineId:'m',status:'unplanned'}
 ]};
 const html=planningPriorities({state,esc,today:'2026-10-11',machineFilter:'m'});
 assert.match(html,/Consegne · 2/);assert.ok(html.indexOf('ORD-1')<html.indexOf('ORD-2'));
 assert.match(html,/Consegna oggi/);assert.match(html,/Fine prevista oltre consegna/);assert.match(html,/&lt;A/);
 for(const id of ['done','other','unknown'])assert.ok(!html.includes(`data-detail="${id}"`));
});
test('priorità di consegna: assenza di date non genera ordini o scadenze',()=>{
 const html=planningPriorities({state:{tasks:[],machines:[]},esc,today:'2026-10-11'});
 assert.match(html,/Nessuna consegna registrata/);assert.ok(!html.includes('data-detail='));
});
