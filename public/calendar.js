const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const ISO_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** National holidays preset. Patron saint and company closures must be entered separately. */
export function italianHolidays(year){
  if(!Number.isInteger(year)||year<1900||year>9998)throw new Error('Anno non valido (1900–9998).');
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  const easter=new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10);
  const monday=new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
  // Law 151/2025 adds 4 October from 2026; do not backdate the new holiday.
  const fixed=[['01-01','Capodanno'],['01-06','Epifania'],['04-25','Liberazione'],['05-01','Festa del lavoro'],['06-02','Festa della Repubblica'],['08-15','Ferragosto'],['11-01','Ognissanti'],['12-08','Immacolata'],['12-25','Natale'],['12-26','Santo Stefano']];
  if(year>=2026)fixed.push(['10-04','San Francesco d’Assisi']);
  return Object.fromEntries(fixed.map(([date,name])=>[`${year}-${date}`,name]).concat([[easter,'Pasqua'],[monday,'Lunedì di Pasqua']]));
}

export function addItalianHolidays(calendar,year){
  const next=structuredClone(calendar);next.exceptions??={};
  for(const date of Object.keys(italianHolidays(year)))if(!Object.hasOwn(next.exceptions,date))next.exceptions[date]=[];
  return next;
}

function wallMinutes(value){
  if(!ISO_RE.test(value||''))return NaN;
  const parsed=Date.parse(value+'Z');
  return Number.isFinite(parsed)?parsed/60000:NaN;
}

function timeMinutes(value){
  const match=/^(\d{2}):(\d{2})$/.exec(value||'');
  if(!match)return NaN;
  const result=Number(match[1])*60+Number(match[2]);
  return Number(match[1])<24&&Number(match[2])<60?result:NaN;
}

function formatTime(value){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}

export function effectiveMachineShifts(calendar,date,machineId){
  if(!DATE_RE.test(date||''))return [];
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  const machineExceptions=calendar?.machineExceptions?.[machineId]||{};
  const shifts=Object.hasOwn(machineExceptions,date)?machineExceptions[date]
    :Object.hasOwn(calendar?.exceptions||{},date)?calendar.exceptions[date]
    :calendar?.weekly?.[weekday]||[];
  let result=shifts.map(shift=>[timeMinutes(shift[0]),timeMinutes(shift[1])]).filter(([start,end])=>Number.isFinite(start)&&Number.isFinite(end)&&end>start);
  const dayStart=wallMinutes(date+'T00:00'),dayEnd=dayStart+1440;
  for(const block of calendar?.maintenanceBlocks||[]){
    if(machineId!=null&&block.machineId!==machineId)continue;
    const start=Math.max(dayStart,wallMinutes(block.start)),end=Math.min(dayEnd,wallMinutes(block.end));
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
    const localStart=start-dayStart,localEnd=end-dayStart,next=[];
    for(const [shiftStart,shiftEnd] of result){
      if(localEnd<=shiftStart||localStart>=shiftEnd)next.push([shiftStart,shiftEnd]);
      else {
        if(localStart>shiftStart)next.push([shiftStart,Math.min(localStart,shiftEnd)]);
        if(localEnd<shiftEnd)next.push([Math.max(localEnd,shiftStart),shiftEnd]);
      }
    }
    result=next;
  }
  return result.map(([start,end])=>[formatTime(start),formatTime(end)]);
}

export function maintenanceDates(calendar,machineId){
  const result=new Set();
  for(const block of calendar?.maintenanceBlocks||[]){
    if(block.machineId!==machineId)continue;
    let cursor=Math.floor(wallMinutes(block.start)/1440)*1440;
    const end=wallMinutes(block.end);
    if(!Number.isFinite(cursor)||!Number.isFinite(end))continue;
    while(cursor<end){result.add(new Date(cursor*60000).toISOString().slice(0,10));cursor+=1440;}
  }
  return result;
}

export function effectiveMachineCalendar(calendar,machineId){
  const exceptions={...(calendar?.exceptions||{}),...(calendar?.machineExceptions?.[machineId]||{})};
  for(const date of maintenanceDates(calendar,machineId))exceptions[date]=effectiveMachineShifts(calendar,date,machineId);
  return {weekly:calendar?.weekly||{},exceptions};
}
