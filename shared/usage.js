// Solo misure dichiarate dal servizio: nessuna stima di saldo o quota account.
const number = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const sum = (a, b) => (a !== null && b !== null ? a + b : null);
export function normalizeUsage(json, costInUSD = false) {
  const u = json?.usage || {};
  const cacheRead = number(
    u.cache_read_input_tokens ??
      u.prompt_tokens_details?.cached_tokens ??
      u.input_tokens_details?.cached_tokens
  );
  const cacheWrite = number(u.cache_creation_input_tokens);
  let input = number(u.prompt_tokens ?? u.input_tokens ?? json?.prompt_eval_count);
  // Anthropic comunica separatamente input nuovi, letture e scritture della cache.
  if (input !== null && ('cache_read_input_tokens' in u || 'cache_creation_input_tokens' in u))
    input += (cacheRead || 0) + (cacheWrite || 0);
  const output = number(u.completion_tokens ?? u.output_tokens ?? json?.eval_count);
  return {
    input,
    output,
    total: number(u.total_tokens) ?? sum(input, output),
    cacheRead,
    cacheWrite,
    costUSD: costInUSD ? number(u.cost) : null
  };
}

export function resetTime(value, now = Date.now()) {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)];
  if (parts.length && parts.map((p) => p[0]).join('') === value) {
    const units = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return now + parts.reduce((n, p) => n + Number(p[1]) * units[p[2]], 0);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readLimits(headers, now = Date.now()) {
  const limits = [];
  for (const resource of ['requests', 'tokens', 'input-tokens', 'output-tokens']) {
    for (const prefix of ['x-ratelimit', 'anthropic-ratelimit']) {
      const suffix = (field) =>
        prefix === 'x-ratelimit'
          ? `${prefix}-${field}-${resource}`
          : `${prefix}-${resource}-${field}`;
      const read = (name) => {
        const v = headers.get(name);
        return v !== null && v.trim() !== '' ? number(Number(v)) : null;
      };
      const limit = read(suffix('limit')),
        remaining = read(suffix('remaining'));
      if (limit !== null || remaining !== null)
        limits.push({
          resource,
          limit,
          remaining,
          resetAt: resetTime(headers.get(suffix('reset')), now)
        });
    }
  }
  // Header standard senza nome risorsa, usati ad esempio da OpenRouter sui 429.
  const genericLimit = headers.get('x-ratelimit-limit');
  const genericRemaining = headers.get('x-ratelimit-remaining');
  if (genericLimit !== null || genericRemaining !== null)
    limits.push({
      resource: 'requests',
      limit: genericLimit === null ? null : number(Number(genericLimit)),
      remaining: genericRemaining === null ? null : number(Number(genericRemaining)),
      resetAt: resetTime(headers.get('x-ratelimit-reset'), now)
    });
  const retry = headers.get('retry-after');
  const retryAt =
    retry && /^\d+(\.\d+)?$/.test(retry) ? now + Number(retry) * 1000 : resetTime(retry, now);
  return { limits, retryAt, observedAt: now };
}

export function serviceInfo(config) {
  const url = new URL(config.apiEndpoint);
  const host = url.hostname;
  const known = {
    'api.openai.com': ['OpenAI', 'https://platform.openai.com/usage'],
    'api.anthropic.com': ['Anthropic', 'https://platform.claude.com/usage'],
    'api.groq.com': ['Groq', 'https://console.groq.com/settings/usage'],
    'openrouter.ai': ['OpenRouter', 'https://openrouter.ai/activity'],
    'api.perplexity.ai': ['Perplexity', 'https://www.perplexity.ai/account/api'],
    'ollama.com': ['Ollama Cloud', 'https://ollama.com/settings/usage']
  };
  const ollama =
    config.provider === 'ollama' ||
    (['localhost', '127.0.0.1', '[::1]'].includes(host) && url.port === '11434');
  const cloud = ollama && /(?:-cloud|:cloud)(?:$|:)/i.test(config.model || '');
  const [name, dashboard] =
    known[host] ||
    (ollama
      ? [cloud ? 'Ollama · modello cloud' : 'Ollama', 'https://ollama.com/settings/usage']
      : ['Endpoint custom', null]);
  return {
    name,
    host: url.host,
    dashboard,
    keyQuota: url.origin === 'https://openrouter.ai',
    cloud: host === 'ollama.com' || cloud
  };
}

export async function usageIdentity(config) {
  const info = serviceInfo(config);
  // Separare chiavi/endpoint senza memorizzarli nel registro dei consumi.
  const raw = JSON.stringify([
    config.apiEndpoint,
    config.apiKey || '',
    config.authType || 'auto',
    config.model
  ]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const id = Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
  return { id, ...info, model: String(config.model || '').slice(0, 200) };
}

export const MEASURES = ['input', 'output', 'total', 'cacheRead', 'cacheWrite', 'costUSD'];
export function emptyTotals() {
  return {
    requests: 0,
    errors: 0,
    ...Object.fromEntries(
      MEASURES.flatMap((k) => [
        [k, 0],
        [k + 'Reported', 0]
      ])
    )
  };
}
export function mergeUsage(records, identity, report, now = Date.now()) {
  const cutoff = new Date(now - 29 * 86400000).toISOString().slice(0, 10);
  const date = new Date(now).toISOString().slice(0, 10);
  const kept = records.filter((r) => r.updated >= now - 30 * 86400000);
  const record = kept.find((r) => r.id === identity.id) || { ...identity, days: [] };
  if (!kept.includes(record)) kept.push(record);
  record.days = record.days.filter((d) => d.date >= cutoff);
  let day = record.days.find((d) => d.date === date);
  if (!day) record.days.push((day = { date, ...emptyTotals() }));
  day.requests++;
  if (report.status >= 400 || report.failed) day.errors++;
  for (const k of MEASURES)
    if (number(report.usage[k]) !== null) {
      day[k] += report.usage[k];
      day[k + 'Reported']++;
    }
  record.updated = now;
  record.status = report.status;
  if (report.rates.limits.length || report.rates.retryAt) record.rates = report.rates;
  return kept.sort((a, b) => b.updated - a.updated).slice(0, 200);
}
export function usageTotals(record, days = 30, now = Date.now()) {
  const cutoff = new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10);
  const totals = emptyTotals();
  for (const day of record?.days || [])
    if (day.date >= cutoff) for (const key of Object.keys(totals)) totals[key] += day[key] || 0;
  return totals;
}

export function normalizeKeyQuota(json) {
  const d = json?.data;
  if (!d || !['limit', 'usage', 'limit_remaining'].some((key) => key in d))
    throw new Error('Dati quota non riconosciuti.');
  return {
    limit: number(d.limit),
    unlimited: d.limit === null,
    remaining: number(d.limit_remaining),
    usage: number(d.usage),
    monthly: number(d.usage_monthly),
    reset: typeof d.limit_reset === 'string' ? d.limit_reset.slice(0, 60) : null,
    observedAt: Date.now()
  };
}
