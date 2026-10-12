import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';

const planningFields=['machineId','setupMinutes','runMinutes','status','position','start','end','segments','effectiveSetupMinutes','fixedStart'];
const planningProjection=tasks=>Object.fromEntries(tasks.map(task=>[task.id,Object.fromEntries(planningFields.map(field=>[field,structuredClone(task[field]??null)]))]));

test('cascata esplicita, anteprima completa e annullamento sicuro dell’ultimo spostamento',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-planner-backend-'));let child,base,cookie='';
  const start=()=>new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});let output='',errors='';const timer=setTimeout(()=>reject(new Error(errors||output||'Server non avviato')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(output+errors));});});
  const stop=async()=>{const done=once(child,'exit');child.kill();await done;};
  async function request(endpoint,payload,expected=200,session=cookie){const response=await fetch(`${base}/api/${endpoint}`,{method:payload===undefined?'GET':'POST',headers:{...(payload===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(session?{Cookie:session}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;}
  async function commit(action,includeState='planning'){const state=await request('state');const preview=await request('preview',{revision:state.revision,action});const result=await request('commit',{token:preview.token,includeState});return {preview,result,state:await request('state')};}
  try{
    base=await start();await request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});const adminCookie=cookie;
    await request('users',{name:'Operatore',username:'operator',password:'PasswordTest123!',role:'operator'});
    let state=await request('state');const cnc=state.tasks.filter(task=>task.machineId==='CNC-01').slice(0,4),other=state.tasks.find(task=>task.machineId==='TOR-02');
    assert.equal(cnc.length,4);assert.ok(other);
    for(const task of [...cnc.slice(0,3),other])({state}=await commit({kind:'plan',id:task.id}));
    ({state}=await commit({kind:'plan',id:cnc[3].id,fixedStart:'2027-01-04T08:00'}));
    const before=state,beforePlanning=planningProjection(before.tasks),beforeReleased=Object.fromEntries(before.tasks.map(task=>[task.id,[task.releasedPayload,task.releasedVersion]]));
    const [first,chosen,following,pinned]=cnc.map(task=>before.tasks.find(item=>item.id===task.id));const otherBefore=before.tasks.find(task=>task.id===other.id);
    const occupiedStart=new Date(`${following.start}Z`);occupiedStart.setUTCMinutes(occupiedStart.getUTCMinutes()+1);const cascadeStart=occupiedStart.toISOString().slice(0,16);
    assert.equal(pinned.fixedStart,'2027-01-04T08:00');

    const single=await request('preview',{revision:before.revision,action:{kind:'plan',id:chosen.id,fixedStart:cascadeStart}},400);
    assert.match(single.error,/sovrappone|modificherebbe un’altra attività/i,'la modalità singola deve continuare a rifiutare lo spostamento della coda');
    assert.deepEqual(planningProjection((await request('state')).tasks),beforePlanning,'un’anteprima fallita deve essere atomica');

    const invalid=await request('preview',{revision:before.revision,action:{kind:'plan',id:chosen.id,fixedStart:'2027-01-04T12:30',shiftFollowing:true}},400);
    assert.ok(!invalid.error.includes(chosen.id));assert.match(invalid.error,/“.+”/);assert.match(invalid.error,/04\/01\/2027 12:30/);
    assert.equal((await request('state')).revision,before.revision);

    const cascadePreview=await request('preview',{revision:before.revision,action:{kind:'plan',id:chosen.id,fixedStart:cascadeStart,shiftFollowing:true}});
    assert.equal(cascadePreview.placement.id,chosen.id);assert.equal(cascadePreview.placement.start,cascadeStart);assert.ok(cascadePreview.placement.segments.length>0);
    assert.ok(cascadePreview.placements.some(task=>task.id===chosen.id&&task.segments.length>0));assert.ok(cascadePreview.placements.some(task=>task.id===following.id),'la cascata deve esporre i segmenti ricalcolati');
    const committed=await request('commit',{token:cascadePreview.token,includeState:'planning'});assert.ok(committed.undo.token);assert.equal(committed.undo.revision,before.revision+1);
    state=await request('state');const afterFirst=state.tasks.find(task=>task.id===first.id),afterChosen=state.tasks.find(task=>task.id===chosen.id),afterFollowing=state.tasks.find(task=>task.id===following.id),afterPinned=state.tasks.find(task=>task.id===pinned.id);
    assert.equal(afterFirst.start,first.start,'il prefisso deve mantenere l’inizio');assert.equal(afterChosen.start,cascadeStart,'l’attività scelta deve iniziare al minuto richiesto anche dentro un’attività non fissata');assert.ok(afterFollowing.start>=afterChosen.end,'l’attività che occupava il punto e la coda devono essere ricalcolate dopo quella scelta');assert.equal(afterPinned.start,pinned.start,'un pin futuro deve restare protetto');assert.equal(state.tasks.find(task=>task.id===other.id).start,otherBefore.start,'le altre macchine devono restare immutate');

    await request('login',{username:'operator',password:'PasswordTest123!'});await request('planning/undo',{token:committed.undo.token,revision:committed.undo.revision},409);cookie=adminCookie;
    const undone=await request('planning/undo',{token:committed.undo.token,revision:committed.undo.revision});assert.equal(undone.planningState.revision,committed.undo.revision+1);state=await request('state');
    assert.deepEqual(planningProjection(state.tasks),beforePlanning,'l’annullamento deve ripristinare esattamente tutti i campi di pianificazione');assert.deepEqual(Object.fromEntries(state.tasks.map(task=>[task.id,[task.releasedPayload,task.releasedVersion]])),beforeReleased,'il piano pubblicato deve restare invariato');
    await request('planning/undo',{token:committed.undo.token,revision:committed.undo.revision},409);

    const movable=state.tasks.find(task=>task.id===pinned.id);({state}=await commit({kind:'task',id:movable.id,values:{...movable,compatibleMachineIds:['CNC-01','TOR-02'],preferredMachineId:null}},true));
    const sourceStarts=Object.fromEntries(state.tasks.filter(task=>task.machineId==='CNC-01'&&task.position!=null&&task.id!==movable.id).map(task=>[task.id,task.start]));const targetOccupied=state.tasks.find(task=>task.id===other.id);
    const crossPreview=await request('preview',{revision:state.revision,action:{kind:'plan',id:movable.id,machineId:'TOR-02',fixedStart:targetOccupied.start,shiftFollowing:true}});assert.equal(crossPreview.placement.machineId,'TOR-02');
    await request('commit',{token:crossPreview.token,includeState:'planning'});state=await request('state');
    for(const [id,start] of Object.entries(sourceStarts))assert.equal(state.tasks.find(task=>task.id===id).start,start,'il cambio macchina in cascata deve preservare gli inizi della macchina sorgente');
    assert.equal(state.tasks.find(task=>task.id===movable.id).start,targetOccupied.start);assert.ok(state.tasks.find(task=>task.id===other.id).start>=state.tasks.find(task=>task.id===movable.id).end,'l’attività occupata sulla destinazione deve essere spostata in coda');

    const latest=await commit({kind:'plan',id:chosen.id,unplan:true});assert.ok(latest.result.undo);
    await request('planning/release',{revision:latest.state.revision,reason:'Test invalidazione undo'});
    await request('planning/undo',{token:latest.result.undo.token,revision:latest.result.undo.revision},409);
  }finally{if(child&&child.exitCode===null)await stop();rmSync(data,{recursive:true,force:true});}
});

test('la vista planning omette lo storico completato salvo richiesta esplicita',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-planning-view-'));let child,base,cookie='';
  const start=()=>new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});let output='',errors='';const timer=setTimeout(()=>reject(new Error(errors||output||'Server non avviato')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(output+errors));});});
  const stop=async()=>{const done=once(child,'exit');child.kill();await done;};
  async function request(endpoint,payload,expected=200){const response=await fetch(`${base}/api/${endpoint}`,{method:payload===undefined?'GET':'POST',headers:{...(payload===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(cookie?{Cookie:cookie}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;}
  async function change(action){const state=await request('state');const preview=await request('preview',{revision:state.revision,action});await request('commit',{token:preview.token});return request('state');}
  try{
    base=await start();await request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});let state=await request('state');const fullInitialCount=state.tasks.length;
    const [first,second,pendingRemoval]=state.tasks.filter(task=>task.machineId==='CNC-01'&&task.status==='unplanned').slice(0,3);assert.ok(first&&second&&pendingRemoval);
    for(const task of [first,second,pendingRemoval])state=await change({kind:'plan',id:task.id});
    await request('planning/release',{revision:state.revision,reason:'Fixture vista planning'});
    for(const task of [first,second]){state=await change({kind:'status',id:task.id,status:'in_progress'});state=await change({kind:'status',id:task.id,status:'completed'});}
    state=await change({kind:'status',id:pendingRemoval.id,status:'cancelled'});

    const full=await request('state'),shopfloor=await request('state?view=shopfloor'),planning=await request('state?view=planning'),history=await request('state?view=planning&includeCompleted=1');
    assert.equal(full.tasks.length,fullInitialCount);assert.equal(shopfloor.tasks.length,full.tasks.length);assert.equal(full.scope,undefined);assert.equal(shopfloor.scope,undefined);
    assert.equal(planning.scope,'planning');assert.equal(planning.completeHistory,false);assert.deepEqual(planning.executions,[]);assert.ok(planning.machineStops.every(stop=>stop.endedAt==null));assert.ok(planning.interruptionRequests.every(request=>request.status==='requested'));
    assert.ok(!planning.tasks.some(task=>task.id===first.id));assert.ok(planning.tasks.some(task=>task.id===second.id&&task.status==='completed'&&task.position!=null),'l’ultimo completato deve restare come ancoraggio bloccato');assert.ok(planning.tasks.some(task=>task.id===pendingRemoval.id&&task.planningState==='pending_removal'),'un ritiro ancora da rilasciare deve restare visibile');
    assert.equal(history.scope,'planning');assert.equal(history.completeHistory,true);assert.ok(history.tasks.some(task=>task.id===first.id));assert.ok(history.tasks.some(task=>task.id===second.id));
    const latestCompleted=new Map();for(const task of full.tasks)if(task.status==='completed'&&task.position!=null){const previous=latestCompleted.get(task.machineId);if(!previous||task.position>previous.position||(task.position===previous.position&&(task.end||'')>(previous.end||'')))latestCompleted.set(task.machineId,task);}
    const expectedIds=full.tasks.filter(task=>task.status==='completed'?latestCompleted.get(task.machineId)?.id===task.id:task.status==='cancelled'?task.planningState==='pending_removal':['planned','unplanned','in_progress'].includes(task.status)).map(task=>task.id).sort();
    assert.deepEqual(planning.tasks.map(task=>task.id).sort(),expectedIds,'la proiezione deve conservare tutte e sole le attività operative necessarie');

    let preview=await request('preview',{revision:full.revision,action:{kind:'type',values:{name:'Tipo proiezione',color:'#123456'}}});let committed=await request('commit',{token:preview.token,includeState:'planner'});
    assert.equal(committed.state.scope,'planning');assert.equal(committed.state.completeHistory,false);assert.ok(!committed.state.tasks.some(task=>task.id===first.id),'un commit non-plan non deve rispedire lo storico completo');
    preview=await request('preview',{revision:committed.state.revision,action:{kind:'type',values:{name:'Tipo proiezione storico',color:'#654321'}}});committed=await request('commit',{token:preview.token,includeState:'planner',includeCompleted:true});
    assert.equal(committed.state.completeHistory,true);assert.ok(committed.state.tasks.some(task=>task.id===first.id),'il flag esplicito deve valere anche nella risposta del commit');
  }finally{if(child&&child.exitCode===null)await stop();rmSync(data,{recursive:true,force:true});}
});
