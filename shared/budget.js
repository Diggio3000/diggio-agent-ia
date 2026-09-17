// Un valore vuoto, nullo o zero disattiva la soglia locale dei token.
export function tokenBudget(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
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
