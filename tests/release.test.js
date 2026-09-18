import test from 'node:test';
import assert from 'node:assert/strict';
import { loadActivityTabs, saveActivityTabs } from '../background/activity-tabs.js';
import { requestJson } from '../shared/providers.js';
import { DiggioClient } from '../background/diggio-client.js';
import { ProgressGuard } from '../shared/progress.js';
import { validateAction } from '../background/diggio-client.js';

test('Un segnaposto di cronologia non viene eseguito e non diventa un esempio di comando', () => {
  const client = new DiggioClient('', 'glm-test', 'https://example.com');
  assert.throws(() => validateAction('type', {selector: 'input', text: '[contenuto omesso]'}), /segnaposto/);
  assert.throws(() => validateAction('insert_text', {target: 'id', text: '[contenuto omesso]'}), /segnaposto/);
  const history = [{role:'action',action:'type',params:{selector:'input',text:'[contenuto omesso]'},result:'Campo compilato'}];
  const messages = client.buildMessages(history);
  assert.ok(!JSON.stringify(messages).includes('[contenuto omesso]'));
  assert.match(messages[0].content, /NON ricevi immagini/);
  assert.ok(!messages.some((m) => String(m.content).startsWith('ACTION: type')));
  history[0].params.text='Mese';
  assert.ok(JSON.stringify(client.buildMessages(history)).includes('Mese'));
});

test('Letture identiche: avviso e richiesta di aiuto; operazioni o nuove evidenze azzerano il blocco', () => {
  const guard = new ProgressGuard();
  const step = () => guard.record('read_editor', {}, {text:JSON.stringify({target:crypto.randomUUID(),text:'stesso dato'})});
  assert.equal(step(), null); assert.equal(step(), null); assert.equal(step(), 'warn');
  assert.equal(step(), null); assert.equal(step(), 'pause');
  guard.record('press_key', {key:'Enter'}, {text:'ok'});
  assert.equal(step(), null);
  for(let i=0;i<100;i++) assert.equal(guard.record('read_page', {}, {text:'pagina diversa '+i}), null);
});

test('Ripresa schede: conversazioni isolate, schede chiuse scartate, nessun ID ripristinato dopo riavvio browser', async () => {
  const original = globalThis.chrome;
  let session = {};
  globalThis.chrome = { storage: { session: {
    get: async (key) => ({[key]: structuredClone(session[key])}),
    set: async (patch) => Object.assign(session, structuredClone(patch))
  } }, tabs: { get: async (id) => { if (id === 99) throw new Error('chiusa'); return {id}; } } };
  try {
    await saveActivityTabs('prima', new Set([1, 2, 99]));
    await saveActivityTabs('seconda', new Set([3]));
    assert.deepEqual([...await loadActivityTabs('prima', 1)], [1, 2]);
    assert.deepEqual([...await loadActivityTabs('seconda', 3)], [3]);
    session = {};
    assert.deepEqual([...await loadActivityTabs('prima', 1)], [1]);
  } finally { globalThis.chrome = original; }
});

test('Gli errori testuali del provider mantengono dettaglio e stato HTTP', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({error: 'Modello non disponibile sul servizio'}), {status: 404});
  try {
    await assert.rejects(requestJson('https://example.com'), (error) =>
      error.status === 404 && error.message === 'Modello non disponibile sul servizio');
  } finally { globalThis.fetch = original; }
});

test('Output troncato: nessun comando eseguito; in Chat testo parziale segnalato senza ragionamento nascosto', async () => {
  const original = globalThis.fetch;
  const response = (content, native = false) => new Response(JSON.stringify({
    choices: [{ finish_reason: 'length', message: native
      ? {tool_calls: [{function: {name: 'click', arguments: '{"selector":"button"}'}}]}
      : {content} }], usage: {total_tokens: 50}
  }));
  const client = new DiggioClient('', 'test', 'https://example.com');
  try {
    for (const native of [false, true]) {
      globalThis.fetch = async () => response('ACTION: done\nPARAMS: {"message":"fatto"}', native);
      await assert.rejects(client.think([]), (e) => e.formatError && /limite di output/.test(e.message));
    }
    globalThis.fetch = async () => response('Prima parte della risposta.');
    assert.match(await client.chat([]), /Prima parte[\s\S]*Risposta parziale/);
    globalThis.fetch = async () => response('<think>solo ragionamento non concluso');
    await assert.rejects(client.chat([]), /risposta visibile/);
  } finally { globalThis.fetch = original; }
});
