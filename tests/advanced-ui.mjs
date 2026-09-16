import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.DIGGIO_PLAYWRIGHT || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diggio-advanced-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
for (const name of ['manifest.json', 'background', 'shared', 'sidepanel', 'icons'])
  fs.cpSync(path.join(root, name), path.join(extension, name), { recursive: true });
const requests = [];
const fixture = `<!doctype html><html lang="it"><title>Dimostrazione</title><style>button,input{padding:10px;margin:5px}#far{margin-top:1200px}</style><body>
<h1>Area test</h1><input id="field" aria-label="Nome del progetto"><input id="password" type="password" value="PASSWORD_PRIVATA"><button id="safe" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Verifica</button>
<button class="duplicate">Duplica</button><button class="duplicate">Duplica</button><button aria-label="Apri menu" id="aria" onclick="this.dataset.clicked='yes'">☰</button>
<select id="choice"><option value="a">Prima</option><option value="b">Seconda</option></select><a id="next" href="/next?token=URL_PRIVATO">Prosegui</a><div id="shadow"></div><button id="far" onclick="this.dataset.clicked='yes'">Lontano</button>
<script>const sr=document.querySelector('#shadow').attachShadow({mode:'open'});sr.innerHTML='<label for="search">Cerca elemento</label><input id="search"><button id="inside">Apri dettaglio</button>';sr.querySelector('#inside').onclick=(e)=>e.target.dataset.clicked='yes';</script></body></html>`;
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let raw = '';
    for await (const part of req) raw += part;
    requests.push(JSON.parse(raw));
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                'Procedura di ricerca\n1. Apri il sito indicato.\n2. Cerca {{prodotto}}.\n3. Verifica il titolo del risultato.'
            }
          }
        ],
        usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 }
      })
    );
  } else {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(fixture);
  }
});
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
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
  await page.waitForFunction(() => document.querySelector('#footerVersion').textContent);
  const target = await context.newPage();
  await target.goto(base + '/page');
  const tabId = await sw.evaluate(
    async (base) => (await chrome.tabs.query({})).find((t) => t.url === base + '/page').id,
    base
  );
  const call = (method, args = [], timeout = 0) =>
    page.evaluate(
      async ({ tabId, method, args, timeout }) => {
        const { CDPController } = await import(
          chrome.runtime.getURL('background/cdp-controller.js')
        );
        const ac = new AbortController(),
          c = new CDPController(tabId, ac.signal);
        let timer;
        try {
          await c.attach();
          if (timeout) timer = setTimeout(() => ac.abort(), timeout);
          return { value: await c[method](...args) };
        } catch (e) {
          return { error: e.message, name: e.name };
        } finally {
          clearTimeout(timer);
          await c.detach();
        }
      },
      { tabId, method, args, timeout }
    );
  assert.equal((await call('clickByText', ['Apri menu'])).error, undefined);
  assert.equal(await target.locator('#aria').getAttribute('data-clicked'), 'yes');
  assert.match((await call('click', ['.duplicate'])).error, /ambiguo/);
  assert.match((await call('clickByText', ['Duplica'])).error, /ambiguo/);
  assert.equal((await call('click', ['#far'])).error, undefined);
  assert.equal(await target.locator('#far').getAttribute('data-clicked'), 'yes');
  assert.equal(
    (await call('typeText', ['#shadow >>> #search', 'ricerca verificata'])).error,
    undefined
  );
  assert.equal(await target.locator('#shadow #search').inputValue(), 'ricerca verificata');
  assert.equal((await call('click', ['#shadow >>> #inside'])).error, undefined);
  assert.equal(await target.locator('#shadow #inside').getAttribute('data-clicked'), 'yes');
  assert.match((await call('typeText', ['#password', 'non scrivere'])).error, /riservato/);
  assert.equal(await target.locator('#password').inputValue(), 'PASSWORD_PRIVATA');
  assert.equal((await call('selectOption', ['#choice', 'Seconda'])).error, undefined);
  assert.equal(await target.locator('#choice').inputValue(), 'b');
  await target.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white';
    document.body.append(overlay);
  });
  assert.match((await call('click', ['#safe'])).error, /coperto/);
  assert.equal(await target.locator('#safe').getAttribute('data-clicks'), null);
  await target.evaluate(() => document.querySelector('#overlay').remove());
  await target.locator('#safe').scrollIntoViewIfNeeded();
  const marked = (await call('markPage')).value;
  assert.doesNotMatch(marked, /PASSWORD_PRIVATA|ricerca verificata/);
  const number = Number(marked.match(/\[(\d+)\] <button> Verifica/)?.[1]);
  assert.ok(number);
  await target.locator('#safe').evaluate((el) => (el.textContent = 'Bersaglio cambiato'));
  assert.match((await call('clickMark', [number])).error, /cambiato/);
  await call('unmarkPage');
  await target.evaluate(() =>
    setTimeout(() => {
      const el = document.createElement('button');
      el.id = 'late';
      el.textContent = 'Pronto';
      document.body.append(el);
    }, 400)
  );
  assert.equal((await call('waitFor', ['#late', 'visible', 2])).error, undefined);
  assert.equal((await call('waitFor', ['#not-here', 'visible', 30], 100)).name, 'AbortError');
  assert.match((await call('clickCoords', [9999, 9999])).error, /viewport/);
  await target.locator('#safe').evaluate((el) => el.addEventListener('dblclick', () => el.dataset.double = 'yes'));
  const box = await target.locator('#safe').boundingBox();
  assert.equal((await call('clickCoords', [box.x + box.width / 2, box.y + box.height / 2, 2])).error, undefined);
  assert.equal(await target.locator('#safe').getAttribute('data-double'), 'yes');
  assert.equal(
    await target.evaluate(() => typeof globalThis.__diggioDom),
    'undefined',
    'Helper isolato dalla pagina'
  );
  await target.locator('#field').fill('testo da conservare');
  await target.locator('#field').press('End');
  const editor = (await call('readEditor')).value;
  assert.equal(editor.text, 'testo da conservare');
  assert.equal((await call('insertText', [editor.target, ' e aggiungere'])).error, undefined);
  assert.equal(await target.locator('#field').inputValue(), 'testo da conservare e aggiungere');
  await call('pressKey', ['Ctrl+Home']);
  await call('pressKey', ['Ctrl+Shift+ArrowRight']);
  const selected = await target
    .locator('#field')
    .evaluate((el) => el.selectionEnd - el.selectionStart);
  assert.ok(selected > 0, 'Combinazione di tasti seleziona il testo');
  await target.locator('#password').focus();
  assert.match((await call('pressKey', ['Backspace'])).error, /riservati/);
  assert.match((await call('insertText', [editor.target, 'BLOCCATO'])).error, /editor/);
  assert.equal(await target.locator('#password').inputValue(), 'PASSWORD_PRIVATA');
  const accessibility = (await call('readAccessibility')).value;
  assert.match(accessibility, /Apri menu/);
  assert.doesNotMatch(accessibility, /PASSWORD_PRIVATA/);
  await target.evaluate(() => {
    const f = document.createElement('iframe');
    f.id = 'editorframe';
    f.srcdoc = '<body contenteditable="true" aria-label="Editor documento">Contenuto</body>';
    document.body.prepend(f);
  });
  await target.frameLocator('#editorframe').locator('body').click();
  const inner = (await call('readEditor')).value;
  assert.equal(inner.name, 'Editor documento');
  assert.equal((await call('insertText', [inner.target, ' Nuovo testo'])).error, undefined);
  assert.match(
    await target.frameLocator('#editorframe').locator('body').innerText(),
    /Nuovo testo/
  );

  // Registrazione reale di eventi utente, navigazione, approvazione e riutilizzo.
  await target.goto(base + '/page');
  await page.click('#btnTools');
  await page.click('#btnLearning');
  await page.locator('#learningPanel summary').click();
  await page.selectOption('#recordingTab', String(tabId));
  await page.click('#btnStartRecording');
  await page.waitForFunction(() => !document.querySelector('#recordingBanner').hidden);
  await target.locator('#field').fill('VALORE_PRIVATO_NON_SALVARE');
  await target.locator('#password').fill('NUOVA_PASSWORD_PRIVATA');
  await target.locator('#choice').selectOption('b');
  await target.locator('#safe').click();
  await target.locator('#next').click();
  await target.waitForURL('**/next?token=URL_PRIVATO');
  await target.waitForFunction(() =>
    document.documentElement.textContent.includes('Diggio sta registrando')
  );
  await target.locator('#safe').click();
  await page.waitForFunction(
    async () =>
      ((await chrome.runtime.sendMessage({ type: 'GET_RECORDING' })).recording?.steps.length ||
        0) >= 7
  );
  const raw = await page.evaluate(() => chrome.storage.session.get('learningRecording'));
  assert.doesNotMatch(JSON.stringify(raw), /VALORE_PRIVATO|NUOVA_PASSWORD|URL_PRIVATO/);
  const blocked = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'START_AGENT', task: 'non partire', mode: 'auto' })
  );
  assert.match(blocked.error, /registrazione/);
  await page.click('#btnStopRecordingQuick');
  await page.waitForFunction(() => document.querySelector('#recordingBanner').hidden);
  assert.match(await page.locator('#procedureInstructions').inputValue(), /\{\{dato_/);
  assert.match(await page.locator('#procedureInstructions').inputValue(), /manualmente/);
  assert.equal(
    (await page.evaluate(() => chrome.storage.local.get('learnedProcedures'))).learnedProcedures,
    undefined,
    'La bozza non è salvata automaticamente'
  );
  await page.fill('#procedureName', 'Procedura dimostrata');
  await page.click('#btnSaveProcedure');
  await page.waitForFunction(() =>
    document.querySelector('#learningStatus').textContent.includes('revisione 1')
  );
  await page.locator('[data-procedure-edit]').click();
  await page
    .locator('#procedureInstructions')
    .fill('1. Apri la pagina.\n2. Cerca {{prodotto}}.\n3. Verifica il risultato.');
  await page.click('#btnSaveProcedure');
  await page.waitForFunction(() =>
    document.querySelector('#learningStatus').textContent.includes('revisione 2')
  );
  const output = path.join(root, 'test-results');
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'learning-light.png') });
  await page.click('#btnTheme');
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'learning-dark.png') });
  await page.click('#btnTheme');
  await page.locator('[data-procedure-use]').click();
  assert.equal(await page.locator('#modeSelect').inputValue(), 'ask_first');
  assert.match(await page.locator('#taskInput').inputValue(), /Procedura dimostrata/);
  assert.equal(requests.length, 0, 'Prepara in chat non esegue la procedura');

  await page.evaluate(
    (base) =>
      chrome.storage.local.set({
        provider: 'custom',
        apiEndpoint: base + '/chat',
        model: 'test',
        apiKey: '',
        vision: 'off'
      }),
    base
  );
  await page.click('#btnTools');
  await page.click('#btnLearning');
  await page.click('#btnTeachChat');
  assert.equal(await page.locator('#modeSelect').inputValue(), 'learn');
  await page.fill('#taskInput', 'Insegnati a cercare un prodotto senza acquistarlo.');
  await page.click('#btnStart');
  await page.waitForFunction(
    () => !document.querySelector('#btnStart').disabled && document.querySelector('.message.done')
  );
  assert.match(requests.at(-1).messages[0].content, /Modalità Insegnami/);
  await page.click('#btnTools');
  await page.click('#btnLearning');
  await page.click('#btnNewProcedure');
  await page.click('#btnUseChatDraft');
  assert.match(await page.locator('#procedureInstructions').inputValue(), /Procedura di ricerca/);
  assert.equal(
    (await page.evaluate(() => chrome.storage.local.get('learnedProcedures'))).learnedProcedures
      .length,
    1
  );
  // Cambio origine ferma la registrazione e non raccoglie sul nuovo sito.
  const details = page.locator('#learningPanel details');
  if (!(await details.evaluate((el) => el.open))) await details.locator('summary').click();
  await page.selectOption('#recordingTab', String(tabId));
  await page.click('#btnStartRecording');
  await target.goto(base.replace('127.0.0.1', 'localhost') + '/outside');
  await page.waitForFunction(() => document.querySelector('#recordingBanner').hidden);
  const stopped = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RECORDING' }));
  assert.equal(stopped.recording.active, false);
  assert.match(stopped.recording.reason, /Cambio sito/);
  assert.deepEqual(errors, []);
  console.log(
    'OK: bersagli univoci, aria-label, scroll automatico, shadow DOM, password, select, overlay, numeri obsoleti, attese/Stop, coordinate, isolamento, registrazione, campi senza valori, navigazione, revisioni approvate, riutilizzo, insegnamento chat e arresto al cambio sito.'
  );
} finally {
  await context?.close();
  server.close();
  if (
    path.dirname(temporary) === path.resolve(os.tmpdir()) &&
    path.basename(temporary).startsWith('diggio-advanced-')
  )
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
