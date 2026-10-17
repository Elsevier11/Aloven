import test from 'node:test';
import assert from 'node:assert/strict';
import {temporalPlan,timelineInsertionBefore,timelineDropTarget} from './public/timeline.js';

test('inserimento usa preparazione e lavorazione insieme e la sequenza oltre il giorno visibile',()=>{
 const tasks=[
  {id:'a',machineId:'m',position:0,start:'2026-10-12T08:00',segments:[{start:'2026-10-12T08:00',end:'2026-10-12T08:30'},{start:'2026-10-12T08:30',end:'2026-10-12T10:00'}]},
  {id:'b',machineId:'m',position:1,start:'2026-10-12T10:00',segments:[{start:'2026-10-12T10:00',end:'2026-10-12T12:00'}]},
  {id:'c',machineId:'m',position:2,start:'2026-10-13T08:00',segments:[{start:'2026-10-13T08:00',end:'2026-10-13T10:00'}]}
 ];
 assert.equal(timelineInsertionBefore(tasks,'m','new','2026-10-12',510),'a');
 assert.equal(timelineInsertionBefore(tasks,'m','new','2026-10-12',590),'b');
 assert.equal(timelineInsertionBefore(tasks,'m','new','2026-10-12',800),'c');
 assert.equal(timelineInsertionBefore(tasks,'m','b','2026-10-12',590),'c');
 assert.equal(timelineInsertionBefore(tasks,'m','new','2026-10-11',800),'a');
 assert.equal(timelineInsertionBefore(tasks,'m','new','2026-10-14',800),'');
});

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
  assert.match(html,/aria-label="Macchina 1 · Ordine breve · Lavorazione · Pianificata · 08:00–08:15 · Da inviare al reparto · ART-1 · Attenzione: Sequenza da verificare"/);
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

test('rilascio sul Gantt: la posizione in sequenza dipende dal centro delle attività, non da un orario',()=>{
 const spans=[{id:'a',left:100,right:200},{id:'b',left:200,right:300},{id:'c',left:300,right:400}];
 assert.deepEqual(timelineDropTarget(spans,10),{beforeId:'a',boundaryX:100},'prima della prima');
 assert.deepEqual(timelineDropTarget(spans,149),{beforeId:'a',boundaryX:100},'metà sinistra di A: prima di A');
 assert.deepEqual(timelineDropTarget(spans,150),{beforeId:'b',boundaryX:200},'dal centro in poi: dopo A, cioè prima di B');
 assert.deepEqual(timelineDropTarget(spans,260),{beforeId:'c',boundaryX:300});
 assert.deepEqual(timelineDropTarget(spans,350),{beforeId:'',boundaryX:400},'metà destra dell’ultima: in coda');
 assert.deepEqual(timelineDropTarget(spans,9000),{beforeId:'',boundaryX:400},'oltre la fine: in coda');
});

test('rilascio sul Gantt: attività fuori dal periodo visibile, riga vuota e attività spezzate',()=>{
 const spans=[{id:'a',left:100,right:200},{id:'hidden',left:null,right:null},{id:'later',left:null,right:null}];
 assert.deepEqual(timelineDropTarget(spans,5000),{beforeId:'hidden',boundaryX:200},'oltre l’ultima visibile entra prima della prima nascosta, non in coda assoluta');
 assert.deepEqual(timelineDropTarget(spans,160),{beforeId:'hidden',boundaryX:200},'metà destra di A: dopo A, prima della prima nascosta');
 assert.deepEqual(timelineDropTarget(spans,110),{beforeId:'a',boundaryX:100});
 assert.deepEqual(timelineDropTarget([],320),{beforeId:'',boundaryX:320},'riga vuota: prima posizione, punto del puntatore');
 assert.deepEqual(timelineDropTarget([{id:'x',left:null,right:null}],320),{beforeId:'',boundaryX:320},'nessuna attività visibile');
 // Un'attività su più giorni occupa da left del primo blocco a right dell'ultimo: il centro è quello dell'intero intervallo.
 const split=[{id:'long',left:100,right:700},{id:'next',left:700,right:800}];
 assert.equal(timelineDropTarget(split,350).beforeId,'long');assert.equal(timelineDropTarget(split,450).beforeId,'next');
});
