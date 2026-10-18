// Schermate della demo (giovedì 22/10/2026, 9:30) su una COPIA dei dati costruiti da seed-demo.mjs. Le salva in .artifacts/demo-*.png.
//   PLAYWRIGHT_PATH=... node demo-screens.mjs [cartella]
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cpSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const playwrightPath = process.env.PLAYWRIGHT_PATH;
if (!playwrightPath) throw new Error('Imposta PLAYWRIGHT_PATH sul modulo Playwright disponibile.');
const {chromium} = await import(pathToFileURL(playwrightPath).href);
const dir = path.resolve(process.argv[2] || '.demo-build'), artifacts = path.resolve('.artifacts');
mkdirSync(artifacts, {recursive: true});
const temp = mkdtempSync(path.join(tmpdir(), 'aloven-demo-screens-'));
cpSync(dir, temp, {recursive: true});
const server = spawn(process.execPath, ['server.mjs'], {env: {...process.env, DATA_DIR: temp, PORT: '0', HOST: '127.0.0.1', ALOVEN_NOW: '2026-10-22T07:30:00Z'}, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Avvio scaduto')), 20000);
    server.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  browser = await chromium.launch({headless: process.env.HEADFUL !== '1', channel: 'msedge'});
  const context = await browser.newContext({viewport: {width: 1600, height: 900}});
  await context.clock.install({time: new Date('2026-10-22T09:30:00+02:00')});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const shot = async name => { await page.waitForTimeout(500); await page.screenshot({path: path.join(artifacts, `demo-${name}.png`)}); console.log(`demo-${name}.png`); };
  await page.goto(base);
  await page.locator('#demo-accounts').waitFor();
  await shot('00-accesso');
  await page.locator('[data-demo-account="1"]').click();
  await page.getByRole('button', {name: 'Accedi'}).click();
  await page.getByRole('heading', {name: 'Piano di produzione'}).waitFor();
  await page.locator('.timeline-scroll').waitFor();
  await shot('01-piano-giorno');
  await page.getByRole('button', {name: 'Settimana', exact: true}).click();
  await shot('02-piano-settimana');
  await page.locator('[data-nav="reparto"]').click(); await page.waitForTimeout(800); await shot('03-in-reparto');
  await page.locator('[data-nav="tasks"]').click(); await page.locator('.task-table').waitFor(); await shot('04-attivita');
  await page.locator('#status-filter').selectOption(''); await page.waitForTimeout(300);
  await page.locator('[data-nav="statistics"]').click(); await page.waitForTimeout(1500); await shot('05-statistiche');
  await page.locator('[data-nav="tasks"]').click(); await page.locator('[data-mes-nav="quality"]').click(); await page.waitForTimeout(800); await shot('06-qualita');
  await page.locator('[data-mes-nav="traceability"]').click(); await page.waitForTimeout(500); await shot('07-tracciabilita');
  await page.locator('[data-nav-group="settings"]').click(); await page.waitForTimeout(500); await shot('08-calendario');
  await page.goto(`${base}/reparto-tv`); await page.waitForTimeout(1500); await shot('09-monitor-tv');
  console.log(errors.length ? `Errori: ${errors.join(' | ')}` : 'Nessun errore di pagina o di rete');
} finally {
  await browser?.close();
  if (server.exitCode === null) { const closed = once(server, 'exit'); server.kill(); await closed; }
  rmSync(temp, {recursive: true, force: true});
}
