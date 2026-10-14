import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {TEST_NOW} from './test-clock.mjs';

test('l’azione generica non avvia né completa: restano annullamento e ripristino',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-status-'));let child,base,cookie='';
  const start=()=>new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});let output='',errors='';const timer=setTimeout(()=>reject(new Error(errors||output||'Server non avviato')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(output+errors));});});
  async function request(endpoint,payload,expected=200){const response=await fetch(`${base}/api/${endpoint}`,{method:payload===undefined?'GET':'POST',headers:{...(payload===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(cookie?{Cookie:cookie}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;}
  async function change(action){const state=await request('state');const preview=await request('preview',{revision:state.revision,action});await request('commit',{token:preview.token});return request('state');}
  try{
    base=await start();await request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
    let state=await request('state');
    const task=state.tasks.find(item=>item.status==='unplanned');assert.ok(task);
    state=await change({kind:'plan',id:task.id});
    await request('planning/release',{revision:state.revision,reason:'Fixture stato'});
    const before=await request('state');
    for(const status of ['in_progress','completed']){
      const rejected=await request('preview',{revision:before.revision,action:{kind:'status',id:task.id,status}},400);
      assert.match(rejected.error,/bordo macchina/);
    }
    const after=await request('state');
    assert.equal(after.revision,before.revision,'nessuna modifica dei dati');
    assert.deepEqual(after.tasks.find(item=>item.id===task.id),before.tasks.find(item=>item.id===task.id));
    assert.equal(after.executions.length,0);
    state=await change({kind:'status',id:task.id,status:'cancelled'});
    assert.equal(state.tasks.find(item=>item.id===task.id).status,'cancelled');
    state=await change({kind:'status',id:task.id,status:'unplanned'});
    assert.equal(state.tasks.find(item=>item.id===task.id).status,'unplanned');
  }finally{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(data,{recursive:true,force:true});}
});
