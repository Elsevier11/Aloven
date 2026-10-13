// Week view of the planning: Monday to Saturday, Sunday only when something needs it. Dates are "YYYY-MM-DD" strings.
const DAY = 864e5;
const at = date => Date.parse(`${date}T00:00:00Z`);
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export const shiftDate = (date, days) => iso(at(date) + days * DAY);
/** Monday of the week containing the date. */
export function weekStart(date) {
  return shiftDate(date, -((new Date(at(date)).getUTCDay() + 6) % 7));
}
/** ISO 8601 week number (the week belongs to the year of its Thursday). */
export function weekNumber(date) {
  const thursday = shiftDate(weekStart(date), 3);
  const firstWeek = weekStart(`${thursday.slice(0, 4)}-01-04`);
  return 1 + Math.round((at(weekStart(thursday)) - at(firstWeek)) / (7 * DAY));
}
/** Monday to Saturday, plus Sunday when asked. */
export function weekDates(date, {sunday = false} = {}) {
  const first = weekStart(date);
  return Array.from({length: sunday ? 7 : 6}, (_, index) => shiftDate(first, index));
}
/** Sunday is shown only if a visible machine is available, or something is planned or blocked on that day. */
export function needsSunday(sunday, {machines, tasks, calendar, effectiveShifts}) {
  if (machines.some(machine => effectiveShifts(sunday, machine.id).length > 0)) return true;
  const touches = (start, end) => String(start).slice(0, 10) <= sunday && String(end).slice(0, 10) >= sunday;
  const visible = new Set(machines.map(machine => machine.id));
  if (tasks.some(task => visible.has(task.machineId) && task.position != null && task.status !== 'cancelled' && (task.segments || []).some(segment => touches(segment.start, segment.end)))) return true;
  return (calendar?.maintenanceBlocks || []).some(block => (!block.machineId || visible.has(block.machineId)) && touches(block.start, block.end));
}
/** "Settimana 42 · 12–17 ott 2026", with months or years spelled out when the week crosses them. */
export function weekLabel(dates) {
  const first = dates[0], last = dates.at(-1);
  const part = date => ({day: Number(date.slice(8, 10)), month: MONTHS[Number(date.slice(5, 7)) - 1], year: date.slice(0, 4)});
  const a = part(first), b = part(last);
  const range = a.year !== b.year ? `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`
    : a.month !== b.month ? `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}` : `${a.day}–${b.day} ${b.month} ${b.year}`;
  return `Settimana ${weekNumber(first)} · ${range}`;
}
/** Short label of a single day, e.g. "mar 13 ott 2026". */
export function dayLabel(date) {
  return new Intl.DateTimeFormat('it-IT', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(at(date))).replace(/\./g, '');
}
/** Compact form for narrow screens: no year. */
export function weekLabelShort(dates) {
  const first = dates[0], last = dates.at(-1);
  const part = date => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
  return `Sett. ${weekNumber(first)} · ${first.slice(5, 7) === last.slice(5, 7) ? `${Number(first.slice(8, 10))}–${part(last)}` : `${part(first)} – ${part(last)}`}`;
}
