export function validateAutomation(a) {
  if (
    !Number.isSafeInteger(a.id) ||
    a.id < 1 ||
    !String(a.name || '').trim() ||
    !String(a.task || '').trim()
  )
    throw new Error('Nome e attività sono obbligatori.');
  if (!['interval', 'daily'].includes(a.scheduleType))
    throw new Error('Pianificazione non valida.');
  if (
    a.scheduleType === 'interval' &&
    (!Number.isFinite(a.intervalMinutes) || a.intervalMinutes < 1)
  )
    throw new Error('Intervallo minimo: un minuto.');
  if (
    a.scheduleType === 'daily' &&
    (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) ||
      !Array.isArray(a.days) ||
      !a.days.length ||
      a.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  )
    throw new Error('Scegli un orario valido e almeno un giorno.');
  if (!Number.isInteger(a.maxRuns) || a.maxRuns < 0)
    throw new Error('Limite esecuzioni non valido.');
  return a;
}
export function calcNextRun(time, days, now = new Date()) {
  const [h, m] = time.split(':').map(Number);
  const candidate = new Date(now);
  candidate.setHours(h, m, 0, 0);
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
  for (let i = 0; i < 8; i++) {
    if (days.includes(candidate.getDay())) return candidate.getTime();
    candidate.setDate(candidate.getDate() + 1);
  }
  throw new Error('Nessun giorno valido.');
}
export function scheduleSpec(a, now = new Date()) {
  return a.scheduleType === 'interval'
    ? { delayInMinutes: a.intervalMinutes, periodInMinutes: a.intervalMinutes }
    : { when: calcNextRun(a.time, a.days, now) };
}
