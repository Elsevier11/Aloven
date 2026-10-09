import test from 'node:test';
import assert from 'node:assert/strict';
import {temporalPlan} from './public/timeline.js';

const context=zoom=>({
  zoom,
  state:{
    user:{role:'user'},machineStops:[],
    tasks:[
      {id:'short',title:'Ordine breve',productCode:'ART-1',machineId:'m1',position:0,status:'planned',start:'2026-10-08T08:00',end:'2026-10-08T08:15',segments:[{kind:'run',start:'2026-10-08T08:00',end:'2026-10-08T08:15'}]},
      {id:'locked',title:'Ordine attivo',productCode:'ART-2',machineId:'m1',position:1,status:'in_progress',start:'2026-10-08T08:15',end:'2026-10-08T09:15',segments:[{kind:'run',start:'2026-10-08T08:15',end:'2026-10-08T09:15'}]}
    ]
  },
  esc:String,fmt:String,effectiveShifts:()=>[['08:00','18:00']],
  planWarnings:new Map([['short','Sequenza da verificare']])
});

test('timeline applica lo zoom, mantiene durate esatte e rende accessibili i blocchi corti',()=>{
  const html=temporalPlan(context(.65),[{id:'m1',name:'Macchina 1'}],['2026-10-08','2026-10-09'],false);
  assert.match(html,/width:390px/);
  assert.match(html,/width:9\.75px/);
  assert.match(html,/class="time-block run planned compact has-warning"/);
  assert.match(html,/>ART-1<\/strong>/);
  assert.match(html,/title="Ordine breve · Lavorazione · 08:00–08:15 · Attenzione: Sequenza da verificare"/);
  assert.match(html,/data-before=""[^>]+draggable="false"/);
  assert.match(html,/data-now-marker/);
});
