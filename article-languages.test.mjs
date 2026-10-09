import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrateArticleLanguages} from './production.mjs';

test('traduzioni articolo: migrazione ripetibile e nessuna modifica ai dati esistenti',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE articles(id TEXT PRIMARY KEY,code TEXT,description TEXT); INSERT INTO articles VALUES('a','FAB-1','Tessuto tecnico'); CREATE TABLE tasks(title TEXT,productDescription TEXT); INSERT INTO tasks VALUES('Ordine esistente','Descrizione storica');");
  migrateArticleLanguages(db);
  assert.deepEqual({...db.prepare('SELECT * FROM articles').get()},{id:'a',code:'FAB-1',description:'Tessuto tecnico',descriptionEn:''});
  db.prepare('UPDATE articles SET descriptionEn=?').run('Technical fabric');
  migrateArticleLanguages(db);
  assert.equal(db.prepare('SELECT descriptionEn FROM articles').get().descriptionEn,'Technical fabric');
  assert.deepEqual({...db.prepare('SELECT * FROM tasks').get()},{title:'Ordine esistente',productDescription:'Descrizione storica'});
 }finally{db.close();}
});
