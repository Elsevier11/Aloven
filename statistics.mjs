import { Buffer } from 'node:buffer';

const ROME = 'Europe/Rome';
const UNCLASSIFIED_CODE = 'unclassified-legacy';
const UNCLASSIFIED_LABEL = 'Non classificata (storico)';

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function localDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10) === value ? value : null;
}

function romeParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23',
  }).formatToParts(date).map(part => [part.type,part.value]));
}

export function romeDate(date = new Date()) {
  const part = romeParts(date);
  return `${part.year}-${part.month}-${part.day}`;
}

function romeMidnight(date) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let guess = target;
  for (let index=0; index<4; index++) {
    const part = romeParts(new Date(guess));
    const represented = Date.parse(`${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}Z`);
    guess += target - represented;
  }
  return guess;
}

function nextDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate()+1);
  return value.toISOString().slice(0,10);
}

function hours(seconds) {
  return Math.round(seconds / 36) / 100;
}

function quantitySum(rows, field) {
  if (rows.some(row => row[field] === null || row[field] === undefined)) return null;
  return rows.reduce((sum,row) => sum + Number(row[field]),0);
}

function secondsSum(rows, field) {
  const value=quantitySum(rows,field);
  return value === null ? null : hours(value);
}

function commonMetrics(rows) {
  const goodQuantity = quantitySum(rows,'goodQuantity');
  const scrapQuantity = quantitySum(rows,'scrapQuantity');
  const total = goodQuantity === null || scrapQuantity === null ? null : goodQuantity + scrapQuantity;
  return {
    count: rows.length,
    plannedQuantity: quantitySum(rows,'plannedQuantity'),
    goodQuantity,
    scrapQuantity,
    scrapRate: total === null || total === 0 ? null : scrapQuantity / total,
    plannedSetupHours: secondsSum(rows,'plannedSetupSeconds'),
    actualSetupHours: hours(rows.reduce((sum,row) => sum + row.actualSetupSeconds,0)),
    plannedRunHours: secondsSum(rows,'plannedRunSeconds'),
    actualRunHours: hours(rows.reduce((sum,row) => sum + row.actualRunSeconds,0)),
    nonconformingCount: rows.filter(row => row.qualityStatus === 'nonconforming').length,
  };
}

function grouped(rows, keyOf, labelOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key,items]) => ({...labelOf(items[0],key),...commonMetrics(items)}));
}

function timestampMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setupSeconds(row) {
  const start = timestampMs(row.setupStartedAt), end = timestampMs(row.setupEndedAt);
  if (start === null) return 0;
  return end !== null && end >= start ? (end-start)/1000 : 0;
}

export function normalizeStatisticsFilters(db, filters = {}, now = new Date()) {
  const earliest = db.prepare("SELECT runEndedAt FROM execution WHERE phase='completed' AND runEndedAt IS NOT NULL ORDER BY runEndedAt LIMIT 1").get()?.runEndedAt;
  const defaultFrom = earliest ? romeDate(new Date(earliest)) : romeDate(now);
  const from = filters.from === undefined || filters.from === '' ? defaultFrom : localDate(filters.from);
  const to = filters.to === undefined || filters.to === '' ? romeDate(now) : localDate(filters.to);
  if (!from || !to) fail('Intervallo date non valido. Usa il formato AAAA-MM-GG.');
  if (from > to) fail('La data iniziale non può essere successiva alla data finale.');
  const machineId = filters.machineId || null;
  let machine = null;
  if (machineId !== null) {
    if (typeof machineId !== 'string') fail('Macchina non valida.');
    machine = db.prepare('SELECT id,name FROM machines WHERE id=?').get(machineId);
    if (!machine) fail('Macchina non trovata.',404);
  }
  return {from,to,machineId,machineName:machine?.name ?? null};
}

export function buildStatisticsReport(db, filters = {}, now = new Date()) {
  const normalized = normalizeStatisticsFilters(db,filters,now);
  const rangeStart = romeMidnight(normalized.from);
  const rangeEnd = romeMidnight(nextDate(normalized.to));
  const machineNames = new Map(db.prepare('SELECT id,name FROM machines').all().map(row => [row.id,row.name]));
  const query = `SELECT * FROM execution WHERE phase='completed' AND runEndedAt IS NOT NULL${normalized.machineId ? ' AND machineId=?' : ''} ORDER BY runEndedAt,taskId`;
  const executions = (normalized.machineId ? db.prepare(query).all(normalized.machineId) : db.prepare(query).all())
    .filter(row => {
      const ended = timestampMs(row.runEndedAt);
      return ended !== null && ended >= rangeStart && ended < rangeEnd;
    }).map(row => {
      const goodQuantity = row.producedQuantity ?? null;
      const scrapQuantity = row.scrapQuantity ?? null;
      const total = goodQuantity === null || scrapQuantity === null ? null : goodQuantity + scrapQuantity;
      const completedAt = row.runEndedAt;
      const completedDate = romeDate(new Date(completedAt));
      return {
        taskId:row.taskId, taskTitle:row.taskTitle,
        completedAt, completedDate, month:completedDate.slice(0,7),
        machineId:row.machineId, machineName:machineNames.get(row.machineId) ?? row.machineId,
        productCode:row.productCode, productDescription:row.productDescription,
        unit:row.productUnit, plannedQuantity:row.plannedQuantity ?? null,
        goodQuantity, scrapQuantity,
        scrapRate:total === null || total === 0 ? null : scrapQuantity / total,
        plannedSetupSeconds:row.plannedSetupMinutes == null ? null : row.plannedSetupMinutes*60,
        actualSetupSeconds:setupSeconds(row),
        plannedRunSeconds:row.plannedRunMinutes == null ? null : row.plannedRunMinutes*60,
        actualRunSeconds:Number(row.runActiveSeconds) || 0,
        qualityStatus:row.qualityStatus,
        nonconformingCount:row.qualityStatus === 'nonconforming' ? 1 : 0,
        scrapReasonCode:row.scrapReasonCode || UNCLASSIFIED_CODE,
        scrapReasonLabel:row.scrapReason || UNCLASSIFIED_LABEL,
      };
    });

  const details = executions.map(row => ({
    ...row,
    plannedSetupHours:row.plannedSetupSeconds === null ? null : hours(row.plannedSetupSeconds),
    actualSetupHours:hours(row.actualSetupSeconds),
    plannedRunHours:row.plannedRunSeconds === null ? null : hours(row.plannedRunSeconds),
    actualRunHours:hours(row.actualRunSeconds),
  })).map(({plannedSetupSeconds,actualSetupSeconds,plannedRunSeconds,actualRunSeconds,...row}) => row);
  const monthly = grouped(executions,row=>`${row.month}\0${row.unit}`,row=>({month:row.month,unit:row.unit}));
  const machines = grouped(executions,row=>`${row.machineId}\0${row.unit}`,row=>({machineId:row.machineId,machineName:row.machineName,unit:row.unit}));
  const products = grouped(executions,row=>`${row.productCode}\0${row.productDescription}\0${row.unit}`,row=>({productCode:row.productCode,productDescription:row.productDescription,unit:row.unit}));
  const scrapReasons = grouped(executions.filter(row => Number(row.scrapQuantity) > 0),row=>`${row.scrapReasonCode}\0${row.scrapReasonLabel}\0${row.unit}`,row=>({reasonCode:row.scrapReasonCode,label:row.scrapReasonLabel,unit:row.unit}))
    .map(row=>({reasonCode:row.reasonCode,label:row.label,unit:row.unit,count:row.count,scrapQuantity:row.scrapQuantity}));

  const stopRows = db.prepare(`SELECT * FROM machineStops${normalized.machineId ? ' WHERE machineId=?' : ''} ORDER BY startedAt,id`);
  const effectiveEnd = Math.min(rangeEnd,now.valueOf());
  const stops = (normalized.machineId ? stopRows.all(normalized.machineId) : stopRows.all()).flatMap(row => {
    const started = timestampMs(row.startedAt), ended = row.endedAt ? timestampMs(row.endedAt) : null;
    if (started === null || started >= effectiveEnd || (ended !== null && ended <= rangeStart)) return [];
    const clippedStart = Math.max(started,rangeStart), clippedEnd = Math.min(ended ?? effectiveEnd,effectiveEnd);
    if (clippedEnd <= clippedStart) return [];
    return [{...row,durationSeconds:(clippedEnd-clippedStart)/1000,reasonCode:row.reasonCode || UNCLASSIFIED_CODE,label:row.reason || UNCLASSIFIED_LABEL}];
  });
  const stopGroups = new Map();
  for (const stop of stops) {
    const key=`${stop.reasonCode}\0${stop.label}`;
    if (!stopGroups.has(key)) stopGroups.set(key,[]);
    stopGroups.get(key).push(stop);
  }
  const stopReasons = [...stopGroups.values()].map(items => ({
    reasonCode:items[0].reasonCode,label:items[0].label,stopCount:items.length,
    closedStopCount:items.filter(row=>row.endedAt !== null).length,
    openStopCount:items.filter(row=>row.endedAt === null).length,
    stoppedHours:hours(items.reduce((sum,row)=>sum+row.durationSeconds,0)),
  }));
  const quantities = grouped(executions,row=>row.unit,row=>({unit:row.unit})).map(row=>({unit:row.unit,plannedQuantity:row.plannedQuantity,goodQuantity:row.goodQuantity,scrapQuantity:row.scrapQuantity,scrapRate:row.scrapRate}));
  const all = commonMetrics(executions);
  const totals = {
    count:all.count, plannedSetupHours:all.plannedSetupHours, actualSetupHours:all.actualSetupHours,
    plannedRunHours:all.plannedRunHours, actualRunHours:all.actualRunHours,
    nonconformingCount:all.nonconformingCount,
    stoppedHours:hours(stops.reduce((sum,row)=>sum+row.durationSeconds,0)),
    stopCount:stops.length, closedStopCount:stops.filter(row=>row.endedAt !== null).length,
    openStopCount:stops.filter(row=>row.endedAt === null).length, quantities,
  };
  return {
    filters:normalized, generatedAt:now.toISOString(), totals,
    monthly:monthly.sort((a,b)=>a.month.localeCompare(b.month)||a.unit.localeCompare(b.unit)),
    machines:machines.sort((a,b)=>a.machineName.localeCompare(b.machineName,'it')||a.unit.localeCompare(b.unit)),
    products:products.sort((a,b)=>a.productCode.localeCompare(b.productCode,'it')||a.unit.localeCompare(b.unit)),
    scrapReasons:scrapReasons.sort((a,b)=>b.scrapQuantity-a.scrapQuantity||a.label.localeCompare(b.label,'it')),
    stopReasons:stopReasons.sort((a,b)=>b.stoppedHours-a.stoppedHours||a.label.localeCompare(b.label,'it')),
    details,
  };
}

function xml(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

function columnName(index) {
  let value='';
  for (let number=index+1; number; number=Math.floor((number-1)/26)) value=String.fromCharCode(65+(number-1)%26)+value;
  return value;
}

function sheetXml(headers,rows,formats=[]) {
  const all=[headers,...rows];
  const widths=headers.map((header,index)=>Math.min(42,Math.max(10,String(header).length+2,...rows.slice(0,200).map(row=>String(row[index]??'').length+2))));
  const body=all.map((row,rowIndex)=>`<row r="${rowIndex+1}">${row.map((value,columnIndex)=>{
    const ref=`${columnName(columnIndex)}${rowIndex+1}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${rowIndex===0?1:(formats[columnIndex]||0)}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${rowIndex===0?1:0}"><is><t xml:space="preserve">${xml(value??'')}</t></is></c>`;
  }).join('')}</row>`).join('');
  const last=`${columnName(Math.max(0,headers.length-1))}${Math.max(1,all.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width,index)=>`<col min="${index+1}" max="${index+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData>${rows.length?`<autoFilter ref="A1:${last}"/>`:''}</worksheet>`;
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) crcTable=Array.from({length:256},(_,number)=>{let value=number;for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
  let crc=0xffffffff;
  for (const byte of buffer) crc=crcTable[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

function zip(entries) {
  const local=[],central=[];let offset=0;
  for (const [name,content] of entries) {
    const filename=Buffer.from(name),data=Buffer.from(content),crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0,6);header.writeUInt16LE(0,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,data);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
    central.push(directory,filename);offset+=header.length+filename.length+data.length;
  }
  const centralSize=central.reduce((sum,item)=>sum+item.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,end]);
}

const metricColumns = [
  ['Numero attività','count'],['Quantità pianificata','plannedQuantity'],['Quantità buona','goodQuantity'],['Quantità scarto','scrapQuantity'],['Tasso scarto','scrapRate'],
  ['Ore attrezzaggio pianificate','plannedSetupHours'],['Ore attrezzaggio effettive','actualSetupHours'],['Ore produzione pianificate','plannedRunHours'],['Ore produzione effettive','actualRunHours'],['Non conformi','nonconformingCount'],
];
function table(rows,columns) { return [columns.map(x=>x[0]),rows.map(row=>columns.map(x=>row[x[1]]))]; }

function workbookStyle(key) {
  if (key === 'scrapRate') return 2;
  if (/Quantity$|Hours$/.test(key)) return 3;
  return 0;
}

function romeDateTime(value) {
  if (!value) return '';
  const parts=romeParts(new Date(value));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function buildStatisticsWorkbook(report) {
  const sheets=[];
  const add=(name,columns,rows)=>{const [headers,values]=table(rows,columns);sheets.push([name,sheetXml(headers,values,columns.map(column=>workbookStyle(column[1])))]);};
  const summaryRows=[
    {label:'Dal',value:report.filters.from},{label:'Al',value:report.filters.to},{label:'Macchina',value:report.filters.machineName||'Tutte'},
    {label:'Generato il',value:report.generatedAt},{label:'Attività completate',value:report.totals.count},
    {label:'Ore attrezzaggio pianificate',value:report.totals.plannedSetupHours},{label:'Ore attrezzaggio effettive',value:report.totals.actualSetupHours},
    {label:'Ore produzione pianificate',value:report.totals.plannedRunHours},{label:'Ore produzione effettive',value:report.totals.actualRunHours},
    {label:'Controlli non conformi',value:report.totals.nonconformingCount},{label:'Ore fermo',value:report.totals.stoppedHours},{label:'Fermi',value:report.totals.stopCount},
    {label:'Fermi chiusi',value:report.totals.closedStopCount},{label:'Fermi aperti',value:report.totals.openStopCount},
    ...report.totals.quantities.flatMap(quantity=>[
      {label:`Quantità pianificata (${quantity.unit})`,value:quantity.plannedQuantity},{label:`Quantità buona (${quantity.unit})`,value:quantity.goodQuantity},
      {label:`Quantità scarto (${quantity.unit})`,value:quantity.scrapQuantity},{label:`Tasso scarto (${quantity.unit})`,value:quantity.scrapRate},
    ]),
    {label:'Criterio attività',value:'Completamento runEndedAt nel giorno locale Europe/Rome'},
    {label:'Formula tasso scarto',value:'Scarto / (buona + scarto); vuoto se il denominatore è zero o mancano dati'},
    {label:'Criterio fermi',value:'Durata sovrapposta all’intervallo selezionato; i fermi aperti terminano alla generazione'},
    {label:'Perimetro dati',value:'Include anche i dati DEMO-STORICO presenti nel database'},
  ];
  add('Riepilogo',[['Voce','label'],['Valore','value']],summaryRows);
  add('Mensile',[['Mese','month'],['Unità','unit'],...metricColumns],report.monthly);
  add('Macchine',[['ID macchina','machineId'],['Macchina','machineName'],['Unità','unit'],...metricColumns],report.machines);
  add('Prodotti',[['Codice prodotto','productCode'],['Descrizione prodotto','productDescription'],['Unità','unit'],...metricColumns],report.products);
  add('Scarti',[['Codice causale','reasonCode'],['Causale','label'],['Unità','unit'],['Casi','count'],['Quantità scarto','scrapQuantity']],report.scrapReasons);
  add('Fermi',[['Codice causale','reasonCode'],['Causale','label'],['Fermi','stopCount'],['Chiusi','closedStopCount'],['Aperti','openStopCount'],['Ore fermo','stoppedHours']],report.stopReasons);
  add('Dettaglio',[
    ['ID attività','taskId'],['Attività','taskTitle'],['Completata il','completedAt'],['ID macchina','machineId'],['Macchina','machineName'],['Codice prodotto','productCode'],['Descrizione prodotto','productDescription'],['Unità','unit'],
    ['Quantità pianificata','plannedQuantity'],['Quantità buona','goodQuantity'],['Quantità scarto','scrapQuantity'],['Tasso scarto','scrapRate'],['Ore attrezzaggio pianificate','plannedSetupHours'],['Ore attrezzaggio effettive','actualSetupHours'],['Ore produzione pianificate','plannedRunHours'],['Ore produzione effettive','actualRunHours'],['Esito qualità','qualityStatus'],['Non conforme','nonconformingCount'],['Codice causale scarto','scrapReasonCode'],['Causale scarto','scrapReasonLabel'],
  ],report.details.map(row=>({...row,completedAt:romeDateTime(row.completedAt)})));
  const contentTypes=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const workbook=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([name],i)=>`<sheet name="${xml(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
  const rels=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,#0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  return zip([
    ['[Content_Types].xml',contentTypes],['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',rels],['xl/styles.xml',styles.replace('formatCode="#,#0.00"','formatCode="#,##0.00"').replace('</patternFill></fill><borders','</patternFill></fill></fills><borders').replace('</cellXfs></styleSheet>','</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')],...sheets.map((sheet,index)=>[`xl/worksheets/sheet${index+1}.xml`,sheet[1]]),
  ]);
}
