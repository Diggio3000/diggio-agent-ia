// background/worker.js
import { DiggioClient } from './diggio-client.js';
import { CDPController } from './cdp-controller.js';
import { TabManager }    from './tab-manager.js';

let agentRunning      = false;
let shouldStop        = false;
let approvalResolver  = null;   // per modalità "chiedi prima"
let currentAutoId     = null;   // id automazione in esecuzione (null = task manuale)

/**
 * Auto-dismiss cookie banner e popup dopo ogni navigate/submit_form.
 * Strategia in 3 livelli:
 *  1. Clicca i bottoni di consenso (testo: accetta/accept/ok/agree/ecc.)
 *  2. Rimuove fisicamente dal DOM gli overlay/banner rimasti
 *  3. Setta i cookie/localStorage di consenso per evitare che ricompaiano
 */
async function autoDismissPopups(cdp) {
  await cdp.cmd('Runtime.evaluate', {
    expression: `(function() {
      // 1. Clicca bottoni consenso (keyword italiane + inglesi)
      const keywords = ['accetta','accetto','accettare','accept','agree','consent',
                        'ok','capito','ho capito','chiudi','close','rifiuta','reject',
                        'no grazie','continua','proceed','got it','i agree'];
      const candidates = Array.from(document.querySelectorAll(
        'button,a[href="#"],[role=button],[class*=cookie] button,[class*=popup] button,' +
        '[class*=modal] button,[class*=banner] button,[class*=consent] button,' +
        '[id*=cookie] button,[id*=banner] button,[id*=consent] button'
      ));
      let clicked = 0;
      for (const el of candidates) {
        const t = (el.textContent || el.value || el.title || el.ariaLabel || '').trim().toLowerCase();
        if (keywords.some(k => t === k || t.startsWith(k))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            el.click();
            clicked++;
            if (clicked >= 3) break;
          }
        }
      }

      // 2. Rimuovi fisicamente overlay/banner rimasti visibili nel DOM
      // (fallback per banner che non si chiudono con click o che usano display:block)
      setTimeout(() => {
        const bannerSelectors = [
          '[class*=cookie-banner]','[class*=cookiebanner]','[class*=cookie-bar]',
          '[class*=cookie-notice]','[class*=cookie-consent]','[class*=cookie-overlay]',
          '[id*=cookie-banner]','[id*=cookiebanner]','[id*=cookie-bar]',
          '[id*=cookie-notice]','[id*=cookie-consent]','[id*=CybotCookiebotDialog]',
          '[class*=gdpr]','[id*=gdpr]','[class*=onetrust]','[id*=onetrust]',
          '.didomi-popup-container','.qc-cmp-ui-container',
          // PrestaShop specifico
          '[class*=ps-alert-cookie]','[class*=cookie_law]','[id*=cookieLaw]',
          'div[id="cookies-alert"]','div[id="cookie-info"]'
        ];
        bannerSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 100) el.remove(); // rimuovi solo elementi grandi (banner)
          });
        });
        // Ripristina scroll se il body era bloccato
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      }, 300);

      // 3. Setta cookie/localStorage consenso per evitare che ricompaia nelle pagine successive
      try {
        // Generico
        localStorage.setItem('cookieAccepted', '1');
        localStorage.setItem('cookie_consent', '1');
        localStorage.setItem('gdpr_accepted', '1');
        localStorage.setItem('cookies_accepted', 'true');
        // PrestaShop (usa cookie di sessione + localStorage)
        document.cookie = 'cookie_accepted=1; path=/; max-age=31536000';
        document.cookie = 'cookies_accepted=1; path=/; max-age=31536000';
        document.cookie = 'PrestaShop-gdpr=1; path=/; max-age=31536000';
        document.cookie = 'rc::a=1; path=/; max-age=31536000';
      } catch(e) {}

      return clicked + ' banner gestiti';
    })()`
  });
  // Pausa per lasciare che le animazioni di chiusura finiscano
  await new Promise(r => setTimeout(r, 500));
}

// Apri side panel al click icona
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'START_AGENT') {
    if (agentRunning) { sendUpdate('⚠️ Agente già in esecuzione!', 'error'); return; }
    startAgent(msg.task, msg.apiKey, msg.model, msg.endpoint ?? null, msg.tabId ?? null, msg.mode ?? 'auto', msg.imageData ?? null, msg.sessionContext ?? null);
  }

  if (msg.type === 'STOP_AGENT') {
    shouldStop = true;
    if (approvalResolver) { approvalResolver('stop'); approvalResolver = null; }
    sendUpdate('⏹ Stop richiesto...', 'info');
  }

  if (msg.type === 'APPROVE_ACTION') {
    if (approvalResolver) { approvalResolver('approve'); approvalResolver = null; }
  }

  if (msg.type === 'SKIP_ACTION') {
    if (approvalResolver) { approvalResolver('skip'); approvalResolver = null; }
  }

  if (msg.type === 'SCREENSHOT') { takeScreenshot(); }

  if (msg.type === 'GET_TABS') {
    TabManager.getAllTabs().then(tabs => {
      chrome.runtime.sendMessage({ type: 'TABS_LIST', tabs });
    });
  }

  // ── Automazioni ────────────────────────────────────────────
  if (msg.type === 'SAVE_AUTOMATION') {
    (async () => {
      const all = await getAutomations();
      const idx = all.findIndex(a => a.id === msg.automation.id);
      if (idx >= 0) all[idx] = msg.automation; else all.push(msg.automation);
      await chrome.storage.local.set({ automations: all });
      if (msg.automation.active) {
        await scheduleAutomationAlarm(msg.automation);
      } else {
        await chrome.alarms.clear(`automation_${msg.automation.id}`);
      }
      sendResponse({ ok: true });
    })();
    return true; // async response
  }

  if (msg.type === 'DELETE_AUTOMATION') {
    (async () => {
      const all = await getAutomations();
      await chrome.storage.local.set({ automations: all.filter(a => a.id !== msg.id) });
      await chrome.alarms.clear(`automation_${msg.id}`);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'TOGGLE_AUTOMATION') {
    (async () => {
      const updated = await updateAutomation(msg.id, { active: msg.active });
      if (msg.active && updated) await scheduleAutomationAlarm(updated);
      else await chrome.alarms.clear(`automation_${msg.id}`);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'RUN_AUTOMATION_NOW') {
    (async () => {
      const all = await getAutomations();
      const auto = all.find(a => a.id === msg.id);
      if (auto) runAutomation(auto);
      sendResponse({ ok: true });
    })();
    return true;
  }
});

async function startAgent(task, apiKey, model, endpoint, targetTabId, mode, imageData, sessionContext) {
  agentRunning = true;
  shouldStop   = false;

  const client = new DiggioClient(
    apiKey,
    model,
    endpoint ?? 'https://api.openai.com/v1/chat/completions'
  );

  let tab;
  if (targetTabId) tab = await chrome.tabs.get(targetTabId).catch(() => null);
  if (!tab) [tab]  = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    sendUpdate('❌ Nessuna tab attiva trovata', 'error');
    agentRunning = false;
    return;
  }

  sendUpdate(`🎯 Scheda: ${tab.title?.substring(0, 40) ?? tab.url}`, 'info');
  if (mode === 'ask_first') sendUpdate('🔔 Modalità "chiedi prima" attiva — approva ogni azione', 'info');

  const cdp = new CDPController(tab.id);

  try {
    await cdp.attach();
    sendUpdate('🔗 Connesso al browser', 'info');

    // Costruisci il primo messaggio — include contesto sessione precedente se presente
    let taskText = task;
    if (sessionContext) {
      taskText = `## CONTESTO SESSIONE PRECEDENTE (stessa chat, continua da qui):\n${sessionContext}\n\n## NUOVO MESSAGGIO UTENTE:\n${task}`;
      sendUpdate('🔗 Contesto sessione precedente incluso', 'info');
    }

    // Se c'è immagine, primo messaggio è multimodale
    // L'immagine viene conservata come "immagine di riferimento" per confronti visivi futuri
    const referenceImage = imageData ?? null;  // tenuta per reinserirla nei confronti visivi
    const firstContent = imageData
      ? [{ type: 'text', text: taskText }, { type: 'image_url', image_url: { url: imageData } }]
      : taskText;

    const history = [{ role: 'user', content: firstContent }];

    let step = 0;
    const maxSteps = 30;

    while (step < maxSteps && !shouldStop) {
      step++;
      sendUpdate(`🤔 Passo ${step}/${maxSteps}...`, 'thinking');

      let parsed;
      try {
        parsed = await client.think(history);
      } catch (e) {
        sendUpdate(`❌ Errore API: ${e.message}`, 'error');
        history.push({ role: 'error', content: e.message });
        await sleep(2000);
        continue;
      }

      sendUpdate(`💭 ${parsed.thought}`, 'thought');

      // Modalità "chiedi prima" — aspetta approvazione
      if (parsed.action !== 'done' && mode === 'ask_first') {
        sendUpdate(
          `⚡ Azione proposta: ${parsed.action}(${JSON.stringify(parsed.params)})`,
          'approval_request',
          { action: parsed.action, params: parsed.params }
        );

        const decision = await waitForApproval();
        if (decision === 'stop' || shouldStop) break;
        if (decision === 'skip') {
          sendUpdate('⏭ Azione saltata dall\'utente', 'info');
          history.push({ role: 'action', action: parsed.action, params: parsed.params, rawResponse: parsed.raw, result: 'SALTATA dall\'utente' });
          continue;
        }
        // decision === 'approve' → procedi
        sendUpdate(`✅ Approvato: ${parsed.action}`, 'info');
      } else if (parsed.action !== 'done') {
        sendUpdate(`⚡ ${parsed.action}(${JSON.stringify(parsed.params)})`, 'action');
      }

      if (parsed.action === 'done') {
        sendUpdate(`✅ ${parsed.params.message ?? 'Task completato!'}`, 'done');
        break;
      }

      let result;
      let actionScreenshot = null;
      let actionRefImage   = null;   // immagine di riferimento utente (per confronti visivi)
      try {
        const actionResult = await executeAction(cdp, parsed.action, parsed.params, referenceImage);
        // executeAction può restituire stringa o {text, screenshot, referenceImage}
        if (actionResult && typeof actionResult === 'object' && 'text' in actionResult) {
          result           = actionResult.text;
          actionScreenshot = actionResult.screenshot ?? null;
          actionRefImage   = actionResult.referenceImage ?? null;
        } else {
          result = actionResult;
        }
        sendUpdate(`📋 ${String(result).substring(0, 200)}`, 'result');
      } catch (e) {
        const msg = (e?.message ?? '').toLowerCase();
        // Se il debugger si è staccato durante l'azione, tenta riconnessione automatica
        if (msg.includes('not attached') || msg.includes('detached') || msg.includes('no target')) {
          sendUpdate('🔄 Debugger disconnesso — riconnessione in corso...', 'info');
          try {
            await cdp.reattach();
            sendUpdate('🔗 Riconnesso al browser', 'info');
            result = `[DEBUGGER RICONNESSO] L'azione "${parsed.action}" ha causato una navigazione. Usa analyze_page o read_page per vedere lo stato attuale della pagina.`;
          } catch (e2) {
            result = `ERRORE CRITICO DEBUGGER: ${e2.message}`;
            sendUpdate(`❌ ${result}`, 'error');
          }
        } else {
          result = `ERRORE: ${e.message}`;
          sendUpdate(`⚠️ ${result}`, 'error');
        }
      }

      history.push({
        role: 'action',
        action: parsed.action,
        params: parsed.params,
        rawResponse: parsed.raw,
        result,
        screenshot: actionScreenshot,
        refImage:   actionRefImage   // non-null solo per scroll_screenshot quando c'è immagine utente
      });
      await sleep(600);
    }

    if (shouldStop)       sendUpdate('⏹ Agente fermato', 'info');
    if (step >= maxSteps) sendUpdate('⚠️ Limite passi raggiunto (30)', 'error');

  } catch (e) {
    sendUpdate(`❌ Errore critico: ${e.message}`, 'error');
  } finally {
    await cdp.detach();
    agentRunning = false;
    sendUpdate('🔌 Sessione terminata', 'info');
  }
}

function waitForApproval() {
  return new Promise(resolve => { approvalResolver = resolve; });
}

async function executeAction(cdp, action, params, referenceImage = null) {
  switch (action) {
    case 'navigate': {
      await cdp.navigate(params.url);

      // Auto-dismiss popup/cookie banner dopo ogni navigazione — evita che il banner
      // blocchi la lettura della pagina (soprattutto su siti PrestaShop che rimostrano
      // il banner ad ogni nuova pagina visitata)
      try { await autoDismissPopups(cdp); } catch {}

      // Screenshot → mostrato nel pannello UI E restituito per aggiungerlo al contesto del modello
      let screenshotB64 = null;
      try {
        screenshotB64 = await cdp.screenshot();
        chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', updateType: 'screenshot', data: screenshotB64 });
      } catch {}

      // Struttura DOM: input, bottoni, form, nav
      let structure = null;
      try { structure = await cdp.getPageStructure(); } catch {}

      // Testo pagina per contesto aggiuntivo — include sezione LINK con href reali
      let pageContent = '';
      try { pageContent = (await cdp.readPage()).substring(0, 3000); } catch {}

      // Analisi scroll: avvisa se la pagina è lunga
      let scrollInfo = '';
      try {
        const st = await cdp.analyzePageState();
        if (st) {
          scrollInfo = `\nSCROLL: pagina al ${st.scrollPercent}%${st.hasMoreBelow ? ' — usa scroll_screenshot per vedere il resto' : ''}`;
          if (st.filterSelects?.length) {
            scrollInfo += `\nFILTRI SELECT disponibili:\n` +
              st.filterSelects.map(s => `  • ${s.selector} → opzioni: ${s.options.slice(0,6).join(', ')}`).join('\n');
          }
          if (st.productsVisible?.length) {
            scrollInfo += `\nPRODOTTI GIÀ VISIBILI:\n` + st.productsVisible.map(p => `  • ${p}`).join('\n');
          }
        }
      } catch {}

      let text = `Navigato su: ${params.url}\n`;
      if (structure) {
        text += `TITOLO: ${structure.title}${scrollInfo}`;
        if (structure.inputs?.length)
          text += `\n\nCAMPI INPUT (selettori esatti da usare):\n` +
            structure.inputs.map(i =>
              `  • ${i.selector}${i.placeholder ? '  placeholder="'+i.placeholder+'"' : ''}${i.type && i.type !== 'text' ? '  type='+i.type : ''}`
            ).join('\n');
        if (structure.buttons?.length)
          text += `\n\nBOTTONI:\n` +
            structure.buttons.map(b => `  • ${b.selector} → "${b.text}"`).join('\n');
        if (structure.navLinks?.length)
          text += `\n\nNAVIGAZIONE:\n` +
            structure.navLinks.map(l => `  • "${l.text}" → ${l.href}`).join('\n');
      }
      text += `\n\nTESTO PAGINA:\n${pageContent || '(in caricamento)'}`;

      // Restituisce oggetto {text, screenshot} — il loop principale lo gestisce
      return { text, screenshot: screenshotB64 };
    }
    case 'click': {
      await cdp.click(params.selector);
      // Attende eventuale navigazione/redirect post-click
      await cdp.waitForLoad(4000);
      await sleep(400);
      try { await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Runtime.enable', {}); } catch {}
      let afterContent = '';
      try { afterContent = (await cdp.readPage()).substring(0, 2000); } catch {}
      const currentUrl = await cdp.getUrl().catch(() => '');
      return `Cliccato: ${params.selector}\nURL attuale: ${currentUrl}\n\n[STATO PAGINA]\n${afterContent}`;
    }
    case 'click_text': {
      await cdp.clickByText(params.text);
      await cdp.waitForLoad(4000);
      await sleep(400);
      try { await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Runtime.enable', {}); } catch {}
      let afterContent = '';
      try { afterContent = (await cdp.readPage()).substring(0, 2000); } catch {}
      const currentUrl = await cdp.getUrl().catch(() => '');
      return `Cliccato testo: "${params.text}"\nURL attuale: ${currentUrl}\n\n[STATO PAGINA]\n${afterContent}`;
    }
    case 'type':
      await cdp.typeText(params.selector, params.text);
      return `Digitato "${params.text}" in ${params.selector}`;
    case 'submit_form': {
      // Invia form: prima cerca il bottone submit nel form, poi prova Enter
      const sel = params.selector ?? 'input[type=search],input[type=text],textarea';
      const escaped = sel.replace(/'/g, "\\'");
      await cdp.cmd('Runtime.evaluate', {
        expression: `(function() {
          const el = document.querySelector('${escaped}');
          if (!el) return 'elemento non trovato';
          const form = el.closest('form');
          if (form) {
            // 1. Cerca bottone submit nel form
            const submitBtn = form.querySelector('[type=submit],button:not([type=button])');
            if (submitBtn) { submitBtn.click(); return 'clicked submit button'; }
            // 2. Prova form.submit()
            try { form.submit(); return 'form.submit()'; } catch(e) {}
          }
          // 3. Fallback: tutti e tre gli eventi tastiera (keydown+keypress+keyup)
          ['keydown','keypress','keyup'].forEach(t =>
            el.dispatchEvent(new KeyboardEvent(t, {key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}))
          );
          return 'keyboard Enter';
        })()`
      });
      // Aspetta caricamento pagina risultati (il submit può causare un redirect)
      await cdp.waitForLoad(5000);
      await sleep(800);
      // Riabilita debugger dopo eventuale redirect
      try {
        await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Page.enable', {});
        await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Runtime.enable', {});
      } catch {}
      // Auto-dismiss popup dopo submit (la pagina risultati può rimostare il banner)
      try { await autoDismissPopups(cdp); } catch {}
      // Screenshot automatico dei risultati
      let screenshotB64 = null;
      try {
        screenshotB64 = await cdp.screenshot();
        chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', updateType: 'screenshot', data: screenshotB64 });
      } catch {}
      // Analisi completa dei risultati: paginazione, prodotti, link
      let st = null;
      try { st = await cdp.analyzePageState(); } catch {}
      let afterContent = '';
      try { afterContent = (await cdp.readPage()).substring(0, 3000); } catch {}

      let text = `Form inviato — pagina risultati caricata\n`;
      if (st) {
        text += `URL: ${st.url}\n`;
        text += `SCROLL: ${st.scrollPercent}% visualizzato${st.hasMoreBelow ? ' ⚠️ USA scroll_screenshot PER VEDERE ALTRI PRODOTTI' : ''}\n`;
        if (st.resultCount) text += `CONTEGGIO: ${st.resultCount}\n`;
        if (st.productsVisible?.length) text += `\nPRODOTTI VISIBILI:\n` + st.productsVisible.map(p=>`  • ${p}`).join('\n') + '\n';
        if (st.productLinks?.length)    text += `\nLINK PRODOTTI (apri ciascuno per vedere scheda tecnica e codici OEM):\n` + st.productLinks.map(p=>`  • ${p.href}`).join('\n') + '\n';
        if (st.pagination?.length)      text += `\n⚠️ CI SONO PIÙ PAGINE — DEVI VISITARLE TUTTE:\n` + st.pagination.map(p=>`  • "${p.text}" → ${p.href}`).join('\n') + '\n';
      }
      text += `\nTESTO PAGINA:\n${afterContent}`;
      return { text, screenshot: screenshotB64 };
    }
    case 'analyze_page': {
      // Analisi completa: scroll, paginazione, risultati, filtri — usa questo dopo navigate/submit_form
      const state = await cdp.analyzePageState();
      if (!state) return 'Analisi pagina non disponibile';
      let out = `ANALISI PAGINA: ${state.pageTitle}\nURL: ${state.url}\n`;
      out += `SCROLL: ${state.scrollPercent}% visualizzato${state.hasMoreBelow ? ' — c\'è ALTRO CONTENUTO SOTTO, usa scroll_screenshot' : ' — pagina completamente visibile'}\n`;
      if (state.resultCount) out += `RISULTATI: ${state.resultCount}\n`;
      if (state.productsVisible?.length) out += `PRODOTTI VISIBILI (${state.productsVisible.length}):\n` + state.productsVisible.map(p=>`  • ${p}`).join('\n') + '\n';
      if (state.productLinks?.length) out += `LINK PRODOTTI (naviga qui per leggere scheda tecnica/OEM):\n` + state.productLinks.map(p=>`  • "${p.text}" → ${p.href}`).join('\n') + '\n';
      if (state.pagination?.length) out += `PAGINAZIONE (OBBLIGATORIO visitare tutte le pagine):\n` + state.pagination.map(p=>`  • "${p.text}" → ${p.href}`).join('\n') + '\n';
      if (state.filterSelects?.length) out += `FILTRI DISPONIBILI:\n` + state.filterSelects.map(s=>`  • ${s.selector} (${s.options.slice(0,8).join(', ')}...)`).join('\n') + '\n';
      return out;
    }
    case 'scroll_screenshot': {
      // Scrolla e cattura screenshot — per vedere tutto il contenuto di una pagina lunga
      const direction = params.direction ?? 'down';
      const amount    = parseInt(params.amount ?? 700);
      const img = await cdp.scrollAndScreenshot(direction, amount);
      chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', updateType: 'screenshot', data: img });
      const state = await cdp.analyzePageState();
      const scrollText = `Scrollato ${direction}. Pagina al ${state?.scrollPercent ?? '?'}%${state?.hasMoreBelow ? ' — c\'è ancora contenuto sotto' : ' — fine pagina raggiunta'}` +
        (referenceImage ? '\n⚠️ CONFRONTO VISIVO: paragona i prodotti nello screenshot con l\'immagine di riferimento dell\'utente (qui sopra nel contesto). Verifica generazione, design, lato (SX/DX). Scarta prodotti visivamente incompatibili.' : '');
      return { text: scrollText, screenshot: img, referenceImage };
    }
    case 'get_links': {
      const links = await cdp.getLinks();
      let out = '';
      if (links.products?.length)   out += `PRODOTTI (link diretti):\n` + links.products.map(l=>`  • "${l.text}" → ${l.href}`).join('\n') + '\n';
      if (links.nav?.length)        out += `NAVIGAZIONE:\n` + links.nav.map(l=>`  • "${l.text}" → ${l.href}`).join('\n') + '\n';
      if (links.pagination?.length) out += `PAGINAZIONE:\n` + links.pagination.map(l=>`  • "${l.text}" → ${l.href}`).join('\n') + '\n';
      return out || 'Nessun link trovato';
    }
    case 'open_tab': {
      // Apre URL in una nuova scheda e la aggiunge al gruppo dell'agente (se esiste)
      const url = params.url;
      if (!url) return 'URL mancante';
      const newTab = await chrome.tabs.create({ url, active: false });
      // Aggiunge al gruppo la nuova scheda + la scheda corrente dell'agente
      try {
        const groupTitle = params.group ?? 'Diggio Risultati';
        const allTabIds  = [cdp.tabId, newTab.id];
        const existing   = await chrome.tabGroups.query({ title: groupTitle }).catch(() => []);
        if (existing.length > 0) {
          await chrome.tabs.group({ tabIds: allTabIds, groupId: existing[0].id });
        } else {
          const groupId = await chrome.tabs.group({ tabIds: allTabIds });
          await chrome.tabGroups.update(groupId, { title: groupTitle, color: 'blue' });
        }
      } catch {}
      sendUpdate(`🗂️ Aperta scheda nel gruppo: ${url}`, 'info');
      return `Scheda aperta: ${url}`;
    }
    case 'open_tabs': {
      // Apre più URL in schede Chrome raggruppate — usa con array di url: ["url1","url2",...]
      // Il parametro opzionale "group" imposta il titolo del gruppo (default: "Diggio Risultati")
      const urls = Array.isArray(params.urls) ? params.urls.slice(0, 6) : [];
      if (urls.length === 0) return 'Nessun URL fornito';
      const groupTitle = params.group ?? 'Diggio Risultati';

      // Crea tutte le schede
      const newTabIds = [];
      for (const url of urls) {
        const tab = await chrome.tabs.create({ url, active: false });
        newTabIds.push(tab.id);
        await sleep(150);
      }

      // Raggruppa tutte le schede appena create + la scheda corrente (quella dell'agente)
      try {
        const allTabIds = [cdp.tabId, ...newTabIds]; // scheda corrente + nuove
        const existing = await chrome.tabGroups.query({ title: groupTitle }).catch(() => []);
        let groupId;
        if (existing.length > 0) {
          await chrome.tabs.group({ tabIds: allTabIds, groupId: existing[0].id });
          groupId = existing[0].id;
        } else {
          groupId = await chrome.tabs.group({ tabIds: allTabIds });
          await chrome.tabGroups.update(groupId, { title: groupTitle, color: 'blue' });
        }
        sendUpdate(`🗂️ Aperte ${urls.length} schede nel gruppo "${groupTitle}" (inclusa scheda corrente)`, 'info');
      } catch (e) {
        sendUpdate(`🗂️ Aperte ${urls.length} nuove schede`, 'info');
      }
      return `Aperte ${urls.length} schede nel gruppo "${groupTitle}": ${urls.join(', ')}`;
    }
    case 'select_option': {
      // Seleziona un'opzione in un <select> — utile per filtri marca/modello/anno
      const escaped = (params.selector ?? 'select').replace(/'/g, "\\'");
      await cdp.cmd('Runtime.evaluate', {
        expression: `(function() {
          const sel = document.querySelector('${escaped}');
          if (!sel) return false;
          const opt = Array.from(sel.options).find(o =>
            o.text.toLowerCase().includes('${(params.value ?? '').toLowerCase()}') ||
            o.value.toLowerCase().includes('${(params.value ?? '').toLowerCase()}')
          );
          if (!opt) return false;
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', {bubbles:true}));
          sel.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        })()`
      });
      await sleep(800);
      return `Selezionato "${params.value}" in ${params.selector}`;
    }
    case 'dismiss_popups': {
      await autoDismissPopups(cdp);
      return 'Popup/cookie banner chiusi';
    }
    case 'save_report':
      // Invia segnale al pannello per scaricare il report HTML della sessione corrente
      chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', updateType: 'save_report' }).catch(() => {});
      return 'Report scaricato nel browser dell\'utente';
    case 'execute_js': {
      // Esegue JavaScript arbitrario nella pagina — come javascript_tool di Claude
      // Utile per: estrarre titoli prodotti, interagire con Select2/Chosen,
      // leggere stato del DOM, cliccare elementi via jQuery, ecc.
      const code = params.code ?? params.js ?? '';
      if (!code) return 'ERRORE: parametro "code" mancante';
      const result = await cdp.executeJs(code);
      return `JS eseguito. Risultato: ${result}`;
    }
    case 'click_coords': {
      // Click su coordinate fisiche (x, y) — come "computer → left_click"
      // Utile per dropdown personalizzati (Select2, Chosen) che non rispondono a click()
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      await cdp.clickCoords(x, y);
      return `Click eseguito su coordinate (${x}, ${y})`;
    }
    case 'scroll_within': {
      // Scrolla all'interno di un elemento specifico (es. lista dropdown aperta)
      const sel = params.selector ?? 'body';
      const dir = params.direction ?? 'down';
      const amt = params.amount ?? 300;
      await cdp.scrollWithin(sel, dir, amt);
      return `Scrollato dentro "${sel}" verso ${dir} di ${amt}px`;
    }
    case 'read_page':
      return await cdp.readPage();
    case 'get_url':
      return `URL: ${await cdp.getUrl()}`;
    case 'scroll':
      await cdp.scroll(params.direction ?? 'down');
      return `Scrollato ${params.direction ?? 'down'}`;
    case 'wait':
      await sleep(parseInt(params.seconds ?? 2) * 1000);
      return `Atteso ${params.seconds ?? 2}s`;
    case 'screenshot': {
      const img = await cdp.screenshot();
      chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', updateType: 'screenshot', data: img });
      return 'Screenshot catturato e mostrato nel pannello';
    }
    default:
      throw new Error(`Azione sconosciuta: ${action}`);
  }
}

function sendUpdate(text, updateType = 'info', extra = null) {
  chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', updateType, text, extra }).catch(() => {});
  // Se è in esecuzione un'automazione, salva il risultato finale in storage
  if (currentAutoId && (updateType === 'done' || updateType === 'error')) {
    updateAutomation(currentAutoId, { lastResult: text.substring(0, 300) });
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function takeScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const cdp = new CDPController(tab.id);
  try {
    await cdp.attach();
    const img = await cdp.screenshot();
    chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', updateType: 'screenshot', data: img });
    await cdp.detach();
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// SISTEMA AUTOMAZIONI — Chrome Alarms
// ══════════════════════════════════════════════════════════════

// Ripristina gli allarmi attivi al riavvio del browser o reinstall
async function restoreAutomationAlarms() {
  const automations = await getAutomations();
  for (const a of automations) {
    if (a.active) await scheduleAutomationAlarm(a);
  }
}

chrome.runtime.onInstalled.addListener(restoreAutomationAlarms);
chrome.runtime.onStartup.addListener(restoreAutomationAlarms);

// Quando scatta un allarme
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('automation_')) return;
  const id = parseInt(alarm.name.split('_')[1]);
  const all = await getAutomations();
  const auto = all.find(a => a.id === id);
  if (!auto || !auto.active) return;

  // Controlla maxRuns
  if (auto.maxRuns > 0 && (auto.runsCount || 0) >= auto.maxRuns) {
    // Raggiunto il limite: disattiva
    await updateAutomation(id, { active: false });
    await chrome.alarms.clear(alarm.name);
    notify('🏁 Automazione completata', `"${auto.name}" ha raggiunto il limite di ${auto.maxRuns} esecuzioni.`);
    return;
  }

  await runAutomation(auto);

  // Ripianifica il prossimo run per schedule daily (l'intervallo fisso si ripianifica da solo)
  if (auto.scheduleType === 'daily') {
    const reloaded = (await getAutomations()).find(a => a.id === id);
    if (reloaded?.active) await scheduleAutomationAlarm(reloaded);
  }
});

// Crea o aggiorna l'allarme Chrome per un'automazione
async function scheduleAutomationAlarm(automation) {
  const name = `automation_${automation.id}`;
  await chrome.alarms.clear(name);

  if (automation.scheduleType === 'interval') {
    const mins = Math.max(1, automation.intervalMinutes || 60);
    chrome.alarms.create(name, { delayInMinutes: mins, periodInMinutes: mins });
    const nextRun = new Date(Date.now() + mins * 60000).toISOString();
    await updateAutomation(automation.id, { nextRun });
  } else {
    // daily: calcola prossima occorrenza valida
    const when = calcNextRun(automation.time || '09:00', automation.days || [1,2,3,4,5]);
    chrome.alarms.create(name, { when });
    await updateAutomation(automation.id, { nextRun: new Date(when).toISOString() });
  }
}

// Calcola il timestamp UNIX del prossimo run (orario + giorni della settimana)
function calcNextRun(timeStr, days) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  const now = new Date();
  const candidate = new Date();
  candidate.setHours(h, m, 0, 0);

  // Se l'orario di oggi è già passato, inizia da domani
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);

  // Se ci sono giorni specificati, avanza al primo giorno valido
  if (days && days.length > 0) {
    for (let tries = 0; tries < 8; tries++) {
      if (days.map(Number).includes(candidate.getDay())) break;
      candidate.setDate(candidate.getDate() + 1);
    }
  }
  return candidate.getTime();
}

// Esegue il task di un'automazione
async function runAutomation(automation) {
  if (agentRunning) {
    // Agente già occupato: rimanda di 5 minuti
    chrome.alarms.create(`automation_${automation.id}`, { delayInMinutes: 5 });
    return;
  }

  const { apiKey, apiEndpoint } = await chrome.storage.sync.get(['apiKey', 'apiEndpoint']);
  if (!apiKey) {
    notify('❌ Automazione fallita', `"${automation.name}": API Key non configurata.`);
    return;
  }

  const now = new Date().toISOString();
  await updateAutomation(automation.id, {
    lastRun: now,
    runsCount: (automation.runsCount || 0) + 1,
    lastResult: 'In esecuzione...'
  });

  notify('🤖 Automazione avviata', automation.name);

  // Trova o crea una tab per l'agente
  let tab = null;
  try {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active && active.url && !active.url.startsWith('chrome://')) tab = active;
  } catch {}
  if (!tab) {
    tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  }

  currentAutoId = automation.id;
  try {
    await startAgent(
      automation.task,
      apiKey,
      automation.model || 'gpt-4o-mini',
      apiEndpoint ?? null,
      tab.id,
      'auto',
      null,
      null
    );
  } finally {
    currentAutoId = null;
  }

  // Leggi risultato salvato e manda notifica finale
  const final = (await getAutomations()).find(a => a.id === automation.id);
  notify('✅ Automazione completata', `${automation.name}: ${final?.lastResult ?? 'completata'}`);

  // Invia aggiornamento al pannello (se aperto) per refresh lista
  chrome.runtime.sendMessage({ type: 'AUTOMATION_UPDATED', id: automation.id }).catch(() => {});
}

// ── Helpers storage automazioni ───────────────────────────────

async function getAutomations() {
  return new Promise(r => chrome.storage.local.get('automations', d => r(d.automations || [])));
}

async function updateAutomation(id, changes) {
  const all = await getAutomations();
  const idx = all.findIndex(a => a.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...changes };
  await chrome.storage.local.set({ automations: all });
  return all[idx];
}

// ── Notifica Chrome ───────────────────────────────────────────
function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '../icons/icon48.png',
    title,
    message: message.substring(0, 200)
  }).catch(() => {});
}
