import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLES, can, canAct, permissionForAction, roleLabel} from './roles.mjs';

test('tre ruoli con etichette italiane', () => {
  assert.deepEqual(ROLES, ['admin', 'planner', 'operator']);
  assert.equal(roleLabel('admin'), 'Amministratore');
  assert.equal(roleLabel('planner'), 'Pianificatore');
  assert.equal(roleLabel('operator'), 'Operatore');
  assert.equal(roleLabel('altro'), '');
});

test('l’operatore ha solo il bordo macchina', () => {
  assert.equal(can('operator', 'shopfloor'), true);
  for (const permission of ['plan', 'calendar', 'reasons', 'statistics', 'catalogues', 'users', 'backups', 'audit', 'correct'])
    assert.equal(can('operator', permission), false, permission);
});

test('il pianificatore pianifica, rilascia e gestisce calendario e causali, ma non anagrafiche e amministrazione', () => {
  for (const permission of ['shopfloor', 'plan', 'calendar', 'reasons', 'statistics'])
    assert.equal(can('planner', permission), true, permission);
  for (const permission of ['catalogues', 'users', 'backups', 'audit', 'correct'])
    assert.equal(can('planner', permission), false, permission);
});

test('l’amministratore ha tutti i permessi', () => {
  for (const permission of ['shopfloor', 'plan', 'calendar', 'reasons', 'statistics', 'catalogues', 'users', 'backups', 'audit', 'correct'])
    assert.equal(can('admin', permission), true, permission);
});

test('ruoli e permessi sconosciuti non ottengono nulla', () => {
  assert.equal(can('guest', 'shopfloor'), false);
  assert.equal(can(undefined, 'plan'), false);
  assert.equal(can('admin', 'inesistente'), false);
});

test('azioni di pianificazione: pianificatore sì; anagrafiche solo amministratore; tipo ignoto mai', () => {
  for (const kind of ['plan', 'realign', 'task', 'status', 'setupOverride', 'periodProposal', 'calendar', 'maintenance']) {
    assert.equal(canAct('planner', kind), true, kind);
    assert.equal(canAct('operator', kind), false, kind);
  }
  for (const kind of ['machine', 'type', 'article', 'setupRule']) {
    assert.equal(permissionForAction(kind), 'catalogues');
    assert.equal(canAct('planner', kind), false, kind);
    assert.equal(canAct('admin', kind), true, kind);
  }
  assert.equal(permissionForAction('qualcosa'), null);
  assert.equal(canAct('admin', 'qualcosa'), false, 'un tipo di azione sconosciuto è rifiutato anche all’amministratore');
});
