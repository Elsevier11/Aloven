// Migrazione users-roles-v2: la tabella users accetta anche il ruolo 'planner' (Pianificatore).
// SQLite non permette di modificare un CHECK: la tabella viene ricostruita. Gli utenti esistenti e i loro
// ruoli restano invariati; le sessioni sono conservate (le chiavi esterne sono sospese solo durante la copia).
const FLAG = 'users-roles-v2';

export const USERS_TABLE_SQL = `CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','planner','operator')))`;

export function migrateUserRoles(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!row) return;
  const mark = () => db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(FLAG, '1');
  if (row.sql.includes("'planner'")) { if (!db.prepare('SELECT 1 FROM meta WHERE key=?').get(FLAG)) mark(); return; }
  const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('index','trigger') AND sql IS NOT NULL").all().map(item => item.sql);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(USERS_TABLE_SQL.replace('TABLE users', 'TABLE users_new'));
      db.exec('INSERT INTO users_new(id,name,username,password,role) SELECT id,name,username,password,role FROM users');
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      for (const sql of extras) db.exec(sql);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`Migrazione dei ruoli annullata: relazioni non valide (${JSON.stringify(broken.slice(0, 3))}).`);
      mark();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
