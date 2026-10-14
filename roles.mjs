// Ruoli e permessi: unico punto di verità, usato dal server e dal browser.
//
// - admin: tutto, compresi utenti, backup, registro modifiche, anagrafiche e rettifiche MES.
// - planner (Pianificatore): pianifica e rilascia, gestisce calendario e causali, vede statistiche.
// - operator (Operatore): solo bordo macchina.
export const ROLES = ['admin', 'planner', 'operator'];

export const ROLE_LABELS = {admin: 'Amministratore', planner: 'Pianificatore', operator: 'Operatore'};

const PERMISSIONS = {
  shopfloor: ['admin', 'planner', 'operator'],
  plan: ['admin', 'planner'],
  calendar: ['admin', 'planner'],
  reasons: ['admin', 'planner'],
  statistics: ['admin', 'planner'],
  catalogues: ['admin'],
  users: ['admin'],
  backups: ['admin'],
  audit: ['admin'],
  correct: ['admin'],
};

const ACTION_PERMISSIONS = {
  plan: 'plan', realign: 'plan', task: 'plan', status: 'plan', setupOverride: 'plan', periodProposal: 'plan',
  calendar: 'calendar', maintenance: 'calendar',
  machine: 'catalogues', type: 'catalogues', article: 'catalogues', setupRule: 'catalogues',
};

export const roleLabel = role => ROLE_LABELS[role] || '';

/** True when the role holds the permission. Unknown roles and unknown permissions hold nothing. */
export function can(role, permission) {
  return Boolean(PERMISSIONS[permission]?.includes(role));
}

/** Permission an action kind needs; null for an unknown kind (callers must treat it as not allowed). */
export function permissionForAction(kind) {
  return ACTION_PERMISSIONS[kind] ?? null;
}

export function canAct(role, kind) {
  const permission = permissionForAction(kind);
  return permission !== null && can(role, permission);
}
