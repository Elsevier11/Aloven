function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column);
}

/** Additive and idempotent schema migration for exact planner placement. */
export function migrateFixedStart(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new TypeError('Database SQLite non valido.');
  }
  if (hasColumn(db, 'tasks', 'fixedStart')) return {migrated:false};
  db.exec('ALTER TABLE tasks ADD COLUMN fixedStart TEXT');
  return {migrated:true};
}
