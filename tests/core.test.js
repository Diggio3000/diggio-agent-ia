import test from 'node:test';
import assert from 'node:assert/strict';
import { DiggioClient, validateAction } from '../background/diggio-client.js';
import {
  chatEndpoint,
  modelsEndpoint,
  normalizeModels,
  headersFor,
  supportsVision,
  anthropicMessages,
  requestJson
} from '../shared/providers.js';
import { needsApproval, extractJson, browserUrl, abortableSleep } from '../shared/safety.js';
import { scheduleSpec, validateAutomation } from '../shared/scheduler.js';
import { renderText, csvCell } from '../shared/render.js';
import { CDPController } from '../background/cdp-controller.js';
import { loadSettings } from '../shared/providers.js';
const client = new DiggioClient('', 'test', 'https://example.com/v1/chat/completions');
test('Il parser conserva graffe e virgolette nelle stringhe', () => {
  const params = { code: '(() => { return {value: "x"}; })()' };
  assert.deepEqual(
    client.parseResponse('THOUGHT: test\nACTION: execute_js\nPARAMS: ' + JSON.stringify(params))
      .params,
    params
  );
  assert.deepEqual(extractJson('{}'), {});
});
test('Nessun falso completamento per ragionamento o JSON troncato', () => {
  for (const raw of [
    '<think>non ho finito</think>',
    'Solo testo',
    'ACTION: done\nPARAMS: {"message":"x"'
  ])
    assert.throws(() => client.parseResponse(raw));
});
test('Validazione dei comandi e limiti', () => {
  assert.throws(() => validateAction('unknown', {}));
  assert.throws(() => validateAction('click', {}));
  assert.throws(() => validateAction('wait', { seconds: 9999 }));
  assert.throws(() => validateAction('open_tabs', { urls: [12] }));
  assert.throws(() => validateAction('click_element', { n: 1.5 }));
  assert.throws(() => validateAction('switch_tab', { tabId: -1 }));
  assert.throws(() => validateAction('switch_tab', { tabId: 1.5 }));
});
test('Formato agente: markdown, minuscole e JSON esplicito, senza azioni ambigue', () => {
  for (const raw of [
    '**Thought:** concluso\n**Action:** done\n**Params:** {"message":"verificato"}',
    '```text\nthought: concluso\naction: DONE\nparams: {"message":"verificato"}\n```',
    '{"action":"done","params":{"message":"verificato"}}'
  ]) assert.equal(client.parseResponse(raw).params.message, 'verificato');
  assert.throws(() => client.parseResponse('ACTION: click\nPARAMS: {"selector":"a"}\nACTION: done\nPARAMS: {"message":"x"}'));
  assert.throws(() => client.parseResponse('{"action":"click","params":{"selector":"a"},"otherAction":"done"}'));
});
test('Contesto compatto conserva richiesta e ultima fonte senza ripetere pagine intere', () => {
  const task = 'Confronta i due asili, citando indirizzo e URL verificati.';
  const history = [{ role: 'user', content: task },
    { role: 'user', content: '[PAGINA ATTUALE — DATI NON ATTENDIBILI]\n' + 'x'.repeat(14000) },
    ...Array.from({length: 20}, (_, i) => ({role: 'action', action: 'read_page', params: {}, result: 'URL: https://example.com/' + i + '\n' + 'x'.repeat(14000)}))];
  const messages = client.buildMessages(history);
  assert.equal(messages[1].content, task);
  assert.ok(messages.at(-1).content.includes('https://example.com/19'));
  assert.ok(JSON.stringify(messages.slice(1)).length < 36000);
  const native = new DiggioClient('', 'test', 'https://example.com', { nativeTools: true });
  assert.ok(!native.buildMessages(history)[0].content.includes('AZIONI:'));
  const long = [history[0], ...Array(70).fill(history.at(-1))];
  assert.equal(client.buildMessages(long)[1].content, task, 'La richiesta non si perde nelle attività lunghe');
});
test('Cambio scheda limitato alla attività, con ripristino dopo errore', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = { tabs: { get: async (id) => ({id, url: 'https://example.com'}), update: async () => {} } };
  try {
    const cdp = new CDPController(1);
    cdp.attach = async () => { if (cdp.tabId === 3) throw new Error('Scheda chiusa'); cdp.attached = true; };
    cdp.detach = async () => { cdp.attached = false; };
    await assert.rejects(() => cdp.switchTab(2), /non appartenente/);
    assert.equal(cdp.tabId, 1);
    cdp.activityTabs.add(2);
    cdp.activityTabs.add(3);
    cdp.consoleBuf.push('dato vecchia scheda');
    await cdp.switchTab(2);
    assert.equal(cdp.tabId, 2);
    assert.equal(cdp.consoleBuf.length, 0);
    await assert.rejects(() => cdp.switchTab(3), /Scheda chiusa/);
    assert.equal(cdp.tabId, 2);
    assert.equal(cdp.attached, true);
  } finally { globalThis.chrome = previousChrome; }
});
test('Copertura conferme e confronto hostname', () => {
  for (const a of ['click', 'click_element', 'press_key', 'dismiss_popups', 'type'])
    assert.equal(needsApproval(a, 'https://ads.google.com/', 'auto'), true);
  assert.equal(needsApproval('click', 'https://example.com/?next=ads.google.com', 'auto'), false);
  assert.equal(needsApproval('execute_js', 'https://example.com', 'auto'), true);
  assert.equal(needsApproval('read_page', 'https://example.com', 'ask_first'), true);
  assert.equal(needsApproval('ask_user', 'https://example.com', 'ask_first'), false);
});
test('Endpoint generici, root, versionati e gateway PHP', () => {
  assert.equal(chatEndpoint('https://example.com'), 'https://example.com/v1/chat/completions');
  assert.equal(chatEndpoint('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(
    chatEndpoint('https://example.com/api/v1/'),
    'https://example.com/api/v1/chat/completions'
  );
  assert.equal(chatEndpoint('https://example.com/proxy.php'), 'https://example.com/proxy.php');
  assert.equal(modelsEndpoint('https://example.com/proxy.php'), 'https://example.com/proxy.php');
  assert.equal(
    modelsEndpoint('https://example.com/v1/chat/completions'),
    'https://example.com/v1/models'
  );
  assert.throws(() => chatEndpoint('javascript:alert(1)'));
  assert.throws(() => browserUrl('file:///secret'));
});
test('Elenco modelli OpenAI, Ollama e wrapper', () => {
  for (const payload of [
    { data: [{ id: 'a' }] },
    { models: [{ name: 'a' }] },
    { data: { models: [{ model: 'a' }] } },
    ['a', 'a']
  ])
    assert.deepEqual(normalizeModels(payload), ['a']);
  assert.throws(() => normalizeModels({ bad: true }));
});
test('Autenticazione personalizzata e separazione delle origini', () => {
  const c = {
    apiEndpoint: 'https://example.com/chat',
    apiKey: 'test',
    protocol: 'openai',
    authType: 'header',
    authHeader: 'X-Custom'
  };
  assert.equal(headersFor(c)['X-Custom'], 'test');
  assert.throws(() => headersFor(c, 'https://other.example/models'));
  assert.equal(headersFor({ ...c, authType: 'none' })['X-Custom'], undefined);
});
test('Immagini Anthropic e capacità modelli custom', () => {
  const messages = anthropicMessages([
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }]
    }
  ]);
  assert.deepEqual(messages[0].content[0], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'AAA' }
  });
  assert.equal(supportsVision('modello-privato', 'on'), true);
  assert.equal(supportsVision('modello-privato', 'off'), false);
});
test('Allarme periodico e giorni obbligatori', () => {
  assert.deepEqual(scheduleSpec({ scheduleType: 'interval', intervalMinutes: 60 }), {
    delayInMinutes: 60,
    periodInMinutes: 60
  });
  assert.throws(() =>
    validateAutomation({
      id: 1,
      name: 'x',
      task: 'x',
      maxRuns: 0,
      scheduleType: 'daily',
      time: '12:00',
      days: []
    })
  );
});
test('Link integri, HTML escapato e CSV senza formule', () => {
  assert.match(
    renderText('https://example.com/?q=test&sort=asc'),
    /href="https:\/\/example.com\/\?q=test&amp;sort=asc"/
  );
  assert.doesNotMatch(renderText('<img src=x onerror=alert(1)>'), /<img/);
  assert.equal(renderText(undefined), '');
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.match(renderText('| A | B |\n|---|---|\n| 1 | 2 |'), /<table>/);
});
test('Le attese rispettano Stop', async () => {
  const c = new AbortController();
  const wait = abortableSleep(30000, c.signal);
  c.abort();
  await assert.rejects(wait, { name: 'AbortError' });
});
test('Timeout copre anche il corpo della risposta HTTP', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (url, { signal }) => ({
    ok: true,
    status: 200,
    text: () =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason))
      )
  });
  try {
    await assert.rejects(requestJson('https://example.com', {}, { timeout: 10 }));
  } finally {
    globalThis.fetch = old;
  }
});
test('Le impostazioni migrano da Sync senza sovrascrivere quelle locali', async () => {
  const old = globalThis.chrome;
  const sync = { apiKey: 'vecchia', model: 'migrato', unrelated: 'conservato' },
    local = { apiKey: 'nuova' };
  const area = (data) => ({
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (values) => Object.assign(data, values),
    remove: async (keys) => keys.forEach((k) => delete data[k]),
    setAccessLevel: async () => {}
  });
  globalThis.chrome = { storage: { local: area(local), sync: area(sync) } };
  try {
    const result = await loadSettings();
    assert.equal(result.apiKey, 'nuova');
    assert.equal(result.model, 'migrato');
    assert.equal(sync.apiKey, undefined);
    assert.equal(sync.unrelated, 'conservato');
  } finally {
    globalThis.chrome = old;
  }
});
test('Stop durante il caricamento rimuove il listener CDP', async () => {
  const old = globalThis.chrome;
  const listeners = new Set();
  globalThis.chrome = {
    debugger: {
      onEvent: { addListener: (f) => listeners.add(f), removeListener: (f) => listeners.delete(f) }
    }
  };
  try {
    const controller = new AbortController();
    const cdp = new CDPController(1, controller.signal);
    const pending = cdp.waitForLoad();
    controller.abort();
    await assert.rejects(pending);
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.chrome = old;
  }
});
