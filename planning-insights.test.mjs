import test from 'node:test';
import assert from 'node:assert/strict';
import {planningWarnings,periodLoad,taskInPeriod,machineLoad,releaseWeeks,weeklyReleaseSummary,backlogLeftOut} from './public/planning-insights.js';
const task=(id,machineId,position,status,end)=>({id,machineId,position,status,end,segments:[{start:'2026-10-08T08:00',end:'2026-10-08T09:00',kind:'run'}]});
test('inizio superato non avviato è distinto da consegna, annullate e completate senza ricalcolo',()=>{const state={machines:[{id:'A'}],tasks:['planned','unplanned','cancelled','completed'].map((status,i)=>({...task(String(i),'A',status==='unplanned'?null:i,status,'2026-10-08T09:00'),start:'2026-10-08T08:00'}))};const before=structuredClone(state);assert.equal(planningWarnings(state,new Date('2026-10-08T06:00Z')).size,0);const warnings=planningWarnings(state,new Date('2026-10-08T06:01Z'));assert.deepEqual([...warnings.keys()],['0']);assert.match(warnings.get('0'),/non avviata/);assert.deepEqual(state,before);});
test('evidenzia solo i giorni con segmenti di lavoro, senza includere pause e giorni chiusi',()=>{
 const t={segments:[{start:'2026-10-09T15:00',end:'2026-10-09T17:00'},{start:'2026-10-12T08:00',end:'2026-10-12T10:00'}]};
 assert.equal(taskInPeriod(t,['2026-10-09']),true);assert.equal(taskInPeriod(t,['2026-10-10','2026-10-11']),false);assert.equal(taskInPeriod(t,['2026-10-12']),true);assert.equal(taskInPeriod(t,['2026-10-13']),false);
 assert.equal(taskInPeriod({segments:[{start:'2026-10-09T23:00',end:'2026-10-10T00:00'}]},['2026-10-10']),false);assert.equal(taskInPeriod({segments:[{start:'2026-10-09T23:00',end:'2026-10-10T01:00'}]},['2026-10-10']),true);assert.equal(taskInPeriod({segments:[]},['2026-10-09']),false);
});
test('segnala il ritardo reale e i successori senza modificare il piano, nel fuso di Roma',()=>{const state={machines:[{id:'A'},{id:'B'}],tasks:[task('1','A',0,'in_progress','2026-10-08T09:00'),task('2','A',1,'planned','2026-10-08T10:00'),task('3','B',0,'planned','2026-10-08T09:00'),task('4','A',2,'completed','2026-10-08T10:00')],machineStops:[]};const before=structuredClone(state);assert.equal(planningWarnings(state,new Date('2026-10-08T07:00Z')).size,0);const warnings=planningWarnings(state,new Date('2026-10-08T07:01Z'));assert.deepEqual([...warnings.keys()],['1','2']);assert.deepEqual(state,before);state.machineStops=[{machineId:'B',endedAt:null}];assert.match(planningWarnings(state,new Date('2026-10-08T07:01Z')).get('3'),/ferma/);});
test('carico riferito alle macchine e ai giorni visibili, completate opzionali e zero disponibilità',()=>{const state={tasks:[task('1','A',0,'planned'),task('2','A',1,'completed'),task('3','B',0,'planned'),task('4','A',null,'unplanned')]};const shifts=()=>[['08:00','12:00'],['13:00','17:00']];assert.deepEqual(periodLoad(state,[{id:'A'}],['2026-10-08'],shifts),{available:480,occupied:60,percent:13});assert.equal(periodLoad(state,[{id:'A'}],['2026-10-08'],shifts,true).occupied,120);assert.equal(periodLoad(state,[{id:'A'}],['2026-10-09'],()=>[]).percent,null);});

const seg=(start,end,kind='run')=>({start,end,kind});
const shiftsMonFri=date=>{const day=new Date(date+'T12:00Z').getUTCDay();return day===0||day===6?[]:[['08:00','12:00'],['13:00','17:00']];};

test('saturazione per macchina: solo i suoi segmenti nei giorni indicati, completate opzionali, indicativa con fermo o lavorazione in corso',()=>{
 const A={id:'A'},B={id:'B'};
 const state={machineStops:[],tasks:[
  {id:'1',machineId:'A',position:0,status:'planned',segments:[seg('2026-10-12T08:00','2026-10-12T12:00'),seg('2026-10-12T13:00','2026-10-12T14:00')]},
  {id:'2',machineId:'A',position:1,status:'completed',segments:[seg('2026-10-12T14:00','2026-10-12T17:00')]},
  {id:'3',machineId:'B',position:0,status:'planned',segments:[seg('2026-10-12T08:00','2026-10-12T10:00')]},
  {id:'4',machineId:'A',position:null,status:'unplanned',segments:[]},
 ]};
 const monday=['2026-10-12'];
 const a=machineLoad(state,A,monday,shiftsMonFri);
 assert.deepEqual(a,{available:480,occupied:300,percent:63,uncertain:false},'la macchina B e le non pianificate non contano; la completata è esclusa');
 assert.equal(machineLoad(state,A,monday,shiftsMonFri,{showCompleted:true}).occupied,480);
 assert.equal(machineLoad(state,B,monday,shiftsMonFri).percent,25);
 assert.equal(machineLoad(state,A,['2026-10-17'],shiftsMonFri).percent,null,'sabato chiuso: nessuna disponibilità, nessuna percentuale');
 assert.equal(machineLoad(state,A,monday,shiftsMonFri,{extraSegments:[seg('2026-10-12T14:00','2026-10-12T16:00')]}).occupied,420,'le barre in anteprima si sommano');
 assert.equal(machineLoad({...state,machineStops:[{machineId:'A',endedAt:null}]},A,monday,shiftsMonFri).uncertain,true);
 assert.equal(machineLoad({tasks:[{id:'9',machineId:'A',position:0,status:'in_progress',segments:[]}]},A,monday,shiftsMonFri).uncertain,true);
 assert.equal(machineLoad({tasks:[{id:'8',machineId:'A',position:0,status:'planned',segments:[seg('2026-10-12T23:00','2026-10-13T01:00')]}]},A,['2026-10-12'],()=>[['08:00','17:00']]).occupied,60,'un segmento a cavallo di mezzanotte è ritagliato al giorno');
});

test('settimane del rilascio: quelle toccate più la corrente e la successiva, in ordine',()=>{
 assert.deepEqual(releaseWeeks([],'2026-10-14'),['2026-10-12','2026-10-19']);
 assert.deepEqual(releaseWeeks([{newStart:'2026-10-27T08:00',oldStart:null},{newStart:'2026-10-15T08:00',oldStart:'2026-11-03T08:00'}],'2026-10-14'),['2026-10-12','2026-10-19','2026-10-26','2026-11-02']);
 assert.equal(releaseWeeks(Array.from({length:10},(_,i)=>({newStart:'2026-11-'+String(1+i*2).padStart(2,'0')+'T08:00'})),'2026-10-14').length,6,'al massimo sei settimane');
});

test('riepilogo settimanale: saturazione per macchina e settimana',()=>{
 const state={machineStops:[],tasks:[
  {id:'1',machineId:'A',position:0,status:'planned',segments:[seg('2026-10-12T08:00','2026-10-12T12:00'),seg('2026-10-13T08:00','2026-10-13T12:00')]},
  {id:'2',machineId:'A',position:1,status:'planned',segments:[seg('2026-10-20T08:00','2026-10-20T12:00')]},
 ]};
 const summary=weeklyReleaseSummary(state,[{id:'A'},{id:'B'}],['2026-10-12','2026-10-19'],shiftsMonFri);
 assert.equal(summary.length,2);assert.equal(summary[0].dates.length,7);assert.equal(summary[0].dates[6],'2026-10-18');
 assert.equal(summary[0].machines.find(m=>m.machineId==='A').occupied,480);assert.equal(summary[0].machines.find(m=>m.machineId==='A').available,2400);
 assert.equal(summary[1].machines.find(m=>m.machineId==='A').percent,10);assert.equal(summary[0].machines.find(m=>m.machineId==='B').percent,0);
});

test('attività rimaste da pianificare: le scadenze entro le settimane considerate vengono prima',()=>{
 const state={tasks:[
  {id:'a',title:'Senza consegna',status:'unplanned',machineId:'A'},
  {id:'b',title:'Consegna lontana',status:'unplanned',machineId:'A',dueDate:'2026-12-01'},
  {id:'c',title:'Consegna vicina',status:'unplanned',machineId:'B',dueDate:'2026-10-21'},
  {id:'d',title:'Già scaduta',status:'unplanned',machineId:'A',dueDate:'2026-10-01'},
  {id:'e',title:'Pianificata',status:'planned',machineId:'A',dueDate:'2026-10-14'},
 ]};
 const left=backlogLeftOut(state,['2026-10-12','2026-10-19']);
 assert.equal(left.total,4);assert.equal(left.dueCount,2);assert.deepEqual(left.due.map(t=>t.id),['d','c']);
 assert.deepEqual(backlogLeftOut({tasks:[]},[]),{total:0,due:[],dueCount:0});
});
