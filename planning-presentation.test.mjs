import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchLabel,
  dispatchTone,
  maintenanceReleaseChanges,
  releaseChanges,
  taskBarReference,
  taskReference,
} from './public/planning-presentation.js';

test('taskReference usa solo riferimenti operativi e fallback leggibili', () => {
  assert.equal(taskReference({id:'technical-1', orderReference:'OP-42', outputLot:'L-7', productCode:'P1'}), 'Ord. OP-42 · Lotto L-7');
  assert.equal(taskReference({id:'technical-2', title:'Accoppiatura lotto ABC-19 urgente'}), 'Lotto ABC-19');
  assert.equal(taskReference({id:'technical-3', title:'Prodotto finito', productCode:'ART-8'}), 'ART-8');
  assert.equal(taskReference({id:'technical-4', title:'Lavorazione speciale'}), 'Lavorazione speciale');
  assert.equal(taskReference({id:'technical-only'}), '');
});

test('taskBarReference distingue i lotti dello stesso ordine e conserva il suffisso quando abbrevia', () => {
  const first={orderReference:'ORDINE-COMUNE',outputLot:'LOTTO-ALFA-12345678'};
  const second={orderReference:'ORDINE-COMUNE',outputLot:'LOTTO-BETA-87654321'};
  assert.equal(taskBarReference(first),'LOTT…12345678');
  assert.equal(taskBarReference(second),'LOTT…87654321');
  assert.notEqual(taskBarReference(first),taskBarReference(second));
  assert.equal(taskBarReference({outputLot:'Lotto BREVE-2',orderReference:'Ord. O-9'}),'BREVE-2');
});

test('dispatchLabel e dispatchTone coprono tutti gli stati senza dedurne di nuovi', () => {
  const cases = [
    [{planningState:'released'}, 'Inviata al reparto', 'released'],
    [{planningState:'modified'}, 'Modificata · da inviare', 'modified'],
    [{planningState:'pending_removal'}, 'Da togliere dal reparto', 'removal'],
    [{planningState:'unreleased', position:0}, 'Da inviare al reparto', 'pending'],
    [{planningState:'unreleased', position:null}, 'Non inviata al reparto', 'pending'],
    [{planningState:'in_progress', status:'in_progress', releasedVersion:2}, 'Inviata al reparto', 'released'],
    [{planningState:'in_progress', status:'in_progress'}, 'In produzione', 'pending'],
    [{planningState:'completed', status:'completed', releasedVersion:2}, 'Inviata al reparto', 'released'],
    [{planningState:'completed', status:'completed'}, 'Conclusa', 'pending'],
  ];
  for (const [task, label, tone] of cases) {
    assert.equal(dispatchLabel(task), label);
    assert.equal(dispatchTone(task), tone);
  }
});

test('releaseChanges descrive nuove, modificate e ritirate filtrando gli ID dichiarati', () => {
  const state = {
    planning:{version:4, changedTaskIds:['new','changed','removed']},
    tasks:[
      {id:'new', title:'Nuova', productCode:'P-1', status:'planned', planningState:'unreleased', machineId:'M1', position:0, start:'2026-10-13T08:00', end:'2026-10-13T09:00'},
      {id:'changed', title:'Modificata', orderReference:'O-2', status:'planned', planningState:'modified', releasedVersion:4, releasedMachineId:'M1', machineId:'M2', releasedStart:'2026-10-13T09:00', start:'2026-10-13T10:00', releasedEnd:'2026-10-13T10:00', end:'2026-10-13T11:00'},
      {id:'removed', title:'Ritirata', outputLot:'LOT-3', status:'unplanned', planningState:'pending_removal', releasedVersion:4, releasedMachineId:'M2', releasedStart:'2026-10-13T11:00', releasedEnd:'2026-10-13T12:00'},
      {id:'ignored', title:'Non cambiata', status:'planned', planningState:'modified', machineId:'M9', position:9},
    ],
  };
  assert.deepEqual(releaseChanges(state), [
    {id:'new', title:'Nuova', reference:'P-1', kind:'new', details:[], oldMachineId:null, newMachineId:'M1', oldStart:null, newStart:'2026-10-13T08:00', oldEnd:null, newEnd:'2026-10-13T09:00'},
    {id:'changed', title:'Modificata', reference:'Ord. O-2', kind:'changed', details:[], oldMachineId:'M1', newMachineId:'M2', oldStart:'2026-10-13T09:00', newStart:'2026-10-13T10:00', oldEnd:'2026-10-13T10:00', newEnd:'2026-10-13T11:00'},
    {id:'removed', title:'Ritirata', reference:'Lotto LOT-3', kind:'removed', details:[], oldMachineId:'M2', newMachineId:null, oldStart:'2026-10-13T11:00', newStart:null, oldEnd:'2026-10-13T12:00', newEnd:null},
  ]);
});

test('releaseChanges espone quantità e nome cambiati anche con date invariate e tollera snapshot malformati', () => {
  const common={status:'planned',planningState:'modified',releasedVersion:3,machineId:'M1',releasedMachineId:'M1',position:0,start:'2026-10-13T08:00',releasedStart:'2026-10-13T08:00',end:'2026-10-13T09:00',releasedEnd:'2026-10-13T09:00'};
  const changes=releaseChanges({planning:{version:3,changedTaskIds:['content','broken']},tasks:[
    {...common,id:'content',title:'Nome nuovo',quantity:25,releasedPayload:JSON.stringify({title:'Nome precedente',quantity:20,position:0})},
    {...common,id:'broken',title:'Snapshot non valido',quantity:10,releasedPayload:'{malformato'},
  ]});
  assert.deepEqual(changes[0].details,[
    {label:'Nome attività',before:'Nome precedente',after:'Nome nuovo'},
    {label:'Quantità prevista',before:20,after:25},
  ]);
  assert.equal(changes[0].oldStart,changes[0].newStart);
  assert.equal(changes[0].oldEnd,changes[0].newEnd);
  assert.deepEqual(changes[1].details,[]);
  const reordered=releaseChanges({planning:{version:3,changedTaskIds:['order']},tasks:[{...common,id:'order',title:'Ordine',position:1,releasedPayload:JSON.stringify({...common,title:'Ordine',position:0})}]});
  assert.deepEqual(reordered[0].details,[{label:'Posizione in sequenza',before:1,after:2}]);
});

test('releaseChanges include le attività pianificate al primo rilascio', () => {
  const state={planning:{version:0,changedTaskIds:[]},tasks:[
    {id:'planned',title:'Prima',status:'planned',position:0,machineId:'M1',planningState:'unreleased'},
    {id:'waiting',title:'Attesa',status:'unplanned',position:null,machineId:'M1',planningState:'unreleased'},
  ]};
  assert.deepEqual(releaseChanges(state).map(change=>[change.id,change.kind]), [['planned','new']]);
});

test('maintenanceReleaseChanges confronta solo gli ID dichiarati dal server', () => {
  const state={
    planning:{
      changedMaintenanceIds:['added','edited','removed'],
      releasedMaintenanceBlocks:[
        {id:'edited',name:'Cambio cuscinetti',machineId:'M1',start:'2026-10-14T08:00',end:'2026-10-14T09:00'},
        {id:'removed',name:'Controllo',machineId:'M2',start:'2026-10-15T08:00',end:'2026-10-15T09:00'},
        {id:'not-changed',name:'Stabile',machineId:'M3',start:'2026-10-16T08:00',end:'2026-10-16T09:00'},
      ],
    },
    calendar:{maintenanceBlocks:[
      {id:'added',name:'Pulizia',machineId:'M1',start:'2026-10-13T08:00',end:'2026-10-13T10:00'},
      {id:'edited',name:'Cambio cuscinetti',machineId:'M2',start:'2026-10-14T10:00',end:'2026-10-14T11:00'},
      {id:'not-changed',name:'Stabile',machineId:'M3',start:'2026-10-16T08:00',end:'2026-10-16T09:00'},
    ]},
  };
  assert.deepEqual(maintenanceReleaseChanges(state), [
    {id:'added',kind:'new',name:'Pulizia',oldName:'',newName:'Pulizia',oldMachineId:null,newMachineId:'M1',oldStart:null,newStart:'2026-10-13T08:00',oldEnd:null,newEnd:'2026-10-13T10:00'},
    {id:'edited',kind:'changed',name:'Cambio cuscinetti',oldName:'Cambio cuscinetti',newName:'Cambio cuscinetti',oldMachineId:'M1',newMachineId:'M2',oldStart:'2026-10-14T08:00',newStart:'2026-10-14T10:00',oldEnd:'2026-10-14T09:00',newEnd:'2026-10-14T11:00'},
    {id:'removed',kind:'removed',name:'Controllo',oldName:'Controllo',newName:'',oldMachineId:'M2',newMachineId:null,oldStart:'2026-10-15T08:00',newStart:null,oldEnd:'2026-10-15T09:00',newEnd:null},
  ]);
});
