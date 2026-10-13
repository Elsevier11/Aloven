import {createHash} from 'node:crypto';

const fields=['id','entityType','entityId','action','at','userId','userName','reason','beforeJson','afterJson','operationId'];
const digest=(row,previousHash)=>createHash('sha256').update(JSON.stringify([previousHash,...fields.map(field=>row[field]??null)])).digest('hex');

/** Existing audit records remain untouched; a separate chain covers their current contents. */
export function migrateAuditIntegrity(db){
  if(db.prepare("SELECT 1 FROM meta WHERE key='audit-integrity-v1'").get())return {migrated:false};
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE mesAuditIntegrity(sequence INTEGER PRIMARY KEY,auditId TEXT NOT NULL UNIQUE,previousHash TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TRIGGER mesAuditIntegrity_no_update BEFORE UPDATE ON mesAuditIntegrity BEGIN SELECT RAISE(ABORT,'La catena audit non può essere modificata.'); END;
      CREATE TRIGGER mesAuditIntegrity_no_delete BEFORE DELETE ON mesAuditIntegrity BEGIN SELECT RAISE(ABORT,'La catena audit non può essere eliminata.'); END;`);
    let previous='',sequence=0;
    const insert=db.prepare('INSERT INTO mesAuditIntegrity VALUES (?,?,?,?)');
    for(const row of db.prepare('SELECT * FROM mesAuditLog ORDER BY rowid').all()){
      const hash=digest(row,previous);insert.run(++sequence,row.id,previous,hash);previous=hash;
    }
    db.prepare("INSERT INTO meta VALUES ('audit-integrity-v1','1')").run();
    db.prepare("INSERT INTO meta VALUES ('audit-integrity-head',?)").run(previous);
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    db.exec('COMMIT');return {migrated:true,records:sequence};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

/** Called inside the audit writer's transaction; fixtures without the migration remain compatible. */
export function appendAuditIntegrity(db,row){
  if(!db.prepare("SELECT 1 FROM meta WHERE key='audit-integrity-v1'").get())return;
  const tail=db.prepare('SELECT * FROM mesAuditIntegrity ORDER BY sequence DESC LIMIT 1').get();
  const previous=tail?.hash||'';
  if(db.prepare("SELECT value FROM meta WHERE key='audit-integrity-head'").get()?.value!==previous)throw new Error('Catena audit incoerente: verifica il registro prima di continuare.');
  const hash=digest(row,previous);
  db.prepare('INSERT INTO mesAuditIntegrity VALUES (?,?,?,?)').run((tail?.sequence||0)+1,row.id,previous,hash);
  db.prepare("UPDATE meta SET value=? WHERE key='audit-integrity-head'").run(hash);
}

export function verifyAuditIntegrity(db){
  const rows=db.prepare('SELECT * FROM mesAuditLog ORDER BY rowid').all();
  const chain=db.prepare('SELECT * FROM mesAuditIntegrity ORDER BY sequence').all();
  let previous='';
  if(rows.length!==chain.length)return {valid:false,records:rows.length,reason:'Numero di registrazioni diverso dalla catena.'};
  for(let index=0;index<rows.length;index++){
    const link=chain[index],hash=digest(rows[index],previous);
    if(link.sequence!==index+1||link.auditId!==rows[index].id||link.previousHash!==previous||link.hash!==hash)return {valid:false,records:rows.length,firstInvalidId:rows[index].id,reason:'Registrazione o collegamento modificato.'};
    previous=hash;
  }
  const valid=db.prepare("SELECT value FROM meta WHERE key='audit-integrity-head'").get()?.value===previous;
  return {valid,records:rows.length,head:previous,...(!valid?{reason:'Impronta finale diversa dalla catena.'}:{})};
}
