const COLUMNS = [
  'component1Code',
  'component1Description',
  'component2Code',
  'component2Description',
  'productCode',
  'productDescription',
];

const MACHINE_SPECS = [
  { legacyId: 'CNC-01', legacyName: 'Centro di lavoro CNC', preferredId: 'ACC-01', name: 'ACC-01 · Accoppiatrice hot melt PUR', description: 'Accoppiatura tessile con adesivo hot melt PUR' },
  { legacyId: 'TOR-02', legacyName: 'Tornio automatico', preferredId: 'ACC-02', name: 'ACC-02 · Calandra film/web', description: 'Accoppiatura termica continua di film e web' },
  { legacyId: 'LAS-03', legacyName: 'Taglio laser', preferredId: 'ACC-03', name: 'ACC-03 · Accoppiatrice a fiamma', description: 'Accoppiatura a fiamma di tessuti e schiume' },
  { preferredId: 'ACC-04', name: 'ACC-04 · Accoppiatrice a polvere', description: 'Accoppiatura tessile con adesivo termoplastico in polvere' },
];

const TYPE_SPECS = [
  { legacyId: 'fresatura', legacyName: 'Fresatura', preferredId: 'textile-hot-melt', name: 'Accoppiatura hot melt PUR', color: '#2563eb' },
  { legacyId: 'tornitura', legacyName: 'Tornitura', preferredId: 'textile-film-web', name: 'Accoppiatura termica film/web', color: '#0891b2' },
  { legacyId: 'taglio', legacyName: 'Taglio', preferredId: 'textile-fiamma', name: 'Accoppiatura a fiamma', color: '#a855f7' },
  { preferredId: 'textile-polvere', name: 'Accoppiatura a polvere', color: '#d97706' },
];

const PROCESS_PLANS = [
  [
    ['Tessuto jacquard automotive', 'SCH-PU-03', 'Schiuma poliuretanica 3 mm', 'Rivestimento sedile comfort'],
    ['Tessuto poliestere automotive', 'SCH-PU-05', 'Schiuma poliuretanica 5 mm', 'Rivestimento pannello porta'],
    ['Microfibra tecnica', 'SCH-PU-02', 'Schiuma poliuretanica 2 mm', 'Rivestimento cielo vettura'],
    ['Tessuto outdoor idrorepellente', 'MEM-TPU-20', 'Membrana TPU traspirante 20 µm', 'Laminato outdoor traspirante'],
    ['Tessuto poliammide ripstop', 'MEM-TPU-30', 'Membrana TPU traspirante 30 µm', 'Laminato guscio tecnico'],
    ['Mesh poliestere calzatura', 'NWT-PES-80', 'Tessuto non tessuto poliestere 80 g/m²', 'Tomaia mesh rinforzata'],
    ['Maglia spacer calzatura', 'SCH-PU-02F', 'Film di schiuma PU 2 mm', 'Laminato tomaia ammortizzato'],
    ['Tessuto decorativo arredo', 'SCH-PU-06', 'Schiuma poliuretanica 6 mm', 'Rivestimento imbottito arredo'],
    ['Velluto poliestere arredo', 'NWT-PES-120', 'Backing nonwoven poliestere 120 g/m²', 'Velluto stabilizzato per seduta'],
    ['Tessuto tecnico aramidico', 'NWT-ARA-60', 'Nonwoven aramidico 60 g/m²', 'Laminato protettivo multistrato'],
    ['Tessuto poliestere riciclato', 'MEM-BIO-25', 'Membrana traspirante bio-based 25 µm', 'Laminato riciclato impermeabile'],
    ['Tessuto softshell', 'FLC-PES-140', 'Pile poliestere 140 g/m²', 'Softshell termico accoppiato'],
    ['Jersey poliammide elasticizzato', 'MEM-TPU-15', 'Membrana TPU elastica 15 µm', 'Laminato sportivo elastico'],
    ['Tessuto canvas poliestere', 'SCH-PE-04', 'Schiuma polietilene 4 mm', 'Pannello borsa strutturato'],
    ['Tessuto acustico decorativo', 'NWT-PET-200', 'Feltro PET 200 g/m²', 'Rivestimento fonoassorbente'],
  ],
  [
    ['Tessuto poliestere automotive', 'FILM-PE-35', 'Film polietilene 35 µm', 'Barriera protettiva per interni auto'],
    ['Tessuto non tessuto spunbond', 'FILM-TPU-20', 'Film TPU 20 µm', 'Composito tecnico impermeabile'],
    ['Tessuto outdoor ripstop', 'MEM-TPU-25', 'Membrana TPU traspirante 25 µm', 'Laminato outdoor antistrappo'],
    ['Jersey poliestere', 'FILM-PU-30', 'Film poliuretanico 30 µm', 'Laminato elasticizzato protettivo'],
    ['Mesh calzatura 3D', 'FILM-EVA-50', 'Film EVA 50 µm', 'Tomaia termosaldata stabile'],
    ['Nonwoven microfibra calzatura', 'FILM-TPU-40', 'Film TPU 40 µm', 'Supporto tomaia impermeabile'],
    ['Tessuto decorativo arredo', 'WEB-PA-18', 'Velo termoadesivo poliammide 18 g/m²', 'Tessuto arredo con backing leggero'],
    ['Tessuto ciniglia', 'NWT-PES-90', 'Nonwoven poliestere 90 g/m²', 'Ciniglia stabilizzata per imbottiti'],
    ['Tessuto tecnico in vetro', 'FILM-PEI-25', 'Film polieterimmide 25 µm', 'Composito isolante flessibile'],
    ['Tessuto filtrante polipropilene', 'NWT-PP-60', 'Nonwoven polipropilene 60 g/m²', 'Media filtrante multistrato'],
    ['Tessuto poliestere alta tenacità', 'FILM-PE-45', 'Film polietilene 45 µm', 'Telone tecnico laminato'],
    ['Maglia tecnica antibatterica', 'MEM-PU-20', 'Membrana PU traspirante 20 µm', 'Laminato sanitario traspirante'],
    ['Tessuto nylon per zaini', 'FILM-TPU-35', 'Film TPU 35 µm', 'Pannello zaino impermeabile'],
    ['Tessuto oscurante', 'FILM-EVA-60', 'Film EVA 60 µm', 'Tenda tecnica multistrato'],
    ['Tessuto tecnico riflettente', 'WEB-PES-25', 'Velo termoadesivo poliestere 25 g/m²', 'Inserto alta visibilità rinforzato'],
  ],
  [
    ['Tessuto automotive a maglia', 'SCH-PU-04', 'Schiuma poliuretanica 4 mm', 'Rivestimento sedile accoppiato'],
    ['Tessuto automotive traforato', 'SCH-PU-06', 'Schiuma poliuretanica 6 mm', 'Pannello ventilato per seduta'],
    ['Microfibra per cielo auto', 'SCH-PU-03', 'Schiuma poliuretanica 3 mm', 'Cielo vettura sagomabile'],
    ['Tessuto decorativo bouclé', 'SCH-PU-08', 'Schiuma poliuretanica 8 mm', 'Rivestimento arredo morbido'],
    ['Velluto contract', 'SCH-PU-05', 'Schiuma poliuretanica 5 mm', 'Velluto imbottito contract'],
    ['Tessuto nautico vinilico', 'SCH-PE-06', 'Schiuma polietilene 6 mm', 'Rivestimento nautico imbottito'],
    ['Mesh calzatura poliestere', 'SCH-PU-03', 'Schiuma poliuretanica 3 mm', 'Tomaia traspirante imbottita'],
    ['Tessuto tecnico elasticizzato', 'SCH-PU-02', 'Schiuma poliuretanica 2 mm', 'Protezione sportiva flessibile'],
    ['Jersey medicale', 'SCH-PU-04', 'Schiuma poliuretanica 4 mm', 'Supporto medicale comfort'],
    ['Tessuto per valigeria', 'SCH-PE-05', 'Schiuma polietilene 5 mm', 'Pannello valigia protettivo'],
    ['Tessuto acustico poliestere', 'SCH-PU-10', 'Schiuma poliuretanica a celle aperte 10 mm', 'Pannello acustico rivestito'],
    ['Tessuto ignifugo contract', 'SCH-FR-05', 'Schiuma ritardante di fiamma 5 mm', 'Rivestimento contract ignifugo'],
    ['Tessuto tecnico per casco', 'SCH-PU-07', 'Schiuma poliuretanica 7 mm', 'Imbottitura casco rivestita'],
    ['Tessuto per ortopedia', 'SCH-PU-04', 'Schiuma poliuretanica 4 mm', 'Supporto ortopedico laminato'],
    ['Tessuto spalmato per protezioni', 'SCH-PE-08', 'Schiuma polietilene 8 mm', 'Pannello protettivo accoppiato'],
  ],
  [
    ['Tessuto tecnico poliestere', 'NWT-PES-100', 'Nonwoven poliestere 100 g/m²', 'Composito tecnico stabilizzato'],
    ['Tessuto automotive decorativo', 'NWT-PET-140', 'Feltro PET 140 g/m²', 'Rivestimento bagagliaio rinforzato'],
    ['Tessuto outdoor canvas', 'NWT-PP-90', 'Nonwoven polipropilene 90 g/m²', 'Pannello outdoor strutturato'],
    ['Mesh calzatura poliammide', 'NWT-PES-70', 'Nonwoven poliestere 70 g/m²', 'Tomaia mesh supportata'],
    ['Microfibra calzatura', 'SCH-PU-02F', 'Film di schiuma PU 2 mm', 'Fodera calzatura comfort'],
    ['Tessuto decorativo jacquard', 'NWT-PES-110', 'Backing nonwoven poliestere 110 g/m²', 'Jacquard arredo stabilizzato'],
    ['Tessuto tecnico aramidico', 'NWT-ARA-80', 'Nonwoven aramidico 80 g/m²', 'Barriera termica tessile'],
    ['Tessuto filtrante poliestere', 'NWT-PES-60', 'Nonwoven poliestere 60 g/m²', 'Filtro tessile composito'],
    ['Tessuto in fibra di vetro', 'NWT-GLS-90', 'Velo di vetro 90 g/m²', 'Laminato isolante tecnico'],
    ['Tessuto riciclato per borse', 'NWT-PET-120', 'Feltro PET riciclato 120 g/m²', 'Pannello borsa riciclato'],
    ['Tessuto acustico contract', 'NWT-PET-220', 'Feltro PET 220 g/m²', 'Pannello fonoassorbente contract'],
    ['Tessuto protettivo ad alta tenacità', 'NWT-PA-100', 'Nonwoven poliammide 100 g/m²', 'Inserto protettivo multistrato'],
    ['Tessuto per tende tecniche', 'NWT-PES-75', 'Nonwoven poliestere 75 g/m²', 'Tenda oscurante rinforzata'],
    ['Tessuto sanitario lavabile', 'NWT-PP-65', 'Nonwoven polipropilene 65 g/m²', 'Supporto sanitario composito'],
    ['Tessuto tecnico per guanti', 'NWT-PA-55', 'Nonwoven poliammide 55 g/m²', 'Palmo guanto rinforzato'],
  ],
];

const SETUPS = [12, 18, 24, 30, 36, 15, 21, 27, 33, 39, 20, 28, 42, 48, 55];
const RUNS = [90, 120, 150, 180, 210, 240, 270, 300, 360, 420, 480, 540, 600, 660, 720];

function findByName(db, table, name) {
  return db.prepare(`SELECT * FROM ${table} WHERE name = ? COLLATE NOCASE LIMIT 1`).get(name);
}

function freeId(db, table, preferred) {
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(preferred)) return preferred;
  const base = `textile-${preferred.toLowerCase()}`;
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(base)) return base;
  let suffix = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function ensureMachine(db, spec, anchor) {
  const matching = findByName(db, 'machines', spec.name);
  if (matching) return matching.id;
  if (spec.legacyId) {
    const legacy = db.prepare('SELECT * FROM machines WHERE id=?').get(spec.legacyId);
    if (legacy?.name === spec.legacyName) {
      db.prepare('UPDATE machines SET name=?,description=? WHERE id=?').run(spec.name, spec.description, legacy.id);
      return legacy.id;
    }
  }
  const id = freeId(db, 'machines', spec.preferredId);
  db.prepare('INSERT INTO machines(id,name,description,anchor) VALUES (?,?,?,?)').run(id, spec.name, spec.description, anchor);
  return id;
}

function ensureType(db, spec) {
  const matching = findByName(db, 'types', spec.name);
  if (matching) return matching.id;
  if (spec.legacyId) {
    const legacy = db.prepare('SELECT * FROM types WHERE id=?').get(spec.legacyId);
    if (legacy?.name === spec.legacyName) {
      db.prepare('UPDATE types SET name=?,color=? WHERE id=?').run(spec.name, spec.color, legacy.id);
      return legacy.id;
    }
  }
  const id = freeId(db, 'types', spec.preferredId);
  db.prepare('INSERT INTO types(id,name,color) VALUES (?,?,?)').run(id, spec.name, spec.color);
  return id;
}

function textileFields(processIndex, itemIndex, plan) {
  const [component1Description, component2Code, component2Description, productDescription] = plan;
  const serial = String(processIndex * 15 + itemIndex + 1).padStart(3, '0');
  return {
    component1Code: `TES-${serial}`,
    component1Description,
    component2Code,
    component2Description,
    productCode: `ART-${String(processIndex + 1).padStart(2, '0')}-${serial}`,
    productDescription,
  };
}

function convertOriginalSamples(db, machineIds, typeIds) {
  const samples = [
    ['Staffa supporto · lotto 240', 'Rivestimento sedile automotive · lotto DEMO-240', 0, 0, ['FAB-AUTO-240', 'Tessuto jacquard automotive', 'SCH-PU-03', 'Schiuma poliuretanica 3 mm', 'ART-AUTO-240', 'Rivestimento sedile accoppiato']],
    ['Piastra di fissaggio · lotto 241', 'Laminato outdoor traspirante · lotto DEMO-241', 0, 0, ['FAB-OUT-241', 'Tessuto outdoor tecnico', 'MEM-TPU-25', 'Membrana TPU traspirante 25 µm', 'ART-OUT-241', 'Laminato outdoor impermeabile traspirante']],
    ['Albero motore · lotto 118', 'Tomaia mesh con film · lotto DEMO-118', 1, 1, ['FAB-MESH-118', 'Mesh poliestere per calzatura', 'FILM-TPU-35', 'Film TPU 35 µm', 'ART-SHOE-118', 'Tomaia mesh laminata impermeabile']],
    ['Pannelli laterali · lotto 086', 'Rivestimento arredo imbottito · lotto DEMO-086', 2, 2, ['FAB-DEC-086', 'Tessuto decorativo per arredo', 'SCH-PU-06', 'Schiuma poliuretanica 6 mm', 'ART-HOME-086', 'Rivestimento arredo imbottito']],
  ];
  const update = db.prepare(`UPDATE tasks SET title=?,typeId=?,machineId=?,
    component1Code=?,component1Description=?,component2Code=?,component2Description=?,productCode=?,productDescription=?
    WHERE title=? AND machineId=? AND typeId=?
    AND (status='unplanned' OR (status='planned' AND machineId=?))`);
  for (const [oldTitle, title, processIndex, typeIndex, fields] of samples) {
    update.run(title, typeIds[typeIndex], machineIds[processIndex], ...fields, oldTitle,
      ['CNC-01','TOR-02','LAS-03'][processIndex], ['fresatura','tornitura','taglio'][typeIndex], machineIds[processIndex]);
  }
}

function insertFixtures(db, machineIds, typeIds) {
  const insert = db.prepare(`INSERT INTO tasks(
    id,title,typeId,machineId,setupMinutes,runMinutes,status,position,start,end,segments,notes,
    component1Code,component1Description,component2Code,component2Description,productCode,productDescription
  ) VALUES (?,?,?,?,?,?,'unplanned',NULL,NULL,NULL,'[]',?,?,?,?,?,?,?)`);
  for (let processIndex = 0; processIndex < PROCESS_PLANS.length; processIndex += 1) {
    for (let itemIndex = 0; itemIndex < PROCESS_PLANS[processIndex].length; itemIndex += 1) {
      const number = processIndex * 15 + itemIndex + 1;
      const serial = String(number).padStart(3, '0');
      const fields = textileFields(processIndex, itemIndex, PROCESS_PLANS[processIndex][itemIndex]);
      const lot = `${['HM', 'FW', 'FL', 'PW'][processIndex]}-${String(101 + itemIndex).padStart(3, '0')}`;
      insert.run(
        `textile-demo-${serial}`,
        `${fields.productDescription} · lotto ${lot}`,
        typeIds[processIndex],
        machineIds[processIndex],
        SETUPS[(itemIndex + processIndex * 3) % SETUPS.length],
        RUNS[(itemIndex * 4 + processIndex * 2) % RUNS.length],
        `Dati dimostrativi: tempi illustrativi, non standard di produzione. L'adesivo di processo è un ausiliario e non è conteggiato tra i due substrati.`,
        fields.component1Code,
        fields.component1Description,
        fields.component2Code,
        fields.component2Description,
        fields.productCode,
        fields.productDescription,
      );
    }
  }
}

export function migrateTextile(db, anchor) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('Database SQLite non valido.');
  if (typeof anchor !== 'string' || !anchor.trim()) throw new TypeError('Anchor macchina non valido.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const alreadyMigrated = db.prepare("SELECT 1 FROM meta WHERE key='textile-v1'").get();
    if (alreadyMigrated) {
      db.exec('COMMIT');
      return { migrated: false };
    }
    const existingColumns = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(column => column.name));
    for (const column of COLUMNS) {
      if (!existingColumns.has(column)) db.exec(`ALTER TABLE tasks ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }
    const machineIds = MACHINE_SPECS.map(spec => ensureMachine(db, spec, anchor));
    const typeIds = TYPE_SPECS.map(spec => ensureType(db, spec));
    convertOriginalSamples(db, machineIds, typeIds);
    insertFixtures(db, machineIds, typeIds);
    db.prepare("INSERT INTO meta(key,value) VALUES ('textile-v1','1')").run();
    db.prepare("INSERT INTO meta(key,value) VALUES ('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();
    db.exec('COMMIT');
    return { migrated: true, machineIds, typeIds };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
