import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

const sourcePath=path.resolve(process.env.LATENCY_COPY_SOURCE||path.join('data','aloven.sqlite'));
const label=process.env.LATENCY_LABEL||'measurement';
const stateMode=process.env.LATENCY_STATE_MODE||(process.env.LATENCY_INCLUDE_STATE==='0'?'none':'full');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-latency-'));
const copyPath=path.join(temp,'aloven.sqlite');
const source=new DatabaseSync(sourcePath,{readOnly:true});
try{source.exec(`VACUUM INTO '${copyPath.replaceAll("'","''")}'`);}finally{source.close();}

const copy=new DatabaseSync(copyPath),salt=randomBytes(16).toString('hex');
const password=`${salt}:${scryptSync('LatencyCheck123!',salt,64).toString('hex')}`;
try{copy.prepare('INSERT INTO users(id,name,username,password,role) VALUES (?,?,?,?,?)').run('latency-check','Verifica latenza','latency-check',password,'admin');}finally{copy.close();}

const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:temp,PORT:'0'},stdio:['ignore','pipe','pipe']});
let base;
async function timed(request){const started=performance.now(),response=await request(),body=await response.text();return {ms:Number((performance.now()-started).toFixed(1)),status:response.status,bytes:Buffer.byteLength(body),body};}
try{
  base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Server timeout')),30000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>{output+=chunk;});child.on('exit',code=>reject(new Error(`Server terminato (${code}): ${output}`)));});
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Aloven-Request':'1'},body:JSON.stringify({username:'latency-check',password:'LatencyCheck123!'})});
  assert.equal(login.status,200,await login.text());const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,'Content-Type':'application/json','X-Aloven-Request':'1'};
  const stateResult=await timed(()=>fetch(base+'/api/state',{headers:{Cookie:cookie}}));assert.equal(stateResult.status,200,stateResult.body);
  const state=JSON.parse(stateResult.body),type=state.types[0];assert.ok(type);
  const action=stateMode==='planning'?{kind:'plan',id:state.tasks.find(task=>task.status==='unplanned')?.id}:{kind:'type',id:type.id,values:{name:type.name,color:type.color}};assert.ok(action.id);
  const previewResult=await timed(()=>fetch(base+'/api/preview',{method:'POST',headers,body:JSON.stringify({revision:state.revision,action})}));assert.equal(previewResult.status,200,previewResult.body);
  const preview=JSON.parse(previewResult.body);
  const includeState=stateMode==='full'?true:stateMode==='planning'?'planning':undefined;
  const commitResult=await timed(()=>fetch(base+'/api/commit',{method:'POST',headers,body:JSON.stringify({token:preview.token,...(includeState!==undefined?{includeState}:{})})}));assert.equal(commitResult.status,200,commitResult.body);
  const afterResult=await timed(()=>fetch(base+'/api/state',{headers:{Cookie:cookie}}));assert.equal(afterResult.status,200,afterResult.body);
  const commitBody=JSON.parse(commitResult.body);if(stateMode==='full'){assert.equal(commitBody.state.user.username,'latency-check');assert.ok(commitBody.state.users.some(item=>item.username==='latency-check'));}if(stateMode==='planning'){assert.ok(commitBody.planningState.tasks.some(item=>item.id===action.id));assert.equal(commitBody.planningState.revision,state.revision+1);}
  const report={label,source:sourcePath,measuredAt:new Date().toISOString(),rows:{tasks:state.tasks.length,executions:state.executions.length},state:{ms:stateResult.ms,bytes:stateResult.bytes},preview:{ms:previewResult.ms,bytes:previewResult.bytes},commit:{ms:commitResult.ms,bytes:commitResult.bytes,stateMode},stateAfter:{ms:afterResult.ms,bytes:afterResult.bytes}};
  mkdirSync('.artifacts',{recursive:true});writeFileSync(path.join('.artifacts',`latency-backend-${label}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{
  if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
  rmSync(temp,{recursive:true,force:true});
}
