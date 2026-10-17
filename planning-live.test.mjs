import test from 'node:test';
import assert from 'node:assert/strict';
import {delayMinutes,elapsedMinutes,endLabel,liveCellModel,liveStrip,liveTitle,romeMinuteOf,serverClock} from './public/planning-live.js';

const mins=n=>n<60?`${n} min`:`${Math.floor(n/60)} h${n%60?' '+n%60+' min':''}`;
const at=iso=>Date.parse(iso);

test('orologio: minuto di Roma, scarto server/browser, ritardo e trascorso',()=>{
  assert.equal(romeMinuteOf(at('2026-10-07T08:30:00Z')),'2026-10-07T10:30','ottobre: UTC+2');
  assert.equal(romeMinuteOf(at('2026-12-07T08:30:00Z')),'2026-12-07T09:30','dicembre: UTC+1');
  assert.equal(serverClock('2026-10-07T08:00:00Z',1000,61000),at('2026-10-07T08:01:00Z'),'l\'orologio del server avanza con quello locale dopo la ricezione');
  assert.equal(delayMinutes('2026-10-07T10:00',at('2026-10-07T08:25:00Z')),25);
  assert.equal(delayMinutes('2026-10-07T11:00',at('2026-10-07T08:25:00Z')),0,'nessun ritardo prima della fine prevista');
  assert.equal(delayMinutes(null,at('2026-10-07T08:25:00Z')),0);
  assert.equal(elapsedMinutes('2026-10-07T07:40:00Z',at('2026-10-07T09:00:00Z')),80);assert.equal(elapsedMinutes(null,0),null);
  assert.equal(endLabel('2026-10-07T13:30',at('2026-10-07T08:00:00Z')),'13:30');assert.equal(endLabel('2026-10-08T09:00',at('2026-10-07T08:00:00Z')),'08/10 09:00');
});

test('cella viva: stato, tempi, ritardo e fermo come dati',()=>{
  const task={id:'t1',title:'Laminato outdoor',orderReference:'OC-7',outputLot:'L9'};
  const base={machineId:'m',taskId:'t1',plannedEnd:'2026-10-07T10:00',plannedSetupMinutes:30,plannedRunMinutes:120,serverAt:'2026-10-07T08:00:00Z',setupActualSeconds:0,runActualSeconds:600,stop:null};
  const run=liveCellModel({...base,state:'run',phaseSince:'2026-10-07T07:40:00Z'},task,at('2026-10-07T08:30:00Z'),mins);
  assert.equal(run.label,'Produzione');assert.equal(run.tone,'run');assert.ok(run.title.includes('Laminato outdoor'));
  assert.ok(/^da \d\d:\d\d$/.test(run.lines[0]),run.lines[0]);
  assert.ok(run.lines.includes('lavorazione 40 min su 2 h'),'10 min registrati + 30 min trascorsi dalla lettura');assert.ok(run.lines.includes('fine 10:00'));
  assert.equal(run.delay,30);assert.equal(run.alert,true);
  const setup=liveCellModel({...base,state:'setup',phaseSince:'2026-10-07T07:50:00Z',setupActualSeconds:300},task,at('2026-10-07T08:10:00Z'),mins);
  assert.ok(setup.lines.includes('attrezzaggio 15 min su 30 min'));assert.equal(setup.delay,10);
  const stopped=liveCellModel({...base,state:'stopped',phase:'run_paused',stop:{reason:'Guasto motore',startedAt:'2026-10-07T07:55:00Z'}},task,at('2026-10-07T07:58:00Z'),mins);
  assert.equal(stopped.tone,'stopped');assert.equal(stopped.alert,true);assert.ok(stopped.stop.includes('Guasto motore'));assert.equal(stopped.delay,0);
  const stoppedInSetup=liveCellModel({...base,state:'stopped',phase:'setup_running',setupActualSeconds:600,stop:{reason:'Guasto',startedAt:'2026-10-07T07:55:00Z'}},task,at('2026-10-07T07:58:00Z'),mins);
  assert.ok(stoppedInSetup.lines.includes('attrezzaggio 10 min su 30 min'),"un fermo durante la preparazione mostra l'attrezzaggio");
  const paused=liveCellModel({...base,state:'paused'},task,at('2026-10-07T07:58:00Z'),mins);assert.equal(paused.alert,false);assert.ok(paused.lines.includes('lavorazione 10 min su 2 h'),'in pausa il tempo non corre');
  const idle=liveCellModel({machineId:'m',taskId:null,state:'idle',stop:null},null,at('2026-10-07T08:00:00Z'),mins);
  assert.equal(idle.label,'Libera');assert.equal(idle.title,'');assert.deepEqual(idle.lines,[]);assert.equal(idle.alert,false);
});

test('fascia: una cella per macchina visibile, pulsante solo con attività, filtro e compressione',()=>{
  const state={serverNow:'2026-10-07T08:00:00Z',tasks:[{id:'t1',title:'Attività <uno>',machineId:'a'}],liveMachines:[
    {machineId:'a',state:'run',taskId:'t1',phaseSince:'2026-10-07T07:00:00Z',runActualSeconds:60,plannedRunMinutes:60,plannedEnd:'2026-10-07T12:00',stop:null},
    {machineId:'b',state:'idle',taskId:null,stop:null}]};
  const context=extra=>({state,machineFilter:'',collapsed:false,receivedAt:0,mins,machine:id=>({name:`${id.toUpperCase()}-01 · Macchina`}),machineColor:()=>'hsl(10 50% 40%)',esc:value=>String(value).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])),...extra});
  const html=liveStrip(context({receivedAt:Date.now()}));
  assert.equal((html.match(/class="live-cell"/g)||[]).length,2);assert.equal((html.match(/data-live-task=/g)||[]).length,1,'solo la macchina con attività è cliccabile');
  assert.ok(html.includes('Attività &lt;uno&gt;'),'testo escapato');assert.ok(html.includes('1 in corso'));
  assert.equal((liveStrip(context({machineFilter:'b'})).match(/class="live-cell"/g)||[]).length,1);
  const collapsed=liveStrip(context({collapsed:true}));assert.ok(collapsed.includes('data-collapsed="true"')&&collapsed.includes('hidden')&&collapsed.includes('Mostra'));
  assert.equal(liveStrip(context({state:{...state,liveMachines:undefined}})),'','senza dati vivi la fascia non compare');
});

test('titolo della cella: il riferimento non si ripete se è già nel titolo',()=>{
  assert.equal(liveTitle({title:'Laminato · lotto HM-104',outputLot:'HM-104'}),'Laminato · lotto HM-104');
  assert.equal(liveTitle({title:'Laminato outdoor',outputLot:'HM-104',orderReference:'OC-7'}),'Ord. OC-7 · Lotto HM-104 · Laminato outdoor');
  assert.equal(liveTitle({title:'Solo titolo'}),'Solo titolo');
});

test('cella viva: avanzamento sul tempo previsto totale e operatore',()=>{
  const task={id:'t1',title:'Laminato outdoor'};
  const base={machineId:'m',taskId:'t1',plannedEnd:'2026-10-07T12:00',plannedSetupMinutes:30,plannedRunMinutes:90,serverAt:'2026-10-07T08:00:00Z',setupActualSeconds:1800,runActualSeconds:1800,stop:null,operatorName:'Mario Rossi'};
  // 30 min attrezzaggio + 30 min lavorazione già registrati, più 30 min dalla lettura = 90 su 120 → 75 %
  const run=liveCellModel({...base,state:'run',phaseSince:'2026-10-07T07:40:00Z'},task,at('2026-10-07T08:30:00Z'),mins);
  assert.equal(run.progress,75);assert.equal(run.operator,'Mario Rossi');
  // oltre il previsto l'avanzamento supera 100 (la barra si ferma, il numero no)
  const over=liveCellModel({...base,state:'run',runActualSeconds:9000},task,at('2026-10-07T08:00:00Z'),mins);
  assert.equal(over.progress,Math.round((30+150)/120*100));
  // macchina libera o senza tempi previsti: nessun avanzamento
  assert.equal(liveCellModel({machineId:'m',taskId:null,state:'idle'},null,at('2026-10-07T08:00:00Z'),mins).progress,null);
  assert.equal(liveCellModel({...base,plannedSetupMinutes:0,plannedRunMinutes:0,state:'run'},task,at('2026-10-07T08:00:00Z'),mins).progress,null);
});
