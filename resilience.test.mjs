import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

test('concorrenza, replay, richieste interrotte, riavvii e sessione scaduta conservano il piano', async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-resilience-'));
  let child,base,cookie;
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
    return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Avvio server scaduto: '+output)),10000);child.stderr.on('data',x=>output+=x);child.stdout.on('data',x=>{output+=x;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server terminato: '+output));});});
  }
  async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}}
  async function request(endpoint,body,session=cookie){const response=await fetch(base+'/api/'+endpoint,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json','X-Aloven-Request':'1'}:{}),...(session?{Cookie:session}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  async function ok(endpoint,body,session=cookie){const result=await request(endpoint,body,session);assert.equal(result.status,200,JSON.stringify(result.json));return result.json;}
  const state=()=>ok('state');
  const plan=(id,revision,session=cookie)=>ok('preview',{revision,action:{kind:'plan',id}},session);
  try {
    base=await start();const setup=await request('setup',{name:'Admin test',username:'admin',password:'PasswordTest123!'});assert.equal(setup.status,200);cookie=setup.cookie;
    await ok('users',{name:'Secondo pianificatore',username:'second',password:'PasswordTest123!',role:'admin'});
    const second=(await request('login',{username:'second',password:'PasswordTest123!'})).cookie;
    let before=await state();const [a,b]=before.tasks.filter(t=>t.machineId==='CNC-01'&&t.status==='unplanned');
    const [pa,pb]=await Promise.all([plan(a.id,before.revision),plan(b.id,before.revision,second)]);
    assert.equal((await request('commit',{token:pa.token},second)).status,409,'token riservato al proprietario');
    const races=await Promise.all([request('commit',{token:pa.token}),request('commit',{token:pb.token},second)]);
    assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);
    let after=await state();assert.equal(after.revision,before.revision+1);assert.equal(after.tasks.filter(t=>[a.id,b.id].includes(t.id)&&t.position!==null).length,1);
    const winning=races[0].status===200?pa:pb,winningCookie=races[0].status===200?cookie:second;
    assert.equal((await request('commit',{token:winning.token},winningCookie)).status,409,'un secondo invio non duplica');assert.deepEqual(await state(),after);

    // Disconnect halfway through a declared request body, before JSON can be accepted.
    before=await state();const pending=await plan(before.tasks.find(t=>[a.id,b.id].includes(t.id)&&t.position===null).id,before.revision);
    const url=new URL(base);const socket=net.connect(Number(url.port),url.hostname);await once(socket,'connect');
    socket.write(`POST /api/commit HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${cookie}\r\nX-Aloven-Request: 1\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"token":"`);
    socket.destroy();await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(await state(),before,'richiesta incompleta non salva');
    await stop();base=await start();assert.deepEqual(await state(),before,'riavvio prima del commit non salva anteprime');assert.equal((await request('commit',{token:pending.token})).status,409);

    // Commit was accepted, but the caller discards the body as if the response was lost.
    const retry=await plan(before.tasks.find(t=>[a.id,b.id].includes(t.id)&&t.position===null).id,before.revision);
    const response=await fetch(base+'/api/commit',{method:'POST',headers:{Cookie:cookie,'X-Aloven-Request':'1','Content-Type':'application/json'},body:JSON.stringify({token:retry.token})});assert.equal(response.status,200);await response.body.cancel();
    after=await state();assert.equal(after.revision,before.revision+1);await stop();base=await start();assert.deepEqual(await state(),after,'commit persistente dopo arresto brusco');assert.equal((await request('commit',{token:retry.token})).status,409);assert.deepEqual(await state(),after);

    const expiry=await ok('preview',{revision:after.revision,action:{kind:'plan',id:a.id,unplan:true}});
    await stop();const db=new DatabaseSync(path.join(data,'aloven.sqlite'));try{db.prepare('UPDATE sessions SET expires=?').run(Date.now()-1);}finally{db.close();}base=await start();
    assert.equal((await request('commit',{token:expiry.token})).status,401);assert.equal((await request('state')).status,401);assert.ok(!(await request('session')).json.user);
    const login=await request('login',{username:'admin',password:'PasswordTest123!'});assert.equal(login.status,200);cookie=login.cookie;const restored=await state();assert.equal(restored.revision,after.revision);assert.deepEqual(restored.tasks,after.tasks);
  } finally {await stop();rmSync(data,{recursive:true,force:true});}
});
