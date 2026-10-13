import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrateAuditIntegrity,appendAuditIntegrity,verifyAuditIntegrity} from './audit-integrity.mjs';

test('catena audit preserva lo storico, rileva alterazioni e rimozioni, resta idempotente',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES ('revision','1');CREATE TABLE mesAuditLog(id TEXT PRIMARY KEY,reason TEXT);");
    db.prepare('INSERT INTO mesAuditLog VALUES (?,?)').run('old','Storico originale');
    assert.equal(migrateAuditIntegrity(db).records,1);
    assert.equal(migrateAuditIntegrity(db).migrated,false);
    assert.equal(verifyAuditIntegrity(db).valid,true);
    db.exec('BEGIN');
    db.prepare('INSERT INTO mesAuditLog VALUES (?,?)').run('new','Nuovo evento');
    appendAuditIntegrity(db,{id:'new',reason:'Nuovo evento'});
    db.exec('COMMIT');
    assert.equal(verifyAuditIntegrity(db).records,2);
    assert.equal(verifyAuditIntegrity(db).valid,true);
    assert.throws(()=>db.exec("UPDATE mesAuditIntegrity SET hash='false'"));
    db.exec("UPDATE mesAuditLog SET reason='Alterato' WHERE id='old'");
    assert.equal(verifyAuditIntegrity(db).firstInvalidId,'old');
    db.exec("UPDATE mesAuditLog SET reason='Storico originale' WHERE id='old';DELETE FROM mesAuditLog WHERE id='new'");
    assert.equal(verifyAuditIntegrity(db).valid,false);
  }finally{db.close();}
});

test('impronta finale separata rileva il troncamento della coda',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES ('revision','1');CREATE TABLE mesAuditLog(id TEXT PRIMARY KEY,reason TEXT);INSERT INTO mesAuditLog VALUES ('one','Evento');");
    migrateAuditIntegrity(db);
    db.exec('DROP TRIGGER mesAuditIntegrity_no_delete;DELETE FROM mesAuditIntegrity;DELETE FROM mesAuditLog;');
    assert.equal(verifyAuditIntegrity(db).valid,false);
  }finally{db.close();}
});
