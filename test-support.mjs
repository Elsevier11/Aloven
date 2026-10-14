import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

// Fixture di test: porta direttamente un'attività in corso/completata senza consuntivo,
// come i dati storici. Il percorso applicativo passa solo dalle azioni di bordo macchina.
export function forceTaskStatus(dataDir,taskId,status){
  const db=new DatabaseSync(path.join(dataDir,'aloven.sqlite'));
  try{
    if(db.prepare('UPDATE tasks SET status=? WHERE id=?').run(status,taskId).changes!==1)throw new Error(`Attività non trovata: ${taskId}`);
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
  }finally{db.close();}
}
export const isForcedStatus=action=>action?.kind==='status'&&['in_progress','completed'].includes(action.status);
