import test from 'node:test';
import assert from 'node:assert/strict';
import {taskWarnings} from './task-warnings.mjs';
import {italianHolidays,addItalianHolidays,effectiveMachineCalendar} from './public/calendar.js';
import {scheduleTask} from './scheduler.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {TEST_NOW} from './test-clock.mjs';

test('avvisi dati: componenti uguali, quantità/consegna assenti e consegna passata',()=>{
  assert.equal(taskWarnings({component1Code:'A',component2Code:'a'},'2026-10-13').length,3);
  assert.equal(taskWarnings({quantity:10,dueDate:'2020-01-01'},'2026-10-13').length,1);
  assert.deepEqual(taskWarnings({quantity:10,dueDate:'2026-10-13'},'2026-10-13'),[]);
});

test('festività italiane modificabili senza sovrascrivere eccezioni e turni',()=>{
  assert.equal(italianHolidays(2026)['2026-04-06'],'Lunedì di Pasqua');
  assert.equal(italianHolidays(2027)['2027-03-29'],'Lunedì di Pasqua');
  assert.equal(italianHolidays(2026)['2026-04-05'],'Pasqua');
  assert.equal(italianHolidays(2026)['2026-10-04'],'San Francesco d’Assisi');
  assert.equal(italianHolidays(2025)['2025-10-04'],undefined);
  const original={weekly:Object.fromEntries(Array.from({length:7},(_,day)=>[day,[['08:00','12:00']]])),exceptions:{'2026-01-01':[['09:00','10:00']]},machineExceptions:{}};
  const next=addItalianHolidays(original,2026);
  assert.deepEqual(next.exceptions['2026-01-01'],[['09:00','10:00']]);
  assert.equal(Object.keys(original.exceptions).length,1);
  assert.deepEqual(addItalianHolidays(next,2026),next);
  const task=scheduleTask({setupMinutes:0,runMinutes:120},'2026-12-24T11:00',effectiveMachineCalendar(next,'M'));
  assert.equal(task.end,'2026-12-27T09:00');
});

test('API anteprima espone avvisi senza salvare; utenti con identità duplicata rifiutati',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'aloven-review-'));
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let cookie='';
  try{
    const base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Avvio scaduto')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.on('exit',()=>{clearTimeout(timer);reject(new Error(output));});});
    const request=async(endpoint,data,status=200)=>{const response=await fetch(base+'/api/'+endpoint,{method:data?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-Aloven-Request':'1'},body:data?JSON.stringify(data):undefined});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;return value;};
    await request('setup',{name:'Persona Test',username:'admin',password:'PasswordTest123!'});
    await request('users',{name:'persona test',username:'different',password:'PasswordTest123!',role:'operator'},400);
    let state=await request('state');const source=state.tasks.find(task=>task.component1ArticleId);
    const preview=await request('preview',{revision:state.revision,action:{kind:'task',values:{...source,component2ArticleId:source.component1ArticleId,quantity:null,dueDate:'2020-01-01'}}});
    assert.equal(preview.warnings.length,3);
    assert.equal((await request('state')).tasks.length,state.tasks.length);
    assert.equal((await request('state')).revision,state.revision);
    await request('commit',{token:preview.token});
    assert.equal((await request('state')).tasks.length,state.tasks.length+1);
    const audit=await request('mes/audit');
    assert.equal(audit.integrity.valid,true);
    assert.equal(audit.integrity.records,audit.total);
  }finally{
    if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
    rmSync(dir,{recursive:true,force:true});
  }
});
