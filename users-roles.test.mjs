import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrateUserRoles} from './users-roles.mjs';

function oldDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','operator')));
    CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);`);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('u1', 'Admin', 'admin', 'hash-a', 'admin');
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('u2', 'Mario', 'mario', 'hash-m', 'operator');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('t1', 'u2', 4102444800000);
  return db;
}

test('migrazione: il vecchio schema rifiuta planner, il nuovo lo accetta e conserva utenti, ruoli e sessioni', () => {
  const db = oldDatabase();
  assert.throws(() => db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('u3', 'P', 'p', 'h', 'planner'), /CHECK/);
  migrateUserRoles(db);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('u3', 'Pia', 'pia', 'h', 'planner');
  assert.deepEqual(db.prepare('SELECT id,name,username,password,role FROM users ORDER BY id').all().map(row => ({...row})), [
    {id: 'u1', name: 'Admin', username: 'admin', password: 'hash-a', role: 'admin'},
    {id: 'u2', name: 'Mario', username: 'mario', password: 'hash-m', role: 'operator'},
    {id: 'u3', name: 'Pia', username: 'pia', password: 'h', role: 'planner'},
  ], 'nessun ruolo esistente cambia da solo');
  assert.equal(db.prepare('SELECT user_id FROM sessions WHERE token=?').get('t1').user_id, 'u2', 'le sessioni non vengono cancellate dalla ricostruzione');
  assert.throws(() => db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('u4', 'X', 'x', 'h', 'altro'), /CHECK/);
  assert.throws(() => db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('u5', 'Doppio', 'mario', 'h', 'operator'), /UNIQUE/, 'il vincolo di unicità del nome utente resta');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'le chiavi esterne tornano attive');
  assert.equal(db.prepare('SELECT value FROM meta WHERE key=?').get('users-roles-v2').value, '1');
});

test('migrazione: la cancellazione di un utente elimina ancora le sue sessioni', () => {
  const db = oldDatabase();
  migrateUserRoles(db);
  db.prepare('DELETE FROM users WHERE id=?').run('u2');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('migrazione: ripetibile senza effetti e valida anche su un database già nuovo', () => {
  const db = oldDatabase();
  migrateUserRoles(db);
  const before = db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
  migrateUserRoles(db);
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
});
