import test from 'node:test';
import assert from 'node:assert/strict';
import {dayLabel,needsSunday,shiftDate,weekDates,weekLabel,weekLabelShort,weekNumber,weekStart} from './public/planning-week.js';

test('lunedì della settimana: ogni giorno, cambio mese e anno, anno bisestile',()=>{
  for(const day of ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'])assert.equal(weekStart(day),'2026-10-12',day);
  assert.equal(weekStart('2026-10-19'),'2026-10-19');assert.equal(weekStart('2027-01-01'),'2026-12-28','1 gennaio 2027 è venerdì');
  assert.equal(weekStart('2028-02-29'),'2028-02-28','bisestile');assert.equal(weekStart('2028-03-01'),'2028-02-28');
  assert.equal(shiftDate('2026-12-31',1),'2027-01-01');assert.equal(shiftDate('2026-03-29',1),'2026-03-30','cambio ora legale');assert.equal(shiftDate('2026-10-25',1),'2026-10-26');
});

test('numero di settimana ISO: settimane 1, 52 e 53 e cambio d\'anno',()=>{
  assert.equal(weekNumber('2026-10-12'),42);assert.equal(weekNumber('2026-10-18'),42);assert.equal(weekNumber('2026-10-19'),43);
  assert.equal(weekNumber('2026-12-28'),53,'2026 ha 53 settimane ISO');assert.equal(weekNumber('2027-01-03'),53);assert.equal(weekNumber('2027-01-04'),1);
  assert.equal(weekNumber('2025-12-29'),1,'il 29 dicembre 2025 appartiene alla settimana 1 del 2026');assert.equal(weekNumber('2024-12-30'),1);assert.equal(weekNumber('2025-12-28'),52);assert.equal(weekNumber('2026-01-01'),1);
});

test('date della settimana e etichetta: sabato sì, domenica solo se richiesta',()=>{
  const six=weekDates('2026-10-15');assert.deepEqual(six,['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17']);
  assert.equal(weekDates('2026-10-18',{sunday:true}).length,7);assert.equal(weekDates('2026-10-18',{sunday:true}).at(-1),'2026-10-18');
  assert.equal(weekLabel(six),'Settimana 42 · 12–17 ott 2026');
  assert.equal(weekLabel(weekDates('2026-09-30')),'Settimana 40 · 28 set – 3 ott 2026','mesi diversi');
  assert.equal(weekLabel(weekDates('2026-12-30')),'Settimana 53 · 28 dic 2026 – 2 gen 2027','anni diversi');
  assert.equal(weekLabel(weekDates('2026-10-15',{sunday:true})),'Settimana 42 · 12–18 ott 2026');
  assert.match(dayLabel('2026-10-13'),/^mar 13 ott 2026$/);
});

test('la domenica compare solo se serve: turno, eccezione, attività o indisponibilità sulle macchine visibili',()=>{
  const sunday='2026-10-18',machines=[{id:'a'},{id:'b'}];
  const base={machines,tasks:[],calendar:{maintenanceBlocks:[]},effectiveShifts:()=>[]};
  assert.equal(needsSunday(sunday,base),false,'domenica chiusa e vuota');
  assert.equal(needsSunday(sunday,{...base,effectiveShifts:(day,id)=>id==='b'?[['08:00','12:00']]:[]}),true,'una macchina con turno');
  assert.equal(needsSunday(sunday,{...base,machines:[{id:'a'}],effectiveShifts:(day,id)=>id==='b'?[['08:00','12:00']]:[]}),false,'il turno è di una macchina non visibile');
  const task=(extra={})=>({machineId:'a',position:0,status:'planned',segments:[{kind:'run',start:'2026-10-18T08:00',end:'2026-10-18T10:00'}],...extra});
  assert.equal(needsSunday(sunday,{...base,tasks:[task()]}),true,'attività pianificata di domenica');
  assert.equal(needsSunday(sunday,{...base,tasks:[task({segments:[{kind:'run',start:'2026-10-17T22:00',end:'2026-10-18T02:00'}]})]}),true,'attività che finisce di domenica');
  assert.equal(needsSunday(sunday,{...base,tasks:[task({status:'cancelled'})]}),false);assert.equal(needsSunday(sunday,{...base,tasks:[task({position:null})]}),false);assert.equal(needsSunday(sunday,{...base,tasks:[task({machineId:'zzz'})]}),false);
  assert.equal(needsSunday(sunday,{...base,calendar:{maintenanceBlocks:[{machineId:'a',start:'2026-10-17T20:00',end:'2026-10-19T06:00'}]}}),true,'indisponibilità che copre la domenica');
  assert.equal(needsSunday(sunday,{...base,calendar:{maintenanceBlocks:[{machineId:'zzz',start:'2026-10-18T08:00',end:'2026-10-18T09:00'}]}}),false);
});

test('etichetta compatta per schermi stretti: senza anno',()=>{
  assert.equal(weekLabelShort(weekDates('2026-10-15')),'Sett. 42 · 12–17 ott');
  assert.equal(weekLabelShort(weekDates('2026-09-30')),'Sett. 40 · 28 set – 3 ott');
  assert.equal(weekLabelShort(weekDates('2026-12-30')),'Sett. 53 · 28 dic – 2 gen');
});
