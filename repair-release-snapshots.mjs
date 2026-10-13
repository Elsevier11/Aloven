#!/usr/bin/env node
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {releasedPayload} from './planning-release.mjs';

const dataDir=path.resolve(process.env.DATA_DIR||'data');
const databasePath=path.resolve(process.env.DB_PATH||path.join(dataDir,'aloven.sqlite'));
const backupDir=path.resolve(process.env.BACKUP_DIR||path.join(dataDir,'backups'));
const reportPath=path.resolve(process.env.REPORT_PATH||path.join(dataDir,'release-snapshot-repair-report.json'));
if(!existsSync(databasePath))throw new Error(`Database non trovato: ${databasePath}`);
const db=new DatabaseSync(databasePath);

function comparable(task){
  const value=releasedPayload(task);
  delete value.status;
  return value;
}

function needsRepair(task){
  try{return JSON.stringify(comparable(task))!==JSON.stringify(comparable(JSON.parse(task.releasedPayload)));}
  catch{return true;}
}

function verifiedBackup(){
  mkdirSync(backupDir,{recursive:true});
  const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
  const backup=path.join(backupDir,`aloven-before-release-snapshot-repair-${stamp}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backup);
  const copy=new DatabaseSync(backup,{readOnly:true});
  try{
    if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Il backup SQLite non supera integrity_check.');
    if(copy.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Il backup SQLite contiene violazioni delle chiavi esterne.');
    const sourceCount=db.prepare('SELECT COUNT(*) count FROM tasks').get().count;
    const backupCount=copy.prepare('SELECT COUNT(*) count FROM tasks').get().count;
    if(sourceCount!==backupCount)throw new Error('Il backup SQLite non contiene tutte le attività.');
  }finally{copy.close();}
  return backup;
}

db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
try{
  const selectTargets=()=>db.prepare("SELECT * FROM tasks WHERE status='completed' AND releasedVersion IS NOT NULL AND releasedPayload IS NOT NULL ORDER BY rowid").all().filter(needsRepair);
  const initialTargets=selectTargets();
  if(!initialTargets.length){
    console.log(JSON.stringify({updatedSnapshots:0,backup:null,backupVerified:false,revisionChanged:false,report:null}));
  }else{
    const initialRevision=db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value;
    const backup=verifiedBackup();
    let targets;
    db.exec('BEGIN IMMEDIATE');
    try{
      if(db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value!==initialRevision)throw new Error('I dati sono cambiati durante il backup. Arresta il server e riprova.');
      targets=selectTargets();
      const update=db.prepare('UPDATE tasks SET releasedPayload=? WHERE id=?');
      for(const task of targets)update.run(JSON.stringify(releasedPayload(task)),task.id);
      const remaining=db.prepare("SELECT * FROM tasks WHERE status='completed' AND releasedVersion IS NOT NULL AND releasedPayload IS NOT NULL ORDER BY rowid").all().filter(needsRepair);
      if(remaining.length)throw new Error(`Snapshot ancora disallineati: ${remaining.map(task=>task.id).join(', ')}`);
      if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('La riparazione viola vincoli del database.');
      if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Il database non supera integrity_check dopo la riparazione.');
      db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    const report={updatedSnapshots:targets.length,taskIds:targets.map(task=>task.id),backup,backupVerified:true,revisionChanged:true,completedOnly:true,draftsPublished:false};
    mkdirSync(path.dirname(reportPath),{recursive:true});
    writeFileSync(reportPath,JSON.stringify(report,null,2));
    console.log(JSON.stringify({updatedSnapshots:report.updatedSnapshots,backup:report.backup,backupVerified:true,revisionChanged:true,completedOnly:true,draftsPublished:false,report:reportPath}));
  }
}finally{db.close();}
