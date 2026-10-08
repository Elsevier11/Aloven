const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const DAY = 24 * 60;

function fail(message) {
  throw new Error(message);
}

function parseDate(value, label = 'data') {
  const match = typeof value === 'string' && DATE_RE.exec(value);
  if (!match) fail(`${label} non valida: usare YYYY-MM-DD`);
  const [, ys, ms, ds] = match;
  const year = Number(ys);
  const month = Number(ms);
  const day = Number(ds);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail(`${label} non valida: ${value}`);
  }
  return Math.trunc(date.getTime() / 60000);
}

function parseTime(value, label = 'orario') {
  const match = typeof value === 'string' && TIME_RE.exec(value);
  if (!match) fail(`${label} non valido: usare HH:mm`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) fail(`${label} non valido: ${value}`);
  return hour * 60 + minute;
}

function parseIso(value, label = 'data e ora') {
  const match = typeof value === 'string' && ISO_RE.exec(value);
  if (!match) fail(`${label} non valida: usare YYYY-MM-DDTHH:mm`);
  const day = parseDate(`${match[1]}-${match[2]}-${match[3]}`, label);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) fail(`${label} non valida: ${value}`);
  return day + hour * 60 + minute;
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function formatIso(minutes) {
  const date = new Date(minutes * 60000);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatDate(dayMinutes) {
  return formatIso(dayMinutes).slice(0, 10);
}

function validateShifts(shifts, label) {
  if (!Array.isArray(shifts)) fail(`${label} deve essere un array di turni`);
  const parsed = shifts.map((shift, index) => {
    if (!Array.isArray(shift) || shift.length !== 2) fail(`${label}, turno ${index + 1} non valido`);
    const start = parseTime(shift[0], `${label}, inizio turno ${index + 1}`);
    const end = parseTime(shift[1], `${label}, fine turno ${index + 1}`);
    if (end <= start) fail(`${label}, turno ${index + 1}: la fine deve seguire l'inizio nello stesso giorno`);
    return [start, end];
  }).sort((a, b) => a[0] - b[0]);

  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index][0] < parsed[index - 1][1]) fail(`${label}: i turni si sovrappongono`);
  }
  return parsed;
}

export function validateCalendar(calendar) {
  if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar)) fail('Calendario non valido');
  if (!calendar.weekly || typeof calendar.weekly !== 'object' || Array.isArray(calendar.weekly)) {
    fail('Calendario settimanale non valido');
  }
  if (calendar.exceptions !== undefined && (!calendar.exceptions || typeof calendar.exceptions !== 'object' || Array.isArray(calendar.exceptions))) {
    fail('Eccezioni del calendario non valide');
  }

  const weekly = {};
  for (const key of Object.keys(calendar.weekly)) {
    if (!/^[0-6]$/.test(key)) fail(`Giorno settimanale non valido: ${key}`);
  }
  for (let day = 0; day < 7; day += 1) {
    weekly[day] = validateShifts(calendar.weekly[day] ?? [], `Calendario settimanale, giorno ${day}`);
  }

  const exceptions = {};
  for (const [date, shifts] of Object.entries(calendar.exceptions ?? {})) {
    parseDate(date, 'Data eccezione');
    exceptions[date] = validateShifts(shifts, `Eccezione ${date}`);
  }
  return { weekly, exceptions };
}

function validateTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) fail('Attività non valida');
  if (task.status === 'cancelled') fail(`Attività ${task.id ?? ''} annullata: non può essere pianificata`);
  for (const field of ['setupMinutes', 'runMinutes']) {
    if (!Number.isSafeInteger(task[field]) || task[field] < 0) {
      fail(`Attività ${task.id ?? ''}: ${field} deve essere un intero non negativo`);
    }
  }
  if (task.runMinutes <= 0) fail(`Attività ${task.id ?? ''}: runMinutes deve essere maggiore di zero`);
}

function horizonFor(start) {
  const date = new Date(start * 60000);
  return Math.trunc(Date.UTC(
    date.getUTCFullYear() + 5,
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  ) / 60000);
}

function shiftsForDay(day, calendar) {
  const date = formatDate(day);
  const weekday = new Date(day * 60000).getUTCDay();
  const shifts = Object.hasOwn(calendar.exceptions, date) ? calendar.exceptions[date] : calendar.weekly[weekday];
  return shifts.map(([start, end]) => [day + start, day + end]);
}

function* availableShifts(from, horizon, calendar) {
  let day = Math.floor(from / DAY) * DAY;
  const lastDay = Math.floor(horizon / DAY) * DAY;
  while (day <= lastDay) {
    for (const shift of shiftsForDay(day, calendar)) {
      if (shift[1] > from && shift[0] < horizon) yield shift;
    }
    day += DAY;
  }
}

function scheduleRun(from, duration, horizon, calendar) {
  let remaining = duration;
  const segments = [];
  for (const [shiftStart, shiftEnd] of availableShifts(from, horizon, calendar)) {
    const start = Math.max(from, shiftStart);
    const usable = Math.min(remaining, shiftEnd - start);
    if (usable <= 0) continue;
    const end = start + usable;
    segments.push({ start, end, kind: 'run' });
    remaining -= usable;
    from = end;
    if (remaining === 0) return segments;
  }
  fail('Impossibile completare la lavorazione entro l’orizzonte massimo di 5 anni');
}

function scheduleValidatedTask(task, earliest, calendar) {
  const horizon = horizonFor(earliest);
  let setupStart;
  let setupEnd;

  for (const [shiftStart, shiftEnd] of availableShifts(earliest, horizon, calendar)) {
    const candidate = Math.max(earliest, shiftStart);
    if (task.setupMinutes <= shiftEnd - candidate) {
      setupStart = candidate;
      setupEnd = candidate + task.setupMinutes;
      break;
    }
  }
  if (setupStart === undefined) {
    if (task.setupMinutes > 0) fail(`Setup di ${task.setupMinutes} minuti impossibile: nessun turno disponibile è abbastanza lungo`);
    fail('Nessuna disponibilità nel calendario entro 5 anni');
  }

  const runSegments = scheduleRun(setupEnd, task.runMinutes, horizon, calendar);
  const segments = [];
  if (task.setupMinutes > 0) segments.push({ start: setupStart, end: setupEnd, kind: 'setup' });
  segments.push(...runSegments);
  return {
    ...task,
    start: formatIso(setupStart),
    end: formatIso(runSegments.at(-1).end),
    segments: segments.map(segment => ({ ...segment, start: formatIso(segment.start), end: formatIso(segment.end) })),
  };
}

export function scheduleTask(task, earliest, calendar) {
  validateTask(task);
  const start = parseIso(earliest, 'Data iniziale');
  const validatedCalendar = validateCalendar(calendar);
  return scheduleValidatedTask(task, start, validatedCalendar);
}

function validateLockedTask(task, calendar) {
  const start = parseIso(task.start, `Inizio attività bloccata ${task.id ?? ''}`);
  const end = parseIso(task.end, `Fine attività bloccata ${task.id ?? ''}`);
  if (end <= start) fail(`Attività bloccata ${task.id ?? ''}: intervallo non valido`);
  if (!Array.isArray(task.segments) || task.segments.length === 0) {
    fail(`Attività bloccata ${task.id ?? ''}: segmenti mancanti`);
  }

  let setupTotal = 0;
  let runTotal = 0;
  let previousEnd;
  let firstStart;
  let lastEnd;
  let setupCount = 0;
  let runSeen = false;
  for (const [index, segment] of task.segments.entries()) {
    if (!segment || (segment.kind !== 'setup' && segment.kind !== 'run')) {
      fail(`Attività bloccata ${task.id ?? ''}: segmento ${index + 1} non valido`);
    }
    const segmentStart = parseIso(segment.start, `Inizio segmento ${index + 1}`);
    const segmentEnd = parseIso(segment.end, `Fine segmento ${index + 1}`);
    if (segmentEnd <= segmentStart || (previousEnd !== undefined && segmentStart < previousEnd)) {
      fail(`Attività bloccata ${task.id ?? ''}: segmenti non ordinati o sovrapposti`);
    }
    let covered = 0;
    let day = Math.floor(segmentStart / DAY) * DAY;
    while (day <= Math.floor((segmentEnd - 1) / DAY) * DAY) {
      for (const [shiftStart, shiftEnd] of shiftsForDay(day, calendar)) {
        covered += Math.max(0, Math.min(segmentEnd, shiftEnd) - Math.max(segmentStart, shiftStart));
      }
      day += DAY;
    }
    if (covered !== segmentEnd - segmentStart) fail(`Attività bloccata ${task.id ?? ''}: segmento fuori calendario`);
    if (segment.kind === 'setup') {
      if (runSeen) fail(`Attività bloccata ${task.id ?? ''}: il setup deve precedere la lavorazione`);
      setupCount += 1;
      setupTotal += segmentEnd - segmentStart;
      const segmentDay = Math.floor(segmentStart / DAY) * DAY;
      const containedInOneShift = shiftsForDay(segmentDay, calendar)
        .some(([shiftStart, shiftEnd]) => segmentStart >= shiftStart && segmentEnd <= shiftEnd);
      if (!containedInOneShift) fail(`Attività bloccata ${task.id ?? ''}: il setup deve restare in un solo turno`);
    } else {
      runSeen = true;
      runTotal += segmentEnd - segmentStart;
    }
    firstStart ??= segmentStart;
    lastEnd = segmentEnd;
    previousEnd = segmentEnd;
  }
  if (setupCount > 1 || setupTotal !== task.setupMinutes || runTotal !== task.runMinutes || firstStart !== start || lastEnd !== end) {
    fail(`Attività bloccata ${task.id ?? ''}: durate, estremi o setup dei segmenti non coerenti`);
  }
  return { start, end };
}

export function scheduleMachine(tasks, anchor, calendar) {
  if (!Array.isArray(tasks)) fail('La sequenza attività deve essere un array');
  const anchorMinute = parseIso(anchor, 'Data di ancoraggio');
  const validatedCalendar = validateCalendar(calendar);
  const result = [];
  let cursor = anchorMinute;
  let previousEnd;

  for (const task of tasks) {
    validateTask(task);
    const locked = task.status === 'in_progress' || task.status === 'completed';
    if (locked) {
      const interval = validateLockedTask(task, validatedCalendar);
      if (previousEnd !== undefined && previousEnd > interval.start) {
        fail(`Sovrapposizione: l’attività precedente termina dopo l’inizio dell’attività bloccata ${task.id ?? ''}`);
      }
      result.push(task);
      cursor = Math.max(cursor, interval.end);
      previousEnd = interval.end;
      continue;
    }

    const scheduled = scheduleValidatedTask(task, cursor, validatedCalendar);
    result.push(scheduled);
    previousEnd = parseIso(scheduled.end);
    cursor = previousEnd;
  }
  return result;
}
