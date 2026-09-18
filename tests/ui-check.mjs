import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.DIGGIO_PLAYWRIGHT || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diggio-ui-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
for (const name of ['manifest.json', 'background', 'shared', 'sidepanel', 'icons'])
  fs.cpSync(path.join(root, name), path.join(extension, name), { recursive: true });
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const requests = [];
let slowStarted = false;
const server = http.createServer(async (req, res) => {
  if (req.url === '/detail') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end('<!doctype html><title>Fonte di dettaglio</title><h1>Risultato nella nuova scheda: indirizzo verificabile</h1>');
    return;
  }
  if (req.url === '/page') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(
      '<!doctype html><html lang="it"><title>Pagina di prova</title><h1>Pagina locale di test</h1><input id="field" value="originale"><input type="password" value="SEGRETO_DI_TEST"><button id="payment" onclick="window.payment=(window.payment||0)+1">Continua al pagamento</button><button id="safe" onclick="document.querySelector(\'h1\').textContent=\'Azione verificata\'">Azione innocua</button><script>document.querySelector(\'#field\').focus()</script></html>'
    );
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') {
    res.end(
      JSON.stringify({
        status: 'success',
        data: {
          models: [
            { name: 'chat-test' },
            { id: 'agent-test' },
            { model: 'slow-test' },
            { id: 'approval-test' },
            { id: 'missing-test' }
          ]
        }
      })
    );
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  let content = 'Risposta di prova: conversazione ricevuta.';
  const actions = body.messages.filter(
    (m) =>
      m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('ACTION:')
  ).length;
  if (body.model === 'tabs-test') {
    const observation = body.messages.find((m) => typeof m.content === 'string' && m.content.includes('Schede aperte:'))?.content;
    const tab = observation?.match(/"tabId":(\d+)/)?.[1];
    content = actions === 0
      ? 'ACTION: open_tabs\nPARAMS: ' + JSON.stringify({ urls: [base + '/detail'] })
      : actions === 1
        ? 'ACTION: switch_tab\nPARAMS: ' + JSON.stringify({ tabId: Number(tab) })
        : actions === 2
          ? 'ACTION: read_page\nPARAMS: {}'
          : 'ACTION: done\nPARAMS: {"message":"Fonte di dettaglio verificata."}';
  }
  if (body.model === 'repair-test') {
    content = body.messages.some((m) => String(m.content).includes('RISPOSTA DA CORREGGERE'))
      ? 'ACTION: done\nPARAMS: {"message":"Report recuperato, senza altre azioni."}'
      : 'Ho letto la pagina locale. Ecco il report da recuperare.';
  }
  if (body.model === 'resume-tabs-test') {
    const start = body.messages.findLastIndex((m) => m.content === 'Riprendi le schede precedenti');
    const current = body.messages.slice(start);
    const count = current.filter((m) => m.role === 'assistant' && String(m.content).startsWith('ACTION:')).length;
    const observation = current.find((m) => m.role === 'user' && String(m.content).startsWith('[OSSERVAZIONE'))?.content;
    const found = observation ? JSON.parse(observation.slice(observation.indexOf('\n') + 1)).find((t) => t.url.endsWith('/detail')) : null;
    content = count === 0 ? 'ACTION: list_tabs\nPARAMS: {}'
      : count === 1 ? 'ACTION: switch_tab\nPARAMS: ' + JSON.stringify({tabId: found?.tabId || -1})
      : 'ACTION: done\nPARAMS: {"message":"Scheda precedente recuperata."}';
  }
  if (body.model === 'budget-test') content = 'ACTION: plan\nPARAMS: {"steps":["Leggere le fonti"]}';
  if (body.model === 'long-test' || body.model === 'steps-test') {
    const calls = requests.filter((r) => r.model === body.model).length;
    content = calls <= 42 ? 'ACTION: plan\nPARAMS: ' + JSON.stringify({steps:['Verifica '+calls]})
      : 'ACTION: done\nPARAMS: {"message":"Completato oltre 40 passaggi."}';
  }
  if (body.model === 'loop-test') content = 'ACTION: get_url\nPARAMS: {}';
  if (body.model === 'typed-test') content = actions
    ? 'ACTION: done\nPARAMS: {"message":"Inserimento verificato."}'
    : 'ACTION: type\nPARAMS: {"selector":"#field","text":"Mese"}';
  if (body.model === 'unlimited-test') content = actions
    ? 'ACTION: done\nPARAMS: {"message":"Completato oltre 80000 token senza soglia locale."}'
    : 'ACTION: plan\nPARAMS: {"steps":["Leggere le fonti"]}';
  if (body.model === 'agent-test')
    content =
      actions === 0
        ? 'THOUGHT: preparo il piano\nACTION: plan\nPARAMS: {"steps":["Osservare gli elementi","Verificare il risultato"],"current":1}'
        : actions === 1
          ? 'THOUGHT: osservo gli elementi\nACTION: mark_page\nPARAMS: {}'
          : 'THOUGHT: verifica finita\nACTION: done\nPARAMS: {"message":"Pagina verificata senza estrarre password."}';
  if (body.model === 'missing-test')
    content =
      actions || body.messages.some((m) => String(m.content).includes('Campo assente'))
        ? 'THOUGHT: campo assente\nACTION: done\nPARAMS: {"message":"Campo non modificato."}'
        : 'THOUGHT: provo un campo\nACTION: type\nPARAMS: {"selector":"#missing","text":"sbagliato"}';
  if (body.model === 'approval-test')
    content = actions
      ? 'THOUGHT: fatto\nACTION: done\nPARAMS: {"message":"Azione completata."}'
      : 'THOUGHT: azione proposta\nACTION: click\nPARAMS: {"selector":"#safe"}';
  if (body.model === 'condition-test')
    content =
      'THOUGHT: condizione osservata\nACTION: done\nPARAMS: {"message":"Valore osservato: 10 euro.","condition_met":true,"evidence":"La fixture locale fornisce il valore 10 euro."}';
  if (body.model === 'slow-test') {
    slowStarted = true;
    await new Promise((r) => setTimeout(r, 1800));
    content = 'THOUGHT: prossimo click\nACTION: click\nPARAMS: {"selector":"#safe"}';
  }
  res.setHeader('x-ratelimit-limit-requests', '100');
  res.setHeader('x-ratelimit-remaining-requests', '99');
  res.setHeader('x-ratelimit-reset-requests', '1m');
  res.end(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: body.model === 'unlimited-test'
        ? { total_tokens: 85000, prompt_tokens: 84000, completion_tokens: 1000 }
        : body.model === 'budget-test'
        ? { total_tokens: 1100, prompt_tokens: 1000, completion_tokens: 100 }
        : { total_tokens: 120, prompt_tokens: 80, completion_tokens: 40 }
    })
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 390, height: 844 }
  });
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extensionId = sw.url().split('/')[2];
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`);
  await page.waitForFunction(
    () => document.querySelector('#footerVersion').textContent === 'v2.2.5'
  );
  assert.equal(await page.locator('#setupNotice').isVisible(), true);
  assert.match(await page.textContent('#modeHint'), /non legge né controlla/);
  await page.fill('#taskInput', 'Cerca una pagina di prova');
  await page.click('#btnUseAgent');
  assert.equal(await page.inputValue('#modeSelect'), 'ask_first');
  assert.equal(await page.inputValue('#taskInput'), 'Cerca una pagina di prova');
  assert.match(await page.textContent('#modeHint'), /conferma prima di ogni comando/);
  assert.equal(requests.length, 0, 'Cambiare modalità non invia richieste');
  await page.selectOption('#modeSelect', 'chat');
  await page.fill('#taskInput', '');
  await page.click('#btnSetupProvider');
  assert.equal(await page.locator('#settingsPanel').isVisible(), true);
  await page.locator('#settingsPanel .drawer-close').click();
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [600, 900]
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `overflow ${width}`
    );
    assert.equal(await page.locator('#btnStart').isVisible(), true);
    const author = page.locator('.footer-author a');
    assert.equal(await author.getAttribute('href'), 'https://www.diggio3000.it');
    const box = await author.boundingBox();
    assert.ok(box.y + box.height <= height, 'Firma sempre visibile');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'home-light.png') });
  await page.click('#btnTheme');
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'home-dark.png') });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.click('#btnTheme');
  await page.click('#btnSettings');
  await page.selectOption('#providerSelect', 'custom');
  await page.fill('#apiEndpoint', base + '/gateway.php');
  await page.click('#btnLoadModels');
  await page.waitForFunction(() =>
    document.querySelector('#modelLoadStatus').textContent.includes('5 modelli')
  );
  await page.selectOption('#modelSelect', 'chat-test');
  assert.equal(await page.inputValue('#tokenBudget'), '');
  await page.click('#btnSaveSettings');
  await page.waitForFunction(() =>
    document.querySelector('#testResult').textContent.includes('Connessione riuscita')
  );
  assert.equal(await page.locator('#setupNotice').isVisible(), false);
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('tokenBudget')).tokenBudget), 0);
  await page.locator('#tokenBudget').evaluate((el) => { el.closest('details').open = true; });
  for (const [value, expected] of [['120000', 120000], ['', 0], ['0', 0]]) {
    await page.fill('#tokenBudget', value);
    await page.click('#btnSaveOnly');
    await page.waitForFunction(async (expected) => (await chrome.storage.local.get('tokenBudget')).tokenBudget === expected, expected);
  }
  await page.reload();
  await page.click('#btnSettings');
  assert.equal(await page.inputValue('#tokenBudget'), '', 'La soglia cancellata resta disattivata dopo riapertura');
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'custom-settings.png') });
  await page.locator('#settingsPanel .drawer-close').click();
  await page.fill('#taskInput', 'Primo messaggio di prova');
  await page.press('#taskInput', 'Enter');
  await page.waitForFunction(
    () => !document.querySelector('#btnStart').disabled && document.querySelector('.message.done')
  );
  const state = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
  assert.equal(state.state.running, false);
  assert.ok(state.state.messages.some((m) => m.type === 'done'));
  await page.fill('#taskInput', 'Secondo messaggio');
  await page.click('#btnStart');
  await page.waitForFunction(
    () =>
      !document.querySelector('#btnStart').disabled &&
      document.querySelectorAll('.message.done').length === 2
  );
  assert.ok(requests.at(-1).messages.some((m) => m.content === 'Primo messaggio di prova'));
  await page.click('#btnUsage');
  await page.waitForFunction(() =>
    document.querySelector('#usageLocal').textContent.includes('360')
  );
  assert.match(await page.locator('#usageLocal').textContent(), /240/);
  assert.match(await page.locator('#usageLimits').textContent(), /99 \/ 100/);
  assert.equal(await page.locator('#btnRefreshQuota').isVisible(), false);
  assert.match(await page.textContent('#usageBudget'), /disattivato/);
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'usage-light.png') });
  await page.click('#btnTheme');
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'usage-dark.png') });
  await page.click('#btnTheme');
  await page.locator('#usagePanel .drawer-close').click();
  await page.click('#btnClearChat');
  await page.click('#btnHistory');
  assert.ok(await page.locator('.history-open').count());
  await page.locator('.history-open').first().click();
  assert.equal(await page.locator('.message.done').count(), 2);
  const downloadPromise = page.waitForEvent('download');
  await page.click('#btnExportCSV');
  await page.click('[data-export="html"]');
  const download = await downloadPromise;
  await download.saveAs(path.join(output, 'report.html'));
  const target = await context.newPage();
  await target.goto(base + '/page');
  const tabId = await page.evaluate(
    async (base) => (await chrome.tabs.query({})).find((t) => t.url === base + '/page').id,
    base
  );
  const finished = async () => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const r = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
      if (!r.state.running) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      'Attività non terminata: ' +
        JSON.stringify(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' })))
    );
  };
  const run = async (model, mode = 'auto') => {
    await page.evaluate(
      async ({ model, tabId, base, mode }) => {
        await chrome.runtime.sendMessage({ type: 'NEW_CONVERSATION', mode });
        await chrome.storage.local.set({
          apiEndpoint: base + '/gateway.php',
          model,
          vision: 'off',
          nativeTools: false,
          tokenBudget: model === 'budget-test' ? 1000 : 0,
          maxSteps: model === 'steps-test' ? 2 : 0
        });
        const r = await chrome.runtime.sendMessage({
          type: 'START_AGENT',
          task: 'Prova locale autorizzata',
          mode,
          tabId
        });
        if (r.error) throw new Error(r.error);
      },
      { model, tabId, base, mode }
    );
  };
  await run('agent-test');
  await finished();
  assert.ok(
    (
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }))
    ).state.messages.some((m) => m.type === 'done' && m.text.includes('Pagina verificata'))
  );
  assert.ok(
    !requests
      .filter((r) => r.model === 'agent-test')
      .some((r) => JSON.stringify(r).includes('SEGRETO_DI_TEST'))
  );
  assert.equal(
    await target.evaluate(() => (typeof window.payment === 'number' ? window.payment : 0)),
    0
  );
  await run('missing-test');
  await finished();
  assert.equal(await target.inputValue('#field'), 'originale');
  await run('tabs-test');
  await finished();
  const tabRequests = requests.filter((r) => r.model === 'tabs-test');
  assert.equal(tabRequests.length, 4);
  const lastTabRequest = tabRequests.at(-1).messages.at(-1).content;
  assert.ok(lastTabRequest.includes('Risultato nella nuova scheda'));
  assert.ok(lastTabRequest.includes('/detail'));
  assert.equal(await target.textContent('h1'), 'Pagina locale di test');
  const previousTab = (await page.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}))).state.tabId;
  await page.reload();
  await page.evaluate(async (tabId) => {
    await chrome.storage.local.set({model: 'resume-tabs-test'});
    await chrome.runtime.sendMessage({type: 'START_AGENT', task: 'Riprendi le schede precedenti', mode: 'auto', tabId});
  }, tabId);
  await finished();
  const resumed = (await page.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}))).state;
  assert.equal(resumed.tabId, previousTab);
  assert.ok(resumed.messages.some((m) => m.type === 'done' && m.text.includes('Scheda precedente recuperata')));
  assert.ok(requests.filter((r) => r.model === 'resume-tabs-test').at(-1).messages.at(-1).content.includes('Risultato nella nuova scheda'));
  await run('repair-test');
  await finished();
  const repairRequests = requests.filter((r) => r.model === 'repair-test');
  assert.equal(repairRequests.length, 2);
  assert.ok(JSON.stringify(repairRequests[1]).includes('Ecco il report da recuperare'));
  const repairState = (await page.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}))).state;
  assert.ok(repairState.messages.some((m) => m.type === 'done' && m.text.includes('Report recuperato')));
  await run('budget-test');
  await finished();
  assert.equal(requests.filter((r) => r.model === 'budget-test').length, 1);
  const budgetState = (await page.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}))).state;
  assert.ok(budgetState.messages.some((m) => m.type === 'error' && m.text.includes('Budget locale') && m.text.includes('Non indica crediti')));
  assert.ok(!budgetState.messages.some((m) => m.type === 'done'));
  await run('unlimited-test');
  await finished();
  assert.equal(requests.filter((r) => r.model === 'unlimited-test').length, 2);
  const unlimitedState = (await page.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}))).state;
  assert.equal(unlimitedState.tokens, 170000);
  assert.ok(unlimitedState.messages.some((m) => m.type === 'done'));
  assert.ok(!unlimitedState.messages.some((m) => m.type === 'error'));
  await run('long-test'); await finished();
  const longState = (await page.evaluate(() => chrome.runtime.sendMessage({type:'GET_STATE'}))).state;
  assert.equal(longState.step, 43);
  assert.ok(longState.messages.some((m) => m.type === 'done'));
  await run('steps-test'); await finished();
  const limitedState = (await page.evaluate(() => chrome.runtime.sendMessage({type:'GET_STATE'}))).state;
  assert.equal(limitedState.step, 2);
  assert.ok(limitedState.messages.some((m) => m.type === 'error' && m.text.includes('Limite passaggi')));
  await run('loop-test');
  await page.waitForSelector('#questionText:not([hidden])');
  const loopState = (await page.evaluate(() => chrome.runtime.sendMessage({type:'GET_STATE'}))).state;
  assert.ok(loopState.pending?.question, JSON.stringify({running:loopState.running,messages:loopState.messages.slice(-4)}));
  assert.match(loopState.pending.question, /senza avanzare/);
  await page.evaluate(() => chrome.runtime.sendMessage({type:'STOP_AGENT'})); await finished();
  await run('typed-test'); await finished();
  assert.equal(await target.inputValue('#field'), 'Mese');
  assert.ok(requests.filter((r) => r.model === 'typed-test').at(-1).messages.some((m) => m.role === 'assistant' && String(m.content).includes('Mese')));
  const savedHistory = await page.evaluate(async () => (await chrome.storage.session.get('conversation')).conversation);
  assert.equal(savedHistory.find((m) => m.action === 'type').params.text, '[contenuto omesso]');
  await target.reload();
  await run('approval-test', 'ask_first');
  await page.waitForSelector('#approvalBar:not(.hidden)', { timeout: 15000 });
  assert.equal(await target.textContent('h1'), 'Pagina locale di test');
  await page.reload();
  await page.waitForSelector('#approvalBar:not(.hidden)');
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'approval.png') });
  await page.click('#btnApprove');
  await finished();
  assert.equal(await target.textContent('h1'), 'Azione verificata');
  await target.reload();
  await run('slow-test');
  while (!slowStarted) await new Promise((r) => setTimeout(r, 20));
  await page.evaluate(async () => {
    const a = {
      id: 9100,
      name: 'Retry mentre occupato',
      task: 'Test del timer',
      scheduleType: 'interval',
      intervalMinutes: 60,
      maxRuns: 1,
      runsCount: 0,
      active: true
    };
    await chrome.runtime.sendMessage({ type: 'SAVE_AUTOMATION', automation: a });
    await chrome.alarms.create('automation_9100', { when: Date.now() + 50, periodInMinutes: 60 });
  });
  let retry;
  for (let i = 0; i < 30; i++) {
    retry = await page.evaluate(() => chrome.alarms.get('retry_9100'));
    if (retry) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.ok(retry, 'L’allarme occupato deve creare un retry separato');
  assert.equal(
    await page.evaluate(async () => (await chrome.alarms.get('automation_9100')).periodInMinutes),
    60
  );
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'DELETE_AUTOMATION', id: 9100 }));
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STOP_AGENT' }));
  await finished();
  await new Promise((r) => setTimeout(r, 1900));
  assert.equal(await target.textContent('h1'), 'Pagina locale di test');
  // Save an automation with a snapshot of its generic connection and stop condition.
  const previousConversation = (
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }))
  ).state.conversationId;
  await page.evaluate(async (base) => {
    await chrome.storage.local.set({ apiEndpoint: base + '/gateway.php', model: 'condition-test' });
    const automation = {
      id: 9001,
      name: 'Condizione di prova',
      task: 'Controlla il valore della fixture',
      scheduleType: 'interval',
      intervalMinutes: 60,
      maxRuns: 0,
      runsCount: 0,
      active: true,
      stopCondition: 'Il valore osservato è minore di 20 euro'
    };
    const saved = await chrome.runtime.sendMessage({ type: 'SAVE_AUTOMATION', automation });
    if (saved.error) throw new Error(saved.error);
    const started = await chrome.runtime.sendMessage({ type: 'RUN_AUTOMATION_NOW', id: 9001 });
    if (started.error) throw new Error(started.error);
  }, base);
  await finished();
  const automated = await page.evaluate(async () => ({
    a: (await chrome.storage.local.get('automations')).automations[0],
    alarm: await chrome.alarms.get('automation_9001'),
    state: (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).state
  }));
  assert.equal(automated.a.active, false);
  assert.equal(automated.alarm, undefined);
  assert.ok(automated.a.lastSession);
  assert.equal(automated.state.conversationId, previousConversation);
  assert.ok(
    requests
      .filter((r) => r.model === 'condition-test')
      .some((r) => JSON.stringify(r).includes('minore di 20 euro'))
  );
  // Quota reale del connettore, risposta simulata: nessuna credenziale o chiamata a pagamento.
  await page.route('https://openrouter.ai/api/v1/key', (route) =>
    route.fulfill({
      json: {
        data: { limit: 10, limit_remaining: 4, usage: 6, usage_monthly: 2, limit_reset: 'monthly' }
      }
    })
  );
  await page.evaluate(() =>
    chrome.storage.local.set({
      provider: 'openrouter',
      apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'chiave-simulata',
      model: 'model-test'
    })
  );
  await page.click('#btnUsage');
  await page.waitForFunction(() =>
    [...document.querySelector('#usageConnection').options].some((o) =>
      o.text.includes('OpenRouter')
    )
  );
  const activeQuotaId = await page.evaluate(
    () =>
      [...document.querySelector('#usageConnection').options].find((o) =>
        o.text.includes('OpenRouter')
      ).value
  );
  await page.selectOption('#usageConnection', activeQuotaId);
  await page.click('#btnRefreshQuota');
  await page.waitForFunction(() =>
    document.querySelector('#usageAccount').textContent.includes('Residuo del limite chiave')
  );
  assert.match(await page.locator('#usageAccount').textContent(), /non è il saldo/);
  await page.selectOption('#usagePeriod', '1');
  assert.match(await page.locator('#usageLocal').textContent(), /Non disponibile/);
  await page.evaluate(() =>
    chrome.storage.local.set({
      provider: 'ollama',
      apiEndpoint: 'http://localhost:11434/v1/chat/completions',
      apiKey: '',
      model: 'example-cloud'
    })
  );
  await page.waitForFunction(() =>
    [...document.querySelector('#usageConnection').options].some((o) =>
      o.text.includes('example-cloud')
    )
  );
  const cloudId = await page.evaluate(
    () =>
      [...document.querySelector('#usageConnection').options].find((o) =>
        o.text.includes('example-cloud')
      ).value
  );
  await page.selectOption('#usageConnection', cloudId);
  assert.equal(await page.locator('#btnRefreshQuota').isVisible(), false);
  assert.equal(
    await page.locator('#usageDashboard').getAttribute('href'),
    'https://ollama.com/settings/usage'
  );
  assert.match(await page.locator('#usageAccount').textContent(), /residuo, piano e rinnovo/);
  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#setupNotice').hidden);
  assert.deepEqual(errors, []);
  console.log(
    'OK: avviso iniziale, firma, consumi e limiti, quota OpenRouter simulata, Ollama cloud, layout, temi, endpoint PHP generico, modelli, chat e memoria, cronologia, export, password, popup, focus, approvazione dopo riapertura, Stop, retry periodico e condizione di arresto automazioni.'
  );
  console.log('Screenshot:', output);
} finally {
  await context?.close();
  server.close();
  if (
    path.dirname(temporary) === path.resolve(os.tmpdir()) &&
    path.basename(temporary).startsWith('diggio-ui-')
  )
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
