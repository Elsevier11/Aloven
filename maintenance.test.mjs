import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {effectiveMachineCalendar,effectiveMachineShifts} from './public/calendar.js';
import {scheduleMachine} from './scheduler.mjs';
import {TEST_NOW} from './test-clock.mjs';

const weekly={0:[],1:[['08:00','12:00'],['13:00','17:00']],2:[['08:00','12:00'],['13:00','17:00']],3:[['08:00','12:00'],['13:00','17:00']],4:[['08:00','12:00'],['13:00','17:00']],5:[['08:00','12:00'],['13:00','17:00']],6:[]};

test('sottrae manutenzioni multi-giorno senza alterare eccezioni e rispetta setup indivisibile',()=>{
  const calendar={weekly,exceptions:{'2026-10-13':[['09:00','16:00']]},machineExceptions:{M2:{'2026-10-12':[['10:00','15:00']]}},maintenanceBlocks:[{id:'B1',machineId:'M1',name:'Revisione',start:'2026-10-12T11:00',end:'2026-10-13T10:00'}]};
  assert.deepEqual(effectiveMachineShifts(calendar,'2026-10-12','M1'),[['08:00','11:00']]);
  assert.deepEqual(effectiveMachineShifts(calendar,'2026-10-13','M1'),[['10:00','16:00']]);
  assert.deepEqual(effectiveMachineShifts(calendar,'2026-10-12','M2'),[['10:00','15:00']]);
  assert.deepEqual(calendar.exceptions,{'2026-10-13':[['09:00','16:00']]});
  const result=scheduleMachine([{id:'A',status:'planned',setupMinutes:180,runMinutes:240},{id:'B',status:'planned',setupMinutes:0,runMinutes:120}],'2026-10-12T08:00',effectiveMachineCalendar(calendar,'M1'));
  assert.deepEqual(result[0].segments,[
    {start:'2026-10-12T08:00',end:'2026-10-12T11:00',kind:'setup'},
    {start:'2026-10-13T10:00',end:'2026-10-13T14:00',kind:'run'},
  ]);
  assert.equal(result[1].start,'2026-10-13T14:00');
  assert.deepEqual(effectiveMachineShifts({...calendar,maintenanceBlocks:[]},'2026-10-12','M1'),[['08:00','12:00'],['13:00','17:00']],'rimuovere il blocco ripristina il calendario sottostante');
  assert.throws(()=>scheduleMachine([{
    id:'LOCKED',status:'in_progress',setupMinutes:0,runMinutes:120,start:'2026-10-12T10:00',end:'2026-10-12T12:00',segments:[{start:'2026-10-12T10:00',end:'2026-10-12T12:00',kind:'run'}],
  }],'2026-10-12T08:00',effectiveMachineCalendar(calendar,'M1')),/fuori calendario/i,'una manutenzione non può attraversare attività protette');
  assert.throws(()=>scheduleMachine([{
    id:'PIN',status:'planned',setupMinutes:0,runMinutes:60,fixedStart:'2026-10-12T11:00',
  }],'2026-10-12T08:00',effectiveMachineCalendar(calendar,'M1')),/inizio fissato/i,'un pin incompatibile deve essere rifiutato');
});

test('API manutenzione mantiene una bozza separata dal piano rilasciato, controlla ruolo e persiste',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-maintenance-'));let child,base,cookie='';
  async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});return new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(new Error(errors||'Server non avviato')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(output+errors));});});}
  async function stop(){const done=once(child,'exit');child.kill();await done;}
  async function request(endpoint,data,expected=200,session=cookie){const response=await fetch(`${base}/api/${endpoint}`,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(session?{Cookie:session}:{})},body:data===undefined?undefined:JSON.stringify(data)});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;}
  async function previewCommit(action){const state=await request('state');const preview=await request('preview',{revision:state.revision,action});await request('commit',{token:preview.token});return {preview,state:await request('state')};}
  try{
    base=await start();await request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});const adminCookie=cookie;
    await request('users',{name:'Operatore',username:'operator',password:'PasswordTest123!',role:'operator'});
    let result=await previewCommit({kind:'maintenance',machineId:'CNC-01',start:'2027-01-02T09:00',end:'2027-01-03T11:00',name:'Tagliando annuale'});
    assert.equal(result.preview.maintenance.operation,'add');assert.equal(result.preview.maintenance.block.name,'Tagliando annuale');const block=result.preview.maintenance.block;
    assert.equal(result.state.planning.hasDraftChanges,true);assert.equal(result.state.planning.hasMaintenanceChanges,true);assert.deepEqual(result.state.planning.changedMaintenanceIds,[block.id]);
    assert.equal((await request('state?view=shopfloor')).calendar.maintenanceBlocks.length,0,'la bozza non deve raggiungere il reparto');
    await request('login',{username:'operator',password:'PasswordTest123!'});await request('preview',{revision:(await request('state?view=shopfloor')).revision,action:{kind:'maintenance',id:block.id,remove:true}},403);
    cookie=adminCookie;let state=await request('state');const released=await request('planning/release',{revision:state.revision,reason:'Manutenzione confermata'});assert.equal(released.maintenanceChanged,true);
    assert.equal((await request('state?view=shopfloor')).calendar.maintenanceBlocks[0].id,block.id);
    result=await previewCommit({kind:'maintenance',id:block.id,machineId:'CNC-01',start:'2027-01-02T10:00',end:'2027-01-03T12:00',name:'Tagliando aggiornato'});assert.equal(result.preview.maintenance.operation,'update');
    assert.equal((await request('state?view=shopfloor')).calendar.maintenanceBlocks[0].name,'Tagliando annuale','la modifica resta in bozza');
    result=await previewCommit({kind:'maintenance',id:block.id,remove:true});assert.equal(result.preview.maintenance.operation,'remove');
    assert.equal((await request('state?view=shopfloor')).calendar.maintenanceBlocks.length,1,'la rimozione resta in bozza');
    state=await request('state');await request('planning/release',{revision:state.revision,reason:'Manutenzione annullata'});assert.equal((await request('state?view=shopfloor')).calendar.maintenanceBlocks.length,0);
    await stop();base=await start();cookie='';await request('login',{username:'admin',password:'PasswordTest123!'});assert.deepEqual((await request('state')).calendar.maintenanceBlocks,[]);
  }finally{if(child&&child.exitCode===null)await stop();rmSync(data,{recursive:true,force:true});}
});
