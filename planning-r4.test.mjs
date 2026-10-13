import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';

test('R4: le schede non pianificate non ricalcolano il piano e i ricalcoli non tornano nel passato',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-r4-'));
  let child,base,cookie='';
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data,ALOVEN_NOW:'2026-10-12T07:15:30Z',TZ:'UTC'},stdio:['ignore','pipe','pipe']});
    return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Server non avviato: ${output}`)),10000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>{output+=chunk;});child.on('exit',()=>{clearTimeout(timer);reject(new Error(`Server terminato: ${output}`));});});
  }
  async function request(endpoint,data,expected=200){
    const response=await fetch(`${base}/api/${endpoint}`,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json','X-Aloven-Request':'1'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});
    const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return json;
  }
  async function preview(action,state=undefined){const current=state??await request('state');return request('preview',{revision:current.revision,action});}
  async function change(action){const result=await preview(action);await request('commit',{token:result.token});return request('state');}
  async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
  const values=(title,machineId,typeId,overrides={})=>({title,machineId,typeId,setupMinutes:0,runMinutes:60,quantity:null,calculationMode:'manual',notes:'',component1Code:'',component1Description:'',component2Code:'',component2Description:'',productCode:'',productDescription:'',...overrides});
  try{
    base=await start();await request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
    let state=await change({kind:'machine',values:{name:'R4',description:'',anchor:'2026-10-08T08:00',speed:10,speedUnit:'m'}});
    const machine=state.machines.find(item=>item.name==='R4'),type=state.types[0];

    let result=await preview({kind:'task',values:values('Prima',machine.id,type.id)},state);
    assert.deepEqual(result.changes,[],'creare una scheda da pianificare non deve modificare il piano');
    await request('commit',{token:result.token});state=await request('state');
    const first=state.tasks.find(item=>item.title==='Prima');
    state=await change({kind:'plan',id:first.id});
    assert.equal(state.tasks.find(item=>item.id===first.id).start,'2026-10-12T09:16','ora Roma arrotondata in avanti al minuto anche con host UTC');

    result=await preview({kind:'task',values:values('Seconda',machine.id,type.id)},state);
    assert.deepEqual(result.changes,[],'una nuova scheda non pianificata non deve ricalcolare attività esistenti');
    await request('commit',{token:result.token});state=await request('state');
    const second=state.tasks.find(item=>item.title==='Seconda');
    result=await preview({kind:'task',id:second.id,values:values('Seconda aggiornata',machine.id,type.id,{runMinutes:90})},state);
    assert.equal(result.changes.some(change=>change.id!==second.id),false,'modificare una scheda non pianificata non deve ricalcolare altre attività');
    await request('commit',{token:result.token});state=await request('state');

    result=await preview({kind:'task',id:first.id,values:values('Prima aggiornata',machine.id,type.id,{runMinutes:75})},state);
    const moved=result.changes.find(change=>change.id===first.id);
    assert.ok(moved&&moved.start>='2026-10-12T09:16',`inizio ricalcolato inatteso: ${moved?.start}`);
    await request('commit',{token:result.token});state=await request('state');

    const fixedCreate=await preview({kind:'task',values:values('Fissata',machine.id,type.id)},state);await request('commit',{token:fixedCreate.token});state=await request('state');
    const fixed=state.tasks.find(item=>item.title==='Fissata');
    await assert.rejects(()=>preview({kind:'plan',id:fixed.id,fixedStart:'2026-10-09T08:00'},state),/400/,'una nuova data fissata nel passato deve essere rifiutata');
    state=await change({kind:'plan',id:fixed.id,fixedStart:'2026-10-13T08:00'});
    result=await preview({kind:'task',id:fixed.id,values:values('Fissata aggiornata',machine.id,type.id,{runMinutes:30})},state);
    assert.equal(result.changes.find(change=>change.id===fixed.id)?.start,'2026-10-13T08:00','un inizio fissato deve restare invariato');
  }finally{await stop();rmSync(data,{recursive:true,force:true});}
});
