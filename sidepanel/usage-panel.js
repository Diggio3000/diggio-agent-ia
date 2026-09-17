import { loadSettings, requestJson, headersFor } from '../shared/providers.js';
import { usageIdentity, usageTotals, normalizeKeyQuota } from '../shared/usage.js';
import { esc } from '../shared/render.js';
const $ = (id) => document.getElementById(id);
const fmt = (n) =>
  n === null || n === undefined
    ? 'Non disponibile'
    : n.toLocaleString('it-IT', { maximumFractionDigits: 6 });
const date = (n) => new Date(n).toLocaleString('it-IT');
const row = (label, value) =>
  `<div class="usage-row"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`;

export function initializeUsagePanel() {
  let records = [],
    config = {},
    currentId = null,
    generation = 0;
  let quota = null,
    quotaId = null,
    loading = false;
  function render() {
    const record = records.find((r) => r.id === $('usageConnection').value);
    const t = usageTotals(record, Number($('usagePeriod').value));
    const metric = (key) =>
      t[key + 'Reported']
        ? fmt(t[key]) + (t[key + 'Reported'] < t.requests ? ' · parziale' : '')
        : 'Non disponibile';
    $('usageLocal').innerHTML =
      `<div class="usage-grid">${[
        ['Token ingresso', 'input'],
        ['Token uscita', 'output'],
        ['Token totali', 'total']
      ]
        .map(
          ([label, key]) =>
            `<div class="usage-card"><small>${label}</small><strong>${metric(key)}</strong></div>`
        )
        .join('')}
      <div class="usage-card"><small>Risposte ricevute</small><strong>${fmt(t.requests)}</strong></div></div>` +
      row('Risposte con errore', fmt(t.errors)) +
      row('Token letti dalla cache', metric('cacheRead')) +
      row('Token scritti in cache', metric('cacheWrite')) +
      row('Costo dichiarato (USD)', metric('costUSD')) +
      '<p class="privacy-note">La cache è già inclusa nei token di ingresso. I totali parziali sommano soltanto i valori ricevuti. Il costo viene mostrato solo quando dichiarato in USD da OpenRouter.</p>';
    const rates = record?.rates;
    const labels = {
      requests: 'Richieste',
      tokens: 'Token',
      'input-tokens': 'Token ingresso',
      'output-tokens': 'Token uscita'
    };
    $('usageLimits').innerHTML = rates
      ? `<p class="privacy-note">Ultima rilevazione: ${esc(date(rates.observedAt))}. Non è un saldo aggiornato in tempo reale.</p>` +
        rates.limits
          .map(
            (l) =>
              row(
                labels[l.resource] + ' · residui / limite',
                `${fmt(l.remaining)} / ${fmt(l.limit)}`
              ) +
              (l.resetAt
                ? row(
                    'Ripristino comunicato',
                    date(l.resetAt) +
                      (l.resetAt <= Date.now() ? ' · trascorso, attendi una nuova rilevazione' : '')
                  )
                : '')
          )
          .join('') +
        (rates.retryAt ? row('Riprova dopo', date(rates.retryAt)) : '')
      : '<p>Non disponibili: il servizio non ha comunicato limiti leggibili dal plugin.</p>';
    if (record?.status === 429)
      $('usageLimits').innerHTML +=
        '<p class="usage-alert">L’ultima richiesta ha ricevuto HTTP 429: limite o capacità del servizio raggiunti.</p>';
    const same = record?.id === currentId;
    $('btnRefreshQuota').hidden = !same || !record?.keyQuota;
    $('btnRefreshQuota').disabled = loading;
    const link = $('usageDashboard');
    link.hidden = !record?.dashboard;
    if (record?.dashboard) link.href = record.dashboard;
    else link.removeAttribute('href');
    if (quotaId === record?.id && quota) {
      $('usageAccount').innerHTML = quota.error
        ? `<p>${esc(quota.error)}</p>`
        : row(
            'Limite della chiave (USD)',
            quota.unlimited ? 'Nessun tetto sulla chiave' : fmt(quota.limit)
          ) +
          row('Residuo del limite chiave (USD)', fmt(quota.remaining)) +
          row('Consumo della chiave · mese UTC (USD)', fmt(quota.monthly)) +
          row('Consumo della chiave · totale (USD)', fmt(quota.usage)) +
          row('Frequenza ripristino del limite', quota.reset || 'Non comunicata') +
          `<p class="privacy-note">Rilevato: ${esc(date(quota.observedAt))}. Questi dati riguardano la chiave su tutte le applicazioni; il residuo del suo limite non è il saldo dell’account.</p>`;
    } else
      $('usageAccount').textContent = record?.keyQuota
        ? 'Puoi leggere il limite della chiave OpenRouter attualmente configurata. Il saldo dell’account si consulta nella dashboard.'
        : record?.cloud || record?.name === 'Ollama'
          ? 'Ollama locale non consuma crediti cloud. Se il modello usa il cloud, valgono i limiti del tuo account: residuo, piano e rinnovo si consultano nella dashboard Ollama. Il plugin non li deduce dai token locali.'
          : 'Saldo, quota dell’abbonamento e rinnovo non disponibili in questo connettore. Consulta la dashboard del provider. Gli abbonamenti ChatGPT e Claude non includono le chiamate API di questo plugin.';
    $('usageBudget').textContent =
      (Number(config.tokenBudget) > 0
        ? `Budget token locale: ${fmt(Number(config.tokenBudget))} per attività. Controllato tra le chiamate; l’ultima risposta può superarlo.`
        : 'Budget token locale disattivato: nessun limite di token impostato.') +
      ` Massimo ${fmt(Number(config.maxSteps) || 40)} passaggi per attività. Puoi impostare o rimuovere il budget in Impostazioni → Memoria e limiti. I consumi restano registrati. Il budget non rappresenta il saldo del provider e non si applica alla modalità Chat.`;
  }
  async function refresh() {
    const run = ++generation;
    const cfg = await loadSettings();
    const { providerUsage = [] } = await chrome.storage.local.get('providerUsage');
    const identity = cfg.apiEndpoint ? await usageIdentity(cfg) : null;
    if (run !== generation) return;
    config = cfg;
    currentId = identity?.id;
    records = providerUsage.filter((r) => r.updated >= Date.now() - 30 * 86400000);
    if (identity && !records.some((r) => r.id === identity.id))
      records.unshift({ ...identity, days: [] });
    const previous = $('usageConnection').value;
    $('usageConnection').replaceChildren(
      ...records.map(
        (r) =>
          new Option(
            `${r.name} · ${r.model} · ${r.host}${r.id === currentId ? ' (attuale)' : ' · ' + r.id.slice(0, 6)}`,
            r.id
          )
      )
    );
    if (records.some((r) => r.id === previous)) $('usageConnection').value = previous;
    else if (currentId) $('usageConnection').value = currentId;
    if (!records.length)
      $('usageConnection').append(new Option('Configura una connessione per iniziare', ''));
    render();
  }
  $('usageConnection').addEventListener('change', render);
  $('usagePeriod').addEventListener('change', render);
  $('btnRefreshQuota').addEventListener('click', async () => {
    if (loading) return;
    loading = true;
    $('btnRefreshQuota').disabled = true;
    $('usageAccount').textContent = 'Lettura quota…';
    try {
      const cfg = await loadSettings();
      const identity = await usageIdentity(cfg);
      if (!identity.keyQuota || !cfg.apiKey || identity.id !== $('usageConnection').value)
        throw new Error('Salva e seleziona una connessione OpenRouter con chiave API.');
      quotaId = identity.id;
      const endpoint = 'https://openrouter.ai/api/v1/key';
      quota = normalizeKeyQuota(
        await requestJson(
          endpoint,
          { headers: headersFor(cfg, endpoint), redirect: 'error' },
          { timeout: 15000 }
        )
      );
    } catch (e) {
      quota = { error: e.message };
    } finally {
      loading = false;
      await refresh();
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === 'local' &&
      (changes.providerUsage || changes.apiEndpoint || changes.model || changes.apiKey) &&
      !$('usagePanel').classList.contains('hidden')
    )
      refresh().catch(() => {
        $('usageLocal').textContent = 'Registro momentaneamente non disponibile.';
      });
  });
  return refresh;
}
