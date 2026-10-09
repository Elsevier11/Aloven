import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Complete missing order quantities in the textile examples without changing
// durations, scheduling, user-entered quantities or production declarations.
const dir=path.resolve(process.env.DATA_DIR||'data');
const db=new DatabaseSync(path.join(dir,'aloven.sqlite'));
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
try{
 const backup=path.join(dir,'backups',`aloven-before-demo-quantities-${Date.now()}.sqlite`);
 mkdirSync(path.dirname(backup),{recursive:true});db.prepare('VACUUM INTO ?').run(backup);
 db.exec('BEGIN IMMEDIATE');
 try{
  const before=db.prepare('SELECT * FROM tasks ORDER BY id').all();
  const executionBefore=db.prepare('SELECT * FROM execution ORDER BY taskId').all();
  const rows=db.prepare(`SELECT t.id,t.title,t.runMinutes,m.speed,m.speedUnit,a.unit
   FROM tasks t JOIN machines m ON m.id=t.machineId
   JOIN articles a ON a.id=t.productArticleId
   WHERE t.quantity IS NULL AND
   (substr(t.id,1,13)='textile-demo-' OR t.title IN (
    'Rivestimento sedile automotive · lotto DEMO-240',
    'Laminato outdoor traspirante · lotto DEMO-241',
    'Tomaia mesh con film · lotto DEMO-118',
    'Rivestimento arredo imbottito · lotto DEMO-086')) ORDER BY t.id`).all();
  const update=db.prepare('UPDATE tasks SET quantity=? WHERE id=? AND quantity IS NULL');
  const quantities=new Map();
  for(const t of rows){
   if(t.unit!==t.speedUnit)throw new Error(`Unità incompatibili: ${t.title}`);
   const quantity=Math.round(t.runMinutes*t.speed*1000)/1000;
   if(!Number.isFinite(quantity)||quantity<=0)throw new Error(`Quantità non valida: ${t.title}`);
   update.run(quantity,t.id);quantities.set(t.id,quantity);
  }
  const after=db.prepare('SELECT * FROM tasks ORDER BY id').all();
  assert.ok(JSON.stringify(after)===JSON.stringify(before.map(t=>quantities.has(t.id)?{...t,quantity:quantities.get(t.id)}:t)),'Sono cambiati campi diversi dalle quantità dimostrative.');
  assert.ok(JSON.stringify(db.prepare('SELECT * FROM execution ORDER BY taskId').all())===JSON.stringify(executionBefore),'Sono cambiati i consuntivi di produzione.');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  if(rows.length)db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
  db.exec('COMMIT');
  console.log(JSON.stringify({updated:rows.length,rule:'quantity = runMinutes × machine.speed',backup,
   examples:rows.slice(0,4).map(t=>({title:t.title,runMinutes:t.runMinutes,quantity:quantities.get(t.id),unit:t.unit}))},null,2));
 }catch(error){db.exec('ROLLBACK');throw error;}
}finally{db.close();}
