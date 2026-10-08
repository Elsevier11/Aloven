import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('Database, multiutente, CRUD, riordino confermato e conflitti concorrenti',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-test-'));
  let child;
  async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data},stdio:['ignore','pipe','pipe']});return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Server non avviato')),10000);child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.on('exit',()=>{clearTimeout(timer);reject(new Error('Server terminato: '+output));});});}
  let base,cookie='';
  async function request(endpoint,data,expected=200,session=cookie){const r=await fetch(base+'/api/'+endpoint,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json','X-Aloven-Request':'1'}:{}),...(session?{Cookie:session}:{})},body:data?JSON.stringify(data):undefined});const json=await r.json();assert.equal(r.status,expected,JSON.stringify(json));if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return json;}
  async function change(action){const s=await request('state');const p=await request('preview',{revision:s.revision,action});await request('commit',{token:p.token});return request('state');}
  async function stop(){const done=once(child,'exit');child.kill();await done;}
  try {
    base=await start();assert.equal((await request('session')).needsSetup,true);await request('state',undefined,401);
    await request('setup',{name:'Amministratore',username:'admin',password:'PasswordTest123!'});const adminCookie=cookie;
    await request('setup',{name:'Altro',username:'other',password:'PasswordTest123!'},409);
    let s=await request('state');assert.equal(s.machines.length,4);assert.equal(s.tasks.length,64);
    const materialFields=['component1Code','component1Description','component2Code','component2Description','productCode','productDescription'];
    assert.ok(s.tasks.every(t=>materialFields.every(field=>typeof t[field]==='string'&&t[field].length>0)));
    const mid='CNC-01';const [a,b]=s.tasks.filter(t=>t.machineId===mid);
    s=await change({kind:'machine',id:mid,values:{name:'Accoppiatrice PUR test',description:'Test',anchor:'2026-10-09T08:00'}});
    s=await change({kind:'plan',id:a.id});assert.equal(s.tasks.find(t=>t.id===a.id).start,'2026-10-09T08:00');
    s=await change({kind:'plan',id:b.id});const before=s.tasks.find(t=>t.id===b.id);assert.equal(before.start,'2026-10-09T13:00');assert.equal(before.end,'2026-10-12T10:45');
    const p=await request('preview',{revision:s.revision,action:{kind:'plan',id:b.id,beforeId:a.id}});assert.equal(p.changes.length,2);
    assert.equal((await request('state')).tasks.find(t=>t.id===a.id).position,0,'L’anteprima non deve salvare');
    await request('commit',{token:p.token});s=await request('state');assert.equal(s.tasks.find(t=>t.id===b.id).position,0);
    // A stale preview must not overwrite a later change.
    const stale=await request('preview',{revision:s.revision,action:{kind:'plan',id:a.id,unplan:true}});
    s=await change({kind:'type',values:{name:'Assemblaggio',color:'#ff9900'}});await request('commit',{token:stale.token},409);
    await request('preview',{revision:s.revision-1,action:{kind:'plan',id:a.id}},409);
    // Lock one activity, then block reorder / edit / delete, and prevent two running activities.
    s=await change({kind:'status',id:b.id,status:'in_progress'});const frozen=s.tasks.find(t=>t.id===b.id);
    for(const action of [{kind:'plan',id:b.id,unplan:true},{kind:'task',id:b.id,remove:true},{kind:'plan',id:a.id,beforeId:b.id},{kind:'status',id:a.id,status:'in_progress'}])await request('preview',{revision:s.revision,action},400);
    s=await change({kind:'plan',id:a.id,unplan:true});assert.deepEqual(s.tasks.find(t=>t.id===b.id),frozen);
    const materials={component1Code:'TES-TEST',component1Description:'Tessuto poliestere test',component2Code:'MEM-TEST',component2Description:'Membrana TPU test',productCode:'ACC-TEST',productDescription:'Accoppiato tecnico test'};
    for(const field of materialFields){const invalid={title:'Prova',machineId:mid,typeId:'fresatura',setupMinutes:15,runMinutes:900,notes:'Test',...materials,[field]:''};await request('preview',{revision:s.revision,action:{kind:'task',values:invalid}},400);}
    s=await change({kind:'task',values:{title:'Prova',machineId:mid,typeId:'fresatura',setupMinutes:15,runMinutes:900,notes:'Test',...materials}});const created=s.tasks.find(t=>t.title==='Prova');
    for(const field of materialFields)assert.equal(created[field],materials[field]);
    s=await change({kind:'task',id:created.id,values:{...created,title:'Prova aggiornata'}});assert.ok(s.tasks.some(t=>t.title==='Prova aggiornata'));
    s=await change({kind:'task',id:created.id,remove:true});assert.ok(!s.tasks.some(t=>t.id===created.id));
    s=await change({kind:'type',values:{name:'Tipologia CRUD',color:'#112233'}});const ty=s.types.find(t=>t.name==='Tipologia CRUD');
    s=await change({kind:'type',id:ty.id,values:{name:'Tipologia modificata',color:'#334455'}});assert.equal(s.types.find(t=>t.id===ty.id).name,'Tipologia modificata');
    s=await change({kind:'type',id:ty.id,remove:true});assert.ok(!s.types.some(t=>t.id===ty.id));
    s=await change({kind:'machine',values:{name:'Macchina CRUD',description:'Nuova',anchor:'2026-10-08T08:00'}});const ma=s.machines.find(m=>m.name==='Macchina CRUD');
    s=await change({kind:'machine',id:ma.id,values:{...ma,name:'Macchina modificata'}});assert.equal(s.machines.find(m=>m.id===ma.id).name,'Macchina modificata');
    s=await change({kind:'machine',id:ma.id,remove:true});assert.ok(!s.machines.some(m=>m.id===ma.id));
    await request('preview',{revision:s.revision,action:{kind:'machine',id:mid,remove:true}},400);
    await request('preview',{revision:s.revision,action:{kind:'type',id:'fresatura',remove:true}},400);
    // General exception and machine exception precedence; only the selected machine shifts.
    s=await change({kind:'plan',id:s.tasks.find(t=>t.machineId==='TOR-02').id});const tor=s.tasks.find(t=>t.machineId==='TOR-02');
    const cal=structuredClone(s.calendar);cal.exceptions['2026-10-13']=[];cal.machineExceptions['LAS-03']={'2026-10-08':[]};
    s=await change({kind:'calendar',values:cal});assert.deepEqual(s.tasks.find(t=>t.id===b.id),frozen);assert.deepEqual(s.tasks.find(t=>t.id===tor.id),tor);
    const conflicting=structuredClone(s.calendar);conflicting.exceptions[frozen.start.slice(0,10)]=[];
    await request('preview',{revision:s.revision,action:{kind:'calendar',values:conflicting}},400);
    await request('users',{name:'Operatore',username:'operator',password:'PasswordTest123!',role:'operator'});
    await request('login',{username:'operator',password:'PasswordTest123!'});assert.equal((await request('state')).users.length,0);
    const operatorState=await request('state');await request('preview',{revision:operatorState.revision,action:{kind:'machine',id:mid,remove:true}},403);
    await request('users',{name:'Abuso',username:'abuse',password:'PasswordTest123!',role:'admin'},403);
    cookie=adminCookie;const admin=(await request('state')).users.find(u=>u.username==='admin');await request('users',{id:admin.id,remove:true},400);
    const op=(await request('state')).users.find(u=>u.username==='operator');
    await request('users',{id:op.id,name:'Operatore modificato',username:'operator2',role:'operator'});assert.equal((await request('state')).users.find(u=>u.id===op.id).username,'operator2');
    await request('users',{id:op.id,remove:true});
    s=await change({kind:'task',id:'textile-demo-060',remove:true});
    const beforeRestart=await request('state');await stop();base=await start();assert.deepEqual((await request('state')).tasks,beforeRestart.tasks,'Il database deve sopravvivere al riavvio e non ricreare esempi eliminati');
    await request('logout',{});await request('state',undefined,401);assert.equal((await request('session')).needsSetup,false);
  } finally {if(child&&child.exitCode===null)await stop();rmSync(data,{recursive:true,force:true});}
});
