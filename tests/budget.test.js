import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenBudget, migrateTokenBudgets } from '../shared/budget.js';

test('Budget facoltativo: vuoto e zero disattivano; soglie positive conservate', () => {
  for (const value of [undefined, null, '', ' ', 0, '0', -1, NaN, Infinity])
    assert.equal(tokenBudget(value), 0);
  assert.equal(tokenBudget('80000'), 80000);
  assert.equal(tokenBudget(120000), 120000);
});

test('Migrazione rimuove il vecchio predefinito anche da profili e automazioni', () => {
  const input = {
    tokenBudget: 80000,
    providerConfigs: { ollama: { tokenBudget: 80000, model: 'test' }, custom: { tokenBudget: 150000 } },
    sourceConfigs: { local: { tokenBudget: 80000 } },
    automations: [{ id: 1, config: { tokenBudget: 80000, maxSteps: 25 } }, { id: 2, config: { tokenBudget: 90000 } }]
  };
  const patch = migrateTokenBudgets(input);
  assert.equal(patch.tokenBudget, 0);
  assert.equal(patch.providerConfigs.ollama.tokenBudget, 0);
  assert.equal(patch.providerConfigs.ollama.model, 'test');
  assert.equal(patch.providerConfigs.custom.tokenBudget, 150000);
  assert.equal(patch.sourceConfigs.local.tokenBudget, 0);
  assert.equal(patch.automations[0].config.tokenBudget, 0);
  assert.equal(patch.automations[0].config.maxSteps, 25);
  assert.equal(patch.automations[1].config.tokenBudget, 90000);
  assert.equal(input.tokenBudget, 80000);
  assert.equal(migrateTokenBudgets({}).tokenBudget, 0);
  assert.equal(migrateTokenBudgets({ tokenBudget: 120000 }).tokenBudget, 120000);
  assert.deepEqual(migrateTokenBudgets({ ...patch, tokenBudget: 80000 }), {}, 'Una soglia scelta dopo la migrazione resta attiva, anche se è 80000');
});
