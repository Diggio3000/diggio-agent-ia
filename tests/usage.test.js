import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsage,
  readLimits,
  resetTime,
  usageIdentity,
  mergeUsage,
  usageTotals,
  serviceInfo,
  normalizeKeyQuota
} from '../shared/usage.js';
import { DiggioClient } from '../background/diggio-client.js';
import { recordUsage } from '../background/usage-store.js';

test('Token ignoti distinti da zero, cache OpenAI inclusa una sola volta', () => {
  assert.equal(normalizeUsage({}).total, null);
  assert.equal(normalizeUsage({ usage: { total_tokens: 0 } }).total, 0);
  const u = normalizeUsage({
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 80 },
      cost: 0.5
    }
  });
  assert.equal(u.total, 120);
  assert.equal(u.input, 100);
  assert.equal(u.cacheRead, 80);
  assert.equal(u.costUSD, null);
  assert.equal(normalizeUsage({ usage: { total_tokens: '42' } }).total, null);
  assert.equal(normalizeUsage({ usage: { total_tokens: -1 } }).total, null);
});
test('Conteggi Anthropic con cache e Ollama nativo/cloud', () => {
  const u = normalizeUsage({
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 20,
      output_tokens: 30
    }
  });
  assert.equal(u.input, 110);
  assert.equal(u.total, 140);
  assert.equal(normalizeUsage({ prompt_eval_count: 12, eval_count: 8 }).total, 20);
  assert.equal(
    normalizeUsage({ usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } }).total,
    10
  );
  assert.equal(normalizeUsage({ usage: { cost: 0 } }, true).costUSD, 0);
});
test('Limiti residui zero, ripristino e retry-after su risposte 429', () => {
  const now = Date.parse('2026-09-16T12:00:00Z');
  const rates = readLimits(
    new Headers({
      'x-ratelimit-limit-requests': '20',
      'x-ratelimit-remaining-requests': '0',
      'x-ratelimit-reset-requests': '1m2.5s',
      'retry-after': '10'
    }),
    now
  );
  assert.deepEqual(rates.limits[0], {
    resource: 'requests',
    limit: 20,
    remaining: 0,
    resetAt: now + 62500
  });
  assert.equal(rates.retryAt, now + 10000);
  assert.equal(readLimits(new Headers()).limits.length, 0);
  assert.equal(resetTime('2026-09-16T12:30:00Z'), now + 1800000);
  assert.equal(resetTime('1789560000'), 1789560000000);
  const a = readLimits(
    new Headers({
      'anthropic-ratelimit-input-tokens-limit': '100',
      'anthropic-ratelimit-input-tokens-remaining': '25'
    })
  );
  assert.equal(a.limits[0].remaining, 25);
  const r = readLimits(new Headers({ 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '0' }));
  assert.equal(r.limits[0].remaining, 0);
});
test('Connessioni e chiavi separate; nessun segreto o URL completo nel registro', async () => {
  const cfg = {
    apiEndpoint: 'https://example.com/api?token=SEGRETO',
    apiKey: 'CHIAVE1',
    model: 'test'
  };
  const one = await usageIdentity(cfg);
  assert.notEqual(one.id, (await usageIdentity({ ...cfg, apiKey: 'CHIAVE2' })).id);
  assert.doesNotMatch(JSON.stringify(one), /SEGRETO|CHIAVE|\?token/);
  assert.equal(
    serviceInfo({ apiEndpoint: 'http://localhost:11434/v1/chat/completions', model: 'test-cloud' })
      .cloud,
    true
  );
  assert.equal(
    serviceInfo({ apiEndpoint: 'https://openrouter.ai.evil.test', model: 'x' }).keyQuota,
    false
  );
  assert.equal(serviceInfo({ apiEndpoint: 'http://openrouter.ai', model: 'x' }).keyQuota, false);
});
test('Registro aggregato UTC, copertura parziale e conservazione di 30 giorni', () => {
  const now = Date.parse('2026-09-16T12:00:00Z');
  const id = { id: 'x', name: 'Test', model: 'x' };
  const report = {
    usage: normalizeUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    rates: readLimits(new Headers(), now),
    status: 200
  };
  let records = mergeUsage([], id, report, now - 30 * 86400000);
  records = mergeUsage(records, id, report, now - 86400000);
  records = mergeUsage(records, id, { ...report, usage: normalizeUsage({}), status: 429 }, now);
  const t = usageTotals(records[0], 30, now);
  assert.equal(t.requests, 2);
  assert.equal(t.total, 15);
  assert.equal(t.totalReported, 1);
  assert.equal(t.errors, 1);
  assert.equal(usageTotals(records[0], 1, now).requests, 1);
});
test('Quota OpenRouter: tetto chiave nullo non è saldo infinito', () => {
  const q = normalizeKeyQuota({
    data: { limit: null, limit_remaining: null, usage: 12, usage_monthly: 2 }
  });
  assert.equal(q.unlimited, true);
  assert.equal(q.remaining, null);
  assert.equal(q.monthly, 2);
  assert.equal(normalizeKeyQuota({ data: { limit: 10, limit_remaining: 0 } }).remaining, 0);
  assert.throws(() => normalizeKeyQuota({ data: {} }));
});
test('Il client registra una risposta fallita e i limiti anche se non JSON', async () => {
  const old = globalThis.fetch;
  const reports = [];
  globalThis.fetch = async () =>
    new Response('Rate limited', {
      status: 429,
      headers: { 'retry-after': '60', 'x-ratelimit-remaining-requests': '0' }
    });
  try {
    const c = new DiggioClient('', 'x', 'https://example.com', { onUsage: (r) => reports.push(r) });
    await assert.rejects(c.chat([{ role: 'user', content: 'Test' }]), { status: 429 });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].usage.total, null);
    assert.equal(reports[0].rates.limits[0].remaining, 0);
    assert.equal(reports[0].failed, true);
    assert.equal('json' in reports[0], false);
  } finally {
    globalThis.fetch = old;
  }
});
test('Il client conta una risposta fatturata anche se l’azione non è valida', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'formato non valido' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 }
      })
    );
  const reports = [];
  try {
    const c = new DiggioClient('', 'x', 'https://example.com', { onUsage: (r) => reports.push(r) });
    await assert.rejects(c.think([]));
    assert.equal(c.usage, 30);
    assert.equal(reports.length, 1);
  } finally {
    globalThis.fetch = old;
  }
});
test('Scritture concorrenti da chat e test non perdono consumi', async () => {
  const old = globalThis.chrome;
  let data = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => structuredClone(data),
        set: async (v) => {
          data = structuredClone(v);
        }
      }
    }
  };
  try {
    const cfg = { apiEndpoint: 'https://example.com', model: 'x' };
    const report = {
      usage: normalizeUsage({ usage: { total_tokens: 10 } }),
      rates: readLimits(new Headers()),
      status: 200
    };
    await Promise.all(Array.from({ length: 10 }, () => recordUsage(cfg, report)));
    assert.equal(usageTotals(data.providerUsage[0]).requests, 10);
    assert.equal(usageTotals(data.providerUsage[0]).total, 100);
  } finally {
    globalThis.chrome = old;
  }
});
