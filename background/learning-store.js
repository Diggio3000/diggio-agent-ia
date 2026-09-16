import { pageTarget } from '../shared/page-target.js';
import {
  cleanRecordingUrl,
  normalizeRecordingEvent,
  recordPage,
  validateProcedure
} from '../shared/learning.js';
let queue = Promise.resolve();
function serialize(fn) {
  const task = queue.catch(() => {}).then(fn);
  queue = task;
  return task;
}
async function get() {
  return (await chrome.storage.session.get('learningRecording')).learningRecording || null;
}
async function put(record) {
  await chrome.storage.session.set({ learningRecording: record });
  return record;
}
async function inject(record) {
  await chrome.scripting.executeScript({
    target: { tabId: record.tabId },
    world: 'ISOLATED',
    func: pageTarget,
    args: ['install']
  });
  await chrome.scripting.executeScript({
    target: { tabId: record.tabId },
    world: 'ISOLATED',
    func: recordPage,
    args: [record.id]
  });
}
async function stop(record, reason = 'Registrazione terminata') {
  if (!record) return null;
  record.active = false;
  record.reason = reason;
  await put(record);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: record.tabId },
      world: 'ISOLATED',
      func: recordPage,
      args: [null]
    });
  } catch {}
  return record;
}
export function getRecording() {
  return serialize(async () => {
    const r = await get();
    return r?.active && Date.now() - r.started > 1200000
      ? stop(r, 'Tempo massimo di 20 minuti raggiunto')
      : r;
  });
}
export function startRecording(tabId) {
  return serialize(async () => {
    const previous = await get();
    if (previous?.active) throw new Error('Termina prima la registrazione in corso.');
    const tab = await chrome.tabs.get(tabId);
    const url = cleanRecordingUrl(tab.url);
    const record = {
      id: crypto.randomUUID(),
      tabId,
      origin: new URL(url).origin,
      active: true,
      started: Date.now(),
      steps: [{ kind: 'navigate', url }]
    };
    await put(record);
    try {
      await inject(record);
    } catch (e) {
      await stop(record, 'Impossibile registrare questa pagina');
      throw e;
    }
    return record;
  });
}
export function stopRecording() {
  return serialize(async () => stop(await get()));
}
export function acceptRecordingEvent(msg, sender) {
  return serialize(async () => {
    const r = await get();
    if (
      !r?.active ||
      r.id !== msg.id ||
      sender.tab?.id !== r.tabId ||
      sender.frameId !== 0 ||
      new URL(sender.url).origin !== r.origin
    )
      return { active: false };
    if (Date.now() - r.started > 1200000) {
      await stop(r, 'Tempo massimo raggiunto');
      return { active: false };
    }
    const step = normalizeRecordingEvent(msg.event);
    if (!step) return { active: true };
    const previous = r.steps.at(-1);
    if (
      ['type', 'select_option', 'manual'].includes(step.kind) &&
      previous?.kind === step.kind &&
      previous.selector === step.selector
    )
      return { active: true };
    r.steps.push(step);
    if (r.steps.length >= 100) {
      await stop(r, 'Limite di 100 passaggi raggiunto');
      return { active: false };
    }
    await put(r);
    return { active: true };
  });
}
export function saveProcedure(input) {
  return serialize(async () => {
    const procedure = validateProcedure(input);
    const { learnedProcedures = [] } = await chrome.storage.local.get('learnedProcedures');
    const index = learnedProcedures.findIndex((p) => p.id === procedure.id);
    procedure.revision = index >= 0 ? (learnedProcedures[index].revision || 1) + 1 : 1;
    if (index < 0 && learnedProcedures.length >= 50)
      throw new Error('Massimo 50 procedure: elimina una procedura prima di salvarne un’altra.');
    if (index >= 0) learnedProcedures[index] = procedure;
    else learnedProcedures.unshift(procedure);
    await chrome.storage.local.set({ learnedProcedures });
    return procedure;
  });
}
export function deleteProcedure(id) {
  return serialize(async () => {
    const { learnedProcedures = [] } = await chrome.storage.local.get('learnedProcedures');
    await chrome.storage.local.set({
      learnedProcedures: learnedProcedures.filter((p) => p.id !== id)
    });
  });
}
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.url && change.status !== 'complete') return;
  serialize(async () => {
    const r = await get();
    if (!r?.active || r.tabId !== tabId) return;
    let url;
    try {
      url = cleanRecordingUrl(tab.url);
    } catch {
      await stop(r, 'Pagina non registrabile');
      return;
    }
    if (new URL(url).origin !== r.origin) {
      await stop(r, 'Cambio sito: registrazione fermata');
      return;
    }
    if (change.url && r.steps.at(-1)?.url !== url) {
      r.steps.push({ kind: 'navigate', url });
      await put(r);
    }
    if (r.steps.length >= 100 || Date.now() - r.started > 1200000) {
      await stop(r, 'Limite registrazione raggiunto');
      return;
    }
    if (change.status === 'complete') {
      try {
        await inject(r);
      } catch {
        await stop(r, 'Impossibile continuare la registrazione su questa pagina');
      }
    }
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  serialize(async () => {
    const r = await get();
    if (r?.active && r.tabId === tabId) await stop(r, 'Scheda chiusa');
  }).catch(() => {});
});
