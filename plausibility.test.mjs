import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFinishPlausibility, qualityStatusWithPlausibility, requirePlausibilityReason } from './quality.mjs';

const execution = {
  plannedQuantity: 420,
  plannedRunMinutes: 60,
  productUnit: 'm',
  component1Code: 'TESS-1', component1Unit: 'm',
  component2Code: 'COLLA', component2Unit: 'kg',
};

test('quantità enorme, tempo nullo e consumo comparabile minimo richiedono motivazione', () => {
  const declaration = {
    goodQuantity: 999999, scrapQuantity: 0,
    lots: [
      {component:'component1',quantity:1},
      {component:'component2',quantity:1},
    ],
  };
  const flags = assessFinishPlausibility(declaration, execution, 0);
  assert.ok(flags.some(flag => flag.code === 'quantity_vs_planned'));
  assert.ok(flags.some(flag => flag.code === 'output_without_time'));
  assert.ok(flags.some(flag => flag.code === 'consumption_vs_output' && flag.component === 'component1'));
  assert.ok(!flags.some(flag => flag.code === 'consumption_vs_output' && flag.component === 'component2'), 'unità non comparabili non sono confrontate');
  assert.throws(() => requirePlausibilityReason({}, flags), /valori fuori soglia.*motivazione/i);
  assert.equal(requirePlausibilityReason({plausibilityReason:'Errore verificato con il responsabile'}, flags), 'Errore verificato con il responsabile');
  assert.equal(qualityStatusWithPlausibility('conforming', flags), 'review');
  assert.equal(qualityStatusWithPlausibility('nonconforming', flags), 'nonconforming', 'uno scostamento non deve mascherare un difetto dichiarato');
  assert.equal(qualityStatusWithPlausibility('review', flags), 'review');
});

test('valori conservativi entro soglia non richiedono motivazione', () => {
  const flags = assessFinishPlausibility({
    goodQuantity:400,scrapQuantity:10,
    lots:[{component:'component1',quantity:410},{component:'component2',quantity:20}],
  }, execution, 3600);
  assert.deepEqual(flags, []);
  assert.equal(requirePlausibilityReason({}, flags), null);
});
