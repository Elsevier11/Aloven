const ARTICLE_ROLES = [
  ['component1', 'component'],
  ['component2', 'component'],
  ['product', 'product'],
];

// Optional catalogue translation; task and execution snapshots stay unchanged.
export function migrateArticleLanguages(db) {
  addColumn(db, 'articles', "descriptionEn TEXT NOT NULL DEFAULT ''");
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column);
}

function addColumn(db, table, definition) {
  const name = definition.split(/\s+/, 1)[0];
  if (!hasColumn(db, table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function setupFromSegments(task) {
  try {
    const segments = JSON.parse(task.segments || '[]');
    const total = segments.filter(segment => segment?.kind === 'setup').reduce((sum, segment) => {
      const start = Date.parse(`${segment.start}Z`);
      const end = Date.parse(`${segment.end}Z`);
      return Number.isFinite(start) && Number.isFinite(end) && end >= start ? sum + (end - start) / 60000 : sum;
    }, 0);
    return Number.isSafeInteger(total) ? total : task.setupMinutes;
  } catch {
    return task.setupMinutes;
  }
}

function mergedKind(current, role) {
  return current === role || current === 'both' ? current : 'both';
}

/**
 * Adds the production catalogue, speed-based duration and transition setup schema.
 * The marker and revision change are committed atomically, so reruns are no-ops.
 */
export function migrateProduction(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new TypeError('Database SQLite non valido.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM meta WHERE key='production-v1'").get()) {
      db.exec('COMMIT');
      return { migrated: false };
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS articles(
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL,
        unit TEXT NOT NULL CHECK(unit IN ('m','m2','kg')),
        kind TEXT NOT NULL CHECK(kind IN ('component','product','both'))
      );
      CREATE TABLE IF NOT EXISTS setupRules(
        id TEXT PRIMARY KEY,
        machineId TEXT NOT NULL REFERENCES machines(id),
        fromTypeId TEXT NOT NULL REFERENCES types(id),
        toTypeId TEXT NOT NULL REFERENCES types(id),
        minutes INTEGER NOT NULL CHECK(minutes >= 0),
        UNIQUE(machineId,fromTypeId,toTypeId)
      );
    `);

    addColumn(db, 'machines', "speed REAL NOT NULL DEFAULT 10 CHECK(speed > 0)");
    addColumn(db, 'machines', "speedUnit TEXT NOT NULL DEFAULT 'm' CHECK(speedUnit IN ('m','m2','kg'))");
    addColumn(db, 'tasks', 'quantity REAL');
    addColumn(db, 'tasks', "calculationMode TEXT NOT NULL DEFAULT 'manual' CHECK(calculationMode IN ('manual','automatic'))");
    addColumn(db, 'tasks', 'effectiveSetupMinutes INTEGER');
    addColumn(db, 'tasks', 'component1ArticleId TEXT REFERENCES articles(id)');
    addColumn(db, 'tasks', 'component2ArticleId TEXT REFERENCES articles(id)');
    addColumn(db, 'tasks', 'productArticleId TEXT REFERENCES articles(id)');

    const findArticle = db.prepare('SELECT * FROM articles WHERE code=? COLLATE NOCASE');
    const findArticleId = db.prepare('SELECT 1 FROM articles WHERE id=?');
    const insertArticle = db.prepare('INSERT INTO articles(id,code,description,unit,kind) VALUES (?,?,?,?,?)');
    const updateKind = db.prepare('UPDATE articles SET kind=? WHERE id=?');
    const updateTask = db.prepare(`UPDATE tasks SET
      component1ArticleId=?,component2ArticleId=?,productArticleId=?,
      component1Code=?,component1Description=?,component2Code=?,component2Description=?,productCode=?,productDescription=?,
      quantity=NULL,calculationMode='manual',effectiveSetupMinutes=? WHERE id=?`);

    let articleSequence = 1;
    const nextArticleId = () => {
      let id;
      do { id = `article-${String(articleSequence++).padStart(4, '0')}`; } while (findArticleId.get(id));
      return id;
    };
    for (const task of db.prepare('SELECT * FROM tasks ORDER BY rowid').all()) {
      const references = {};
      const snapshots = {};
      for (const [prefix, role] of ARTICLE_ROLES) {
        const code = String(task[`${prefix}Code`] || '').trim();
        const description = String(task[`${prefix}Description`] || '').trim();
        let article = code ? findArticle.get(code) : null;
        if (!article && code && description) {
          const id = nextArticleId();
          insertArticle.run(id, code, description, 'm', role);
          article = findArticle.get(code);
        } else if (article) {
          const kind = mergedKind(article.kind, role);
          if (kind !== article.kind) {
            updateKind.run(kind, article.id);
            article = { ...article, kind };
          }
        }
        references[`${prefix}ArticleId`] = article?.id ?? null;
        const historical = task.status === 'in_progress' || task.status === 'completed';
        snapshots[`${prefix}Code`] = article && !historical ? article.code : code;
        snapshots[`${prefix}Description`] = article && !historical ? article.description : description;
      }
      const effective = task.position === null ? null : (task.status === 'in_progress' || task.status === 'completed'
        ? setupFromSegments(task)
        : task.setupMinutes);
      updateTask.run(
        references.component1ArticleId, references.component2ArticleId, references.productArticleId,
        snapshots.component1Code, snapshots.component1Description,
        snapshots.component2Code, snapshots.component2Description,
        snapshots.productCode, snapshots.productDescription,
        effective, task.id,
      );
    }

    db.prepare("INSERT INTO meta(key,value) VALUES ('production-v1','1')").run();
    db.prepare("INSERT INTO meta(key,value) VALUES ('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();
    db.exec('COMMIT');
    return { migrated: true };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
