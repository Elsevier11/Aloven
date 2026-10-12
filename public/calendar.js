const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const ISO_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

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
