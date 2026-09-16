import { recordedInstructions } from '../shared/learning.js';
import { esc } from '../shared/render.js';
const $ = (id) => document.getElementById(id);
export function initializeLearning({ rpc, open, close, teachChat, lastAnswer, useProcedure }) {
  let editingId = null,
    source = 'chat',
    recording = null;
  const status = (text) => {
    $('learningStatus').textContent = text;
  };
  const guarded = (fn) => () =>
    Promise.resolve()
      .then(fn)
      .catch((e) => status(e.message));
  function showRecording(r) {
    recording = r;
    $('recordingBanner').hidden = !r?.active;
    $('recordingSummary').textContent = r?.active
      ? `● Registrazione · ${r.steps.length} passaggi · ${r.origin}`
      : '';
    $('btnStartRecording').disabled = !!r?.active;
    if (r && !r.active) status(r.reason + '. Carica la registrazione per rivederla.');
  }
  function draft(r) {
    if (!r?.steps.length) throw new Error('Non ci sono passaggi registrati.');
    editingId = null;
    source = 'recording';
    $('procedureName').value = 'Procedura su ' + new URL(r.origin).hostname;
    $('procedureOrigin').value = r.origin;
    $('procedureInstructions').value = recordedInstructions(r);
    status(
      'Bozza caricata. Correggi i passaggi e aggiungi le verifiche, poi approva il salvataggio.'
    );
  }
  async function tabs() {
    const result = await rpc({ type: 'GET_TABS' });
    const selected = $('recordingTab').value;
    $('recordingTab').replaceChildren(
      ...result.tabs
        .filter((t) => /^https?:\/\//.test(t.url || ''))
        .map((t) => new Option(t.title || new URL(t.url).host, String(t.id)))
    );
    if ([...$('recordingTab').options].some((o) => o.value === selected))
      $('recordingTab').value = selected;
  }
  async function list() {
    const { learnedProcedures = [] } = await chrome.storage.local.get('learnedProcedures');
    $('procedureList').innerHTML = learnedProcedures.length
      ? learnedProcedures
          .map(
            (p) =>
              `<article class="procedure-card"><strong>${esc(p.name)}</strong><small>${esc(p.origin || 'Generale')} · revisione ${p.revision || 1}</small><div class="tool-row"><button class="btn-primary" data-procedure-use="${esc(p.id)}">Prepara in chat</button><button class="btn-secondary" data-procedure-edit="${esc(p.id)}">Modifica</button><button class="text-btn" data-procedure-delete="${esc(p.id)}">Elimina</button></div></article>`
          )
          .join('')
      : '<p>Nessuna procedura salvata.</p>';
    for (const button of $('procedureList').querySelectorAll('[data-procedure-edit]'))
      button.onclick = () => {
        const p = learnedProcedures.find((p) => p.id === button.dataset.procedureEdit);
        editingId = p.id;
        source = p.source;
        $('procedureName').value = p.name;
        $('procedureOrigin').value = p.origin;
        $('procedureInstructions').value = p.instructions;
        $('procedureName').focus();
        status('Modifica caricata: salva per confermare una nuova revisione.');
      };
    for (const button of $('procedureList').querySelectorAll('[data-procedure-use]'))
      button.onclick = guarded(async () => {
        const p = learnedProcedures.find((p) => p.id === button.dataset.procedureUse);
        await useProcedure(p, $('procedureRunMode').value);
        close();
      });
    for (const button of $('procedureList').querySelectorAll('[data-procedure-delete]'))
      button.onclick = guarded(async () => {
        await rpc({ type: 'DELETE_PROCEDURE', id: button.dataset.procedureDelete });
        await list();
        status('Procedura eliminata.');
      });
  }
  $('btnLearning').onclick = guarded(async () => {
    open();
    await tabs();
    await list();
    showRecording((await rpc({ type: 'GET_RECORDING' })).recording);
  });
  $('btnTeachChat').onclick = guarded(async () => {
    await teachChat();
    close();
  });
  $('btnUseChatDraft').onclick = guarded(async () => {
    const text = lastAnswer();
    if (!text) throw new Error('Descrivi prima la procedura nella modalità Insegnami in chat.');
    editingId = null;
    source = 'chat';
    $('procedureInstructions').value = text;
    status('Risposta caricata: controlla i passaggi e assegna un titolo prima di salvare.');
  });
  $('btnRefreshRecordingTabs').onclick = guarded(tabs);
  $('btnStartRecording').onclick = guarded(async () => {
    const tabId = Number($('recordingTab').value);
    if (!tabId) throw new Error('Scegli una scheda da registrare.');
    showRecording((await rpc({ type: 'START_RECORDING', tabId })).recording);
    await chrome.tabs.update(tabId, { active: true });
    close();
  });
  $('btnStopRecordingQuick').onclick = guarded(async () => {
    const r = (await rpc({ type: 'STOP_RECORDING' })).recording;
    showRecording(r);
    open();
    draft(r);
    await list();
  });
  $('btnRecoverRecording').onclick = guarded(async () => {
    const r = (await rpc({ type: 'GET_RECORDING' })).recording;
    if (r?.active) throw new Error('Termina la registrazione prima di caricarla.');
    draft(r);
  });
  $('btnNewProcedure').onclick = () => {
    editingId = null;
    source = 'chat';
    for (const id of ['procedureName', 'procedureOrigin', 'procedureInstructions'])
      $(id).value = '';
    status('Nuova bozza.');
  };
  $('btnSaveProcedure').onclick = guarded(async () => {
    const { procedure } = await rpc({
      type: 'SAVE_PROCEDURE',
      procedure: {
        id: editingId,
        name: $('procedureName').value,
        origin: $('procedureOrigin').value,
        instructions: $('procedureInstructions').value,
        source
      }
    });
    editingId = procedure.id;
    await list();
    status('Procedura approvata e salvata sul dispositivo · revisione ' + procedure.revision);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.learningRecording)
      showRecording(changes.learningRecording.newValue);
  });
  rpc({ type: 'GET_RECORDING' })
    .then((r) => showRecording(r.recording))
    .catch((e) => status(e.message));
}
