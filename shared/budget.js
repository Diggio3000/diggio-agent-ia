// Un valore vuoto, nullo o zero disattiva la soglia locale dei token.
export function tokenBudget(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function stepBudget(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export function migrateStepBudgets(settings) {
  if (settings.optionalStepBudgetVersion === 1) return {};
  const migrate = (config) => ({ ...config,
    maxSteps: Number(config?.maxSteps) === 40 ? 0 : stepBudget(config?.maxSteps) });
  const patch = { optionalStepBudgetVersion: 1, maxSteps: migrate(settings).maxSteps };
  for (const key of ['providerConfigs', 'sourceConfigs'])
    if (settings[key] && typeof settings[key] === 'object' && !Array.isArray(settings[key]))
      patch[key] = Object.fromEntries(Object.entries(settings[key]).map(([name, config]) => [name, migrate(config)]));
  if (Array.isArray(settings.automations))
    patch.automations = settings.automations.map((a) => a.config ? { ...a, config: migrate(a.config) } : a);
  return patch;
}

export function migrateTokenBudgets(settings) {
  if (settings.optionalTokenBudgetVersion === 1) return {};
  const migrate = (config) => ({
    ...config,
    tokenBudget: Number(config?.tokenBudget) === 80000 ? 0 : tokenBudget(config?.tokenBudget)
  });
  const patch = { optionalTokenBudgetVersion: 1, tokenBudget: migrate(settings).tokenBudget };
  for (const key of ['providerConfigs', 'sourceConfigs']) {
    if (settings[key] && typeof settings[key] === 'object' && !Array.isArray(settings[key]))
      patch[key] = Object.fromEntries(Object.entries(settings[key]).map(([name, config]) => [name, migrate(config)]));
  }
  if (Array.isArray(settings.automations))
    patch.automations = settings.automations.map((automation) =>
      automation.config ? { ...automation, config: migrate(automation.config) } : automation);
  return patch;
}
