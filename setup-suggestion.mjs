// Attrezzaggio suggerito dallo storico: la mediana dei tempi realmente impiegati.
// Prima per lo stesso articolo sulla stessa macchina; se i casi sono pochi, per la macchina in generale.
// Non modifica nulla: il pianificatore decide se usare il valore.

const ARTICLE_MIN_SAMPLES = 3, ARTICLE_MAX_SAMPLES = 20;
const MACHINE_MIN_SAMPLES = 5, MACHINE_MAX_SAMPLES = 30;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function actualSetupMinutes(row) {
  const start = Date.parse(row.setupStartedAt), end = Date.parse(row.setupEndedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const paused = Number(row.setupPausedSeconds) || 0;
  const minutes = ((end - start) / 1000 - Math.max(0, paused)) / 60;
  return minutes > 0 ? minutes : null;
}

/**
 * @returns {{minutes:number,basis:'article'|'machine',count:number}|null}
 */
export function suggestSetup(db, { machineId, productCode }) {
  if (!machineId) return null;
  const columns = db.prepare('PRAGMA table_info(execution)').all().map(column => column.name);
  if (!['setupStartedAt', 'setupEndedAt', 'machineId', 'productCode'].every(name => columns.includes(name))) return null;
  const paused = columns.includes('setupPausedSeconds') ? 'setupPausedSeconds' : '0 AS setupPausedSeconds';
  const rows = db.prepare(`SELECT productCode,setupStartedAt,setupEndedAt,${paused} FROM execution
    WHERE phase='completed' AND machineId=? AND setupStartedAt IS NOT NULL AND setupEndedAt IS NOT NULL
    ORDER BY runEndedAt DESC,taskId DESC`).all(machineId)
    .map(row => ({ productCode: row.productCode, minutes: actualSetupMinutes(row) }))
    .filter(row => row.minutes !== null);
  const sameArticle = productCode ? rows.filter(row => row.productCode === productCode).slice(0, ARTICLE_MAX_SAMPLES) : [];
  if (sameArticle.length >= ARTICLE_MIN_SAMPLES) {
    return { minutes: Math.round(median(sameArticle.map(row => row.minutes))), basis: 'article', count: sameArticle.length };
  }
  const machineRows = rows.slice(0, MACHINE_MAX_SAMPLES);
  if (machineRows.length >= MACHINE_MIN_SAMPLES) {
    return { minutes: Math.round(median(machineRows.map(row => row.minutes))), basis: 'machine', count: machineRows.length };
  }
  return null;
}
