import {weekStart,shiftDate} from './planning-week.js';
function civilNow(at){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
export function taskInPeriod(task,dates){return (task.segments||[]).some(s=>s.start&&s.end&&s.end>s.start&&dates.some(date=>s.start.slice(0,10)<=date&&s.end>date+'T00:00'));}
export function planningWarnings(state,at=new Date()){const now=civilNow(at),warnings=new Map();for(const machine of state.machines){const sequence=state.tasks.filter(t=>t.machineId===machine.id&&t.position!==null&&!['completed','cancelled'].includes(t.status)).sort((a,b)=>a.position-b.position);const stopped=(state.machineStops||[]).some(x=>x.machineId===machine.id&&!x.endedAt);const late=sequence.find(t=>t.status==='in_progress'&&t.end&&t.end<now);for(const t of sequence){if(stopped)warnings.set(t.id,'Macchina ferma: piano da verificare alla ripresa');else if(late&&t.position>=late.position)warnings.set(t.id,t.id===late.id?'Fine prevista superata: lavorazione ancora in corso':'Attività precedente in ritardo: piano da verificare');else if(t.status==='planned'&&t.start&&t.start<now)warnings.set(t.id,'Inizio previsto superato: attività non avviata. Verifica data e sequenza.');}}return warnings;}
export function periodLoad(state,machines,dates,shifts,showCompleted=false){const ids=new Set(machines.map(m=>m.id)),days=new Set(dates);let available=0,occupied=0;for(const m of machines)for(const date of dates)for(const [start,end] of shifts(date,m.id))available+=minutes(end)-minutes(start);for(const t of state.tasks){if(!ids.has(t.machineId)||t.position===null||(!showCompleted&&t.status==='completed'))continue;for(const s of t.segments)if(days.has(s.start.slice(0,10)))occupied+=minutes(s.end.slice(11))-minutes(s.start.slice(11));}return {available,occupied,percent:available?Math.round(occupied/available*100):null};}

const segmentMinutes=segment=>{
  if(!segment?.start||!segment?.end)return 0;
  const from=minutes(segment.start.slice(11)),to=segment.end.slice(0,10)===segment.start.slice(0,10)?minutes(segment.end.slice(11)):1440;
  return Math.max(0,to-from);
};
/** Saturation of one machine over the given dates: planned minutes against shift minutes (maintenance already out of the shifts). */
export function machineLoad(state,machine,dates,shifts,{showCompleted=false,extraSegments=[]}={}){
  const days=new Set(dates);let available=0,occupied=0;
  for(const date of dates)for(const [start,end] of shifts(date,machine.id))available+=minutes(end)-minutes(start);
  const count=segments=>{for(const segment of segments||[])if(segment?.start&&days.has(segment.start.slice(0,10)))occupied+=segmentMinutes(segment);};
  for(const task of state.tasks){if(task.machineId!==machine.id||task.position==null||(!showCompleted&&task.status==='completed'))continue;count(task.segments);}
  count(extraSegments);
  const stopped=(state.machineStops||[]).some(stop=>stop.machineId===machine.id&&!stop.endedAt);
  const uncertain=stopped||state.tasks.some(task=>task.machineId===machine.id&&task.status==='in_progress');
  return {available,occupied,percent:available?Math.round(occupied/available*100):null,uncertain};
}
/** Mondays of the weeks a release touches (new and old dates), plus the current and the next week. */
export function releaseWeeks(changes,today,limit=6){
  const weeks=new Set([weekStart(today),weekStart(shiftDate(today,7))]);
  for(const change of changes||[])for(const value of [change.newStart,change.oldStart])if(value)weeks.add(weekStart(value.slice(0,10)));
  return [...weeks].sort().slice(0,limit);
}
/** Saturation per machine for each week (Monday to Sunday). */
export function weeklyReleaseSummary(state,machines,weekStarts,shifts){
  return weekStarts.map(week=>{
    const dates=Array.from({length:7},(_,day)=>shiftDate(week,day));
    return {weekStart:week,dates,machines:machines.map(machine=>({machineId:machine.id,...machineLoad(state,machine,dates,shifts)}))};
  });
}
/** Activities still to plan; the ones due within (or before the end of) the weeks considered come first. */
export function backlogLeftOut(state,weekStarts){
  const limit=weekStarts.length?shiftDate(weekStarts.at(-1),6):'';
  const open=state.tasks.filter(task=>task.status==='unplanned');
  const due=open.filter(task=>task.dueDate&&limit&&task.dueDate<=limit).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.title.localeCompare(b.title,'it'));
  return {total:open.length,due:due.map(task=>({id:task.id,title:task.title,dueDate:task.dueDate,machineId:task.machineId})),dueCount:due.length};
}
