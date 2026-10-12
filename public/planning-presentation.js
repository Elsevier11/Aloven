function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function taskReference(task = {}) {
  const order = text(task.orderReference);
  const outputLot = text(task.outputLot);
  const references = [order && `Ord. ${order}`, outputLot && `Lotto ${outputLot}`].filter(Boolean);
  if (references.length) return references.join(' · ');

  const title = text(task.title);
  const titleLot = title.match(/\blotto\s+([^\s,;]+)/i)?.[1];
  if (titleLot) return `Lotto ${titleLot}`;
  return text(task.productCode) || title;
}

export function taskBarReference(task = {}) {
  const title = text(task.title);
  const titleLot = title.match(/\blotto\s+([^\s,;]+)/i)?.[1] || '';
  const value = (text(task.outputLot) || titleLot || text(task.orderReference) || text(task.productCode) || title)
    .replace(/^(?:ord\.?|lotto)\s+/i, '');
  return value.length > 16 ? `${value.slice(0, 4)}…${value.slice(-8)}` : value;
}

export function dispatchLabel(task = {}) {
  const state = task.planningState;
  if (state === 'released') return 'Inviata al reparto';
  if (state === 'modified') return 'Modificata · da inviare';
  if (state === 'pending_removal') return 'Da togliere dal reparto';
  if (state === 'unreleased') return task.position != null ? 'Da inviare al reparto' : 'Non inviata al reparto';
  if (state === 'in_progress' || task.status === 'in_progress') {
    return task.releasedVersion != null ? 'Inviata al reparto' : 'In produzione';
  }
  if (state === 'completed' || task.status === 'completed') {
    return task.releasedVersion != null ? 'Inviata al reparto' : 'Conclusa';
  }
  return task.releasedVersion != null ? 'Inviata al reparto' : task.position != null ? 'Da inviare al reparto' : 'Non inviata al reparto';
}

export function dispatchTone(task = {}) {
  if (task.planningState === 'pending_removal') return 'removal';
  if (task.planningState === 'modified') return 'modified';
  if (task.planningState === 'released' || task.releasedVersion != null) return 'released';
  return 'pending';
}

function taskChange(task) {
  const removed = task.planningState === 'pending_removal';
  const isNew = task.planningState === 'unreleased' || task.releasedVersion == null;
  return {
    id: task.id,
    title: text(task.title),
    reference: taskReference(task),
    kind: removed ? 'removed' : isNew ? 'new' : 'changed',
    details: releaseDetails(task),
    oldMachineId: task.releasedMachineId ?? null,
    newMachineId: removed ? null : task.machineId ?? null,
    oldStart: task.releasedStart ?? null,
    newStart: removed ? null : task.start ?? null,
    oldEnd: task.releasedEnd ?? null,
    newEnd: removed ? null : task.end ?? null,
  };
}

function releaseDetails(task) {
  let previous;
  try { previous=typeof task.releasedPayload==='string'?JSON.parse(task.releasedPayload):task.releasedPayload; } catch { return []; }
  if(!previous)return [];
  const fields={title:'Nome attività',orderReference:'Ordine',outputLot:'Lotto',productCode:'Prodotto',quantity:'Quantità prevista',setupMinutes:'Attrezzaggio (minuti)',runMinutes:'Lavorazione (minuti)',fixedStart:'Inizio fissato',position:'Posizione in sequenza',component1Code:'Componente 1',component2Code:'Componente 2'};
  const displayValue=(key,value)=>key==='position'&&value!=null?Number(value)+1:value??null;
  return Object.entries(fields).filter(([key])=>JSON.stringify(previous[key]??null)!==JSON.stringify(task[key]??null)).map(([key,label])=>({label,before:displayValue(key,previous[key]),after:displayValue(key,task[key])}));
}

export function releaseChanges(state = {}) {
  const planning = state.planning || {};
  const changedIds = new Set(planning.changedTaskIds || []);
  const firstRelease = Number(planning.version || 0) === 0;
  return (state.tasks || [])
    .filter(task => changedIds.has(task.id) || (firstRelease && task.status === 'planned' && task.position != null))
    .map(taskChange);
}

export function maintenanceReleaseChanges(state = {}) {
  const planning = state.planning || {};
  const changedIds = new Set(planning.changedMaintenanceIds || []);
  if (!changedIds.size) return [];

  const draftById = new Map((state.calendar?.maintenanceBlocks || []).map(block => [block.id, block]));
  const releasedById = new Map((planning.releasedMaintenanceBlocks || []).map(block => [block.id, block]));
  return [...changedIds].map(id => {
    const oldBlock = releasedById.get(id);
    const newBlock = draftById.get(id);
    return {
      id,
      kind: !oldBlock ? 'new' : !newBlock ? 'removed' : 'changed',
      name: text(newBlock?.name) || text(oldBlock?.name),
      oldName: text(oldBlock?.name),
      newName: text(newBlock?.name),
      oldMachineId: oldBlock?.machineId ?? null,
      newMachineId: newBlock?.machineId ?? null,
      oldStart: oldBlock?.start ?? null,
      newStart: newBlock?.start ?? null,
      oldEnd: oldBlock?.end ?? null,
      newEnd: newBlock?.end ?? null,
    };
  });
}
