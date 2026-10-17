import test from 'node:test';
import assert from 'node:assert/strict';
import {nextTasks,repartoModel,repartoView,NEXT_LIMIT} from './public/reparto.js';

const mins=n=>n<60?`${n} min`:`${Math.floor(n/60)} h${n%60?' '+n%60+' min':''}`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const task=(id,machineId,position,status='planned',extra={})=>({id,title:`Lavorazione ${id}`,machineId,position,status,start:position==null?null:`2026-10-07T${String(8+position).padStart(2,'0')}:00`,planningState:'released',releasedVersion:1,...extra});
const context=(tasks,liveMachines)=>({state:{tasks,liveMachines,serverNow:'2026-10-07T06:30:00Z'},receivedAt:0,mins,esc,machine:id=>({id,name:`${id} · Accoppiatrice`}),machineColor:()=>'#2a6fdb'});
const idle=machineId=>({machineId,state:'idle',taskId:null,stop:null});

test('prossime: solo attività pianificate non avviate della macchina, in ordine di sequenza',()=>{
  const tasks=[task('c',  'M1',2),task('a','M1',0),task('run','M1',1,'in_progress'),task('done','M1',3,'completed'),task('x','M1',null,'unplanned'),task('other','M2',0)];
  assert.deepEqual(nextTasks(tasks,'M1').map(t=>t.id),['a','c']);
  assert.deepEqual(nextTasks(tasks,'M3'),[]);
});

test('modello: limite alle prime attività, conteggio del resto, badge solo se non inviata',()=>{
  const tasks=Array.from({length:NEXT_LIMIT+2},(_,i)=>task(`t${i}`,'M1',i,'planned',i===1?{planningState:'modified'}:{}));
  const [m]=repartoModel(context(tasks,[idle('M1')]),Date.parse('2026-10-07T06:30:00Z'));
  assert.equal(m.next.length,NEXT_LIMIT);assert.equal(m.more,2);
  assert.equal(m.next[0].badge,'');assert.equal(m.next[1].badge,'Modificata · da inviare');
  assert.equal(m.next[0].start,'08:00','oggi solo l’ora');
});

test('modello: macchina in produzione con ritardo, prossime attività separate',()=>{
  const tasks=[task('run','M1',0,'in_progress'),task('n1','M1',1)];
  const live={machineId:'M1',state:'run',taskId:'run',phase:'run_running',phaseSince:'2026-10-07T05:00:00Z',setupActualSeconds:0,runActualSeconds:600,plannedSetupMinutes:30,plannedRunMinutes:60,plannedEnd:'2026-10-07T08:00',stop:null};
  const [m]=repartoModel(context(tasks,[live]),Date.parse('2026-10-07T07:00:00Z'));
  assert.equal(m.cell.state,'run');assert.equal(m.cell.taskId,'run');assert.equal(m.cell.delay,60);
  assert.deepEqual(m.next.map(n=>n.id),['n1'],'l’attività in corso non compare fra le prossime');
});

test('vista: schede per macchina con in corso e prossime; escape dei testi; vuoti espliciti',()=>{
  const tasks=[task('n1','M1',0,'planned',{title:'<b>Rischio</b>'})];
  const html=repartoView(context(tasks,[idle('M1'),idle('M2')]));
  assert.equal((html.match(/class="reparto-card"/g)||[]).length,2);
  assert.ok(html.includes('data-reparto-task="n1"'));assert.ok(!html.includes('<b>Rischio</b>'),'il titolo è escapato');
  assert.ok(html.includes('Nessuna attività in corso'));assert.ok(html.includes('Nessuna attività in programma'),'macchina senza prossime');
  assert.ok(repartoView(context([],[])).includes('Nessuna macchina configurata'));
});

test('righe di dettaglio: operatore e inizio insieme, fine e ritardo insieme, fermo in evidenza',async()=>{
  const {detailLines}=await import('./public/reparto.js');
  const mins=n=>`${n} min`;
  const lines=detailLines({operator:'Mario Rossi',lines:['da 14:50','lavorazione 30 min su 2 h','fine 14/10 13:54'],delay:90,stop:''},{mins});
  assert.deepEqual(lines.map(l=>l.text),['Operatore Mario Rossi · da 14:50','lavorazione 30 min su 2 h','Fine 14/10 13:54 · in ritardo di 90 min']);
  assert.deepEqual(lines.map(l=>!!l.alert),[false,false,true]);
  const stopped=detailLines({operator:'',lines:['fine 10:00'],delay:0,stop:'Fermo dalle 09:00 · Guasto'},{mins});
  assert.deepEqual(stopped.map(l=>l.text),['Fine 10:00','Fermo dalle 09:00 · Guasto']);
  assert.equal(stopped[1].alert,true);
  assert.deepEqual(detailLines({operator:'',lines:[],delay:0,stop:''},{mins}),[]);
});
