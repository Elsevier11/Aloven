import test from 'node:test';
import assert from 'node:assert/strict';
import {temporalPlan} from './public/timeline.js';

const context=zoom=>({
  zoom,
  selectedTaskId:'short',
  state:{
    user:{role:'user'},machineStops:[],
    tasks:[
      {id:'short',title:'Ordine breve',productCode:'ART-1',machineId:'m1',position:0,status:'planned',start:'2026-10-08T08:00',end:'2026-10-08T08:15',segments:[{kind:'run',start:'2026-10-08T08:00',end:'2026-10-08T08:15'}]},
      {id:'locked',title:'Ordine attivo',productCode:'ART-2',machineId:'m1',position:1,status:'in_progress',start:'2026-10-08T08:15',end:'2026-10-08T09:15',segments:[{kind:'run',start:'2026-10-08T08:15',end:'2026-10-08T09:15'}]}
    ]
  },
  esc:String,fmt:String,effectiveShifts:()=>[['08:00','18:00']],labels:{planned:'Pianificata',in_progress:'In corso'},
  planWarnings:new Map([['short','Sequenza da verificare']])
});

test('timeline applica lo zoom, mantiene durate esatte e rende accessibili i blocchi corti',()=>{
  const html=temporalPlan(context(.65),[{id:'m1',name:'Macchina 1'}],['2026-10-08','2026-10-09'],false);
  const scale=Number(html.match(/data-time-scale="([\d.]+)"/)[1]);
  const normal=temporalPlan(context(1),[{id:'m1',name:'Macchina 1'}],['2026-10-08','2026-10-09'],false);
  const normalScale=Number(normal.match(/data-time-scale="([\d.]+)"/)[1]);
  assert.ok(Math.abs(scale/normalScale-.65)<1e-9);
  const shortWidth=Number(html.match(/data-task="short"[^>]*style="[^"]*width:([\d.]+)px/)[1]);
  assert.ok(Math.abs(shortWidth-15*scale)<1e-9);
  assert.match(html,new RegExp(`width:${600*scale}px`));
  assert.match(html,/class="time-block run planned compact has-warning selected"/);
  assert.match(html,/>ART-1<\/strong>/);
  assert.match(html,/data-machine="m1"/);
  assert.match(html,/aria-current="true"/);
  assert.match(html,/08:00–08:15 · Pianificata<\/span>/);
  assert.match(html,/aria-label="Macchina 1 · Ordine breve · Lavorazione · Pianificata · 08:00–08:15 · Attenzione: Sequenza da verificare"/);
  assert.match(html,/data-before=""[^>]+draggable="false"/);
  assert.match(html,/data-now-marker/);
});

test('timeline evidenzia ogni segmento dell’attività selezionata senza cambiare le durate',()=>{
  const c=context(1);
  c.state.tasks[0].segments.push({kind:'run',start:'2026-10-09T08:00',end:'2026-10-09T08:15'});
  c.state.tasks[0].end='2026-10-09T08:15';
  const html=temporalPlan(c,[{id:'m1',name:'Macchina 1'}],['2026-10-08','2026-10-09'],false);
  assert.equal((html.match(/data-task="short"/g)||[]).length,2);
  assert.equal((html.match(/has-warning selected/g)||[]).length,2);
  assert.equal((html.match(/aria-current="true"/g)||[]).length,2);
  const scale=Number(html.match(/data-time-scale="([\d.]+)"/)[1]);
  const widths=[...html.matchAll(/data-task="short"[^>]*style="[^"]*width:([\d.]+)px/g)].map(match=>Number(match[1]));
  assert.equal(widths.length,2);
  assert.ok(widths.every(width=>Math.abs(width-15*scale)<1e-9));
});
