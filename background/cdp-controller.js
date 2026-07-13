// background/cdp-controller.js
// Controlla il browser tramite Chrome DevTools Protocol

export class CDPController {

  constructor(tabId) {
    this.tabId    = tabId;
    this.attached = false;
    // Buffer console e rete — riempiti dagli eventi CDP mentre l'agente è connesso
    this.consoleBuf = [];
    this.networkMap = new Map(); // requestId → {url, method, type, status, error}
    this._eventHandler = null;
  }

  async attach() {
    if (this.attached) return;
    try {
      await chrome.debugger.attach({ tabId: this.tabId }, '1.3');
    } catch (e) {
      // Già attaccato — va bene
      if (!e.message?.toLowerCase().includes('already')) throw e;
    }
    this.attached = true;
    try { await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Page.enable', {}); } catch {}
    try { await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Runtime.enable', {}); } catch {}
    // Domini per analisi tecnica: console del browser + richieste di rete
    try { await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Log.enable', {}); } catch {}
    try { await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Network.enable', {}); } catch {}
    this._installEventListener();
  }

  async detach() {
    if (this._eventHandler) {
      chrome.debugger.onEvent.removeListener(this._eventHandler);
      this._eventHandler = null;
    }
    if (!this.attached) return;
    try { await chrome.debugger.detach({ tabId: this.tabId }); } catch {}
    this.attached = false;
  }

  // Registra console e rete dagli eventi CDP (come la tab Console/Network di DevTools)
  _installEventListener() {
    if (this._eventHandler) return;
    this._eventHandler = (source, method, params) => {
      if (source.tabId !== this.tabId) return;
      try {
        if (method === 'Runtime.consoleAPICalled') {
          const text = (params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
          this._pushConsole(params.type, text);
        } else if (method === 'Log.entryAdded') {
          const e = params.entry || {};
          this._pushConsole(e.level, `${e.text ?? ''}${e.url ? ' — ' + e.url : ''}`);
        } else if (method === 'Network.requestWillBeSent') {
          if (this.networkMap.size >= 400) return; // cap memoria
          this.networkMap.set(params.requestId, {
            url: params.request?.url ?? '', method: params.request?.method ?? 'GET',
            type: params.type ?? '', status: null, error: null
          });
        } else if (method === 'Network.responseReceived') {
          const e = this.networkMap.get(params.requestId);
          if (e) { e.status = params.response?.status ?? null; e.type = params.type ?? e.type; }
        } else if (method === 'Network.loadingFailed') {
          const e = this.networkMap.get(params.requestId);
          if (e) e.error = params.errorText ?? 'failed';
        }
      } catch {}
    };
    chrome.debugger.onEvent.addListener(this._eventHandler);
  }

  _pushConsole(level, text) {
    const clean = (text ?? '').trim().substring(0, 300);
    if (!clean) return;
    this.consoleBuf.push({ level: level || 'log', text: clean });
    if (this.consoleBuf.length > 150) this.consoleBuf.shift();
  }

  // Riconnessione automatica se il debugger viene staccato durante navigazioni/redirect
  async reattach() {
    this.attached = false;
    await this.sleep(600);
    await this.attach();
  }

  async cmd(method, params = {}) {
    try {
      return await chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
    } catch (e) {
      const msg = (e?.message ?? '').toLowerCase();
      const isDetached = msg.includes('not attached') || msg.includes('detached')
                      || msg.includes('no target')    || msg.includes('cannot access');
      if (isDetached) {
        // Riconnessione automatica — accade spesso dopo redirect post-form
        try {
          await this.reattach();
          return await chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
        } catch (e2) {
          throw new Error(`Debugger disconnesso (riconnessione fallita): ${e2.message}`);
        }
      }
      throw e;
    }
  }

  // Naviga verso URL e attende caricamento
  async navigate(url) {
    await this.cmd('Page.navigate', { url });
    await this.waitForLoad();
    // Dopo ogni navigazione ri-abilita i domini CDP (la pagina si è ricaricata)
    try { await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Page.enable', {}); } catch {}
    try { await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Runtime.enable', {}); } catch {}
    try { await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Log.enable', {}); } catch {}
    try { await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Network.enable', {}); } catch {}
  }

  // Attende che la pagina finisca di caricarsi (con fallback su timeout)
  waitForLoad(timeout = 10000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        chrome.debugger.onEvent.removeListener(handler);
        resolve(); // timeout non bloccante — continua comunque
      }, timeout);
      const handler = (source, event) => {
        if (source.tabId === this.tabId && event === 'Page.loadEventFired') {
          clearTimeout(timer);
          chrome.debugger.onEvent.removeListener(handler);
          // Piccola pausa extra per JS post-load
          setTimeout(resolve, 400);
        }
      };
      chrome.debugger.onEvent.addListener(handler);
    });
  }

  // Click tramite CSS selector
  async click(selector) {
    const escaped = selector.replace(/'/g, "\\'");
    const result = await this.cmd('Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.querySelector('${escaped}');
          if (!el) return { ok: false, error: 'Elemento non trovato: ${escaped}' };
          const r = el.getBoundingClientRect();
          if (r.width === 0) return { ok: false, error: 'Elemento non visibile: ${escaped}' };
          return { ok: true, x: r.left + r.width/2, y: r.top + r.height/2 };
        })()
      `,
      returnByValue: true
    });

    const val = result.result.value;
    if (!val.ok) throw new Error(val.error);

    await this.cmd('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: val.x, y: val.y, button: 'left', clickCount: 1
    });
    await this.cmd('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: val.x, y: val.y, button: 'left', clickCount: 1
    });
    await this.sleep(500);
  }

  // Click per testo visibile
  async clickByText(text) {
    const escaped = text.replace(/'/g, "\\'");
    const result = await this.cmd('Runtime.evaluate', {
      expression: `
        (function() {
          const all = document.querySelectorAll('a,button,input[type=submit],[role=button],label');
          for (const el of all) {
            if (el.textContent.trim().toLowerCase().includes('${escaped.toLowerCase()}')) {
              const r = el.getBoundingClientRect();
              if (r.width > 0) return { ok: true, x: r.left + r.width/2, y: r.top + r.height/2 };
            }
          }
          return { ok: false, error: 'Testo non trovato: ${escaped}' };
        })()
      `,
      returnByValue: true
    });

    const val = result.result.value;
    if (!val.ok) throw new Error(val.error);

    await this.cmd('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: val.x, y: val.y, button: 'left', clickCount: 1
    });
    await this.cmd('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: val.x, y: val.y, button: 'left', clickCount: 1
    });
    await this.sleep(500);
  }

  // Digita testo in un campo
  async typeText(selector, text) {
    const escaped = selector.replace(/'/g, "\\'");

    await this.cmd('Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.querySelector('${escaped}');
          if (!el) return false;
          el.focus();
          el.value = '';
          el.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        })()
      `,
      returnByValue: true
    });

    await this.sleep(200);

    for (const char of text) {
      await this.cmd('Input.dispatchKeyEvent', { type: 'char', text: char });
      await this.sleep(30);
    }

    await this.cmd('Runtime.evaluate', {
      expression: `document.querySelector('${escaped}')?.dispatchEvent(new Event('change', {bubbles:true}))`
    });
  }

  // Analisi completa dello stato pagina: scroll, paginazione, risultati, filtri
  async analyzePageState() {
    const result = await this.cmd('Runtime.evaluate', {
      expression: `(function() {
        const scrollH = document.body.scrollHeight;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const viewH = window.innerHeight;
        const scrollPct = Math.round((scrollTop + viewH) / scrollH * 100);

        // Paginazione — include pattern Amazon (.s-pagination) e eBay (.pagination)
        const pagEl = document.querySelector(
          '.pagination,.pager,[class*=paginat],[class*=pagina],[id*=paginat],' +
          '.s-pagination-strip,.s-pagination-container,' + // Amazon
          '.pagination__items,.x-pagination'              // eBay
        );
        const pageLinks = pagEl
          ? Array.from(pagEl.querySelectorAll('a')).map(a=>({text:a.textContent.trim(),href:a.href})).filter(l=>l.text)
          : [];

        // Testo conteggio risultati (es. "Trovati 12 articoli")
        const resultTexts = [];
        document.querySelectorAll(
          '[class*=result],[class*=count],[class*=total],[class*=trovati],[class*=found],' +
          '.s-result-count,.s-desktop-toolbar span[data-component-type],' + // Amazon
          '.srp-controls__count'                                              // eBay
        ).forEach(el => {
          const t = el.textContent.trim().substring(0,120);
          if (t && t.length > 3) resultTexts.push(t);
        });

        // Titoli/nomi prodotti visibili — include selettori Amazon e eBay
        const products = Array.from(document.querySelectorAll(
          'article h1,article h2,article h3,.product h2,.product h3,.item h2,.item h3,[class*=product-title],[class*=item-title],h2 a,h3 a,.card-title,.woocommerce-loop-product__title,' +
          // Amazon
          '[data-component-type="s-search-result"] h2 span.a-text-normal,' +
          // eBay
          '.s-item__title'
        )).slice(0,15).map(el=>el.textContent.trim().substring(0,80)).filter(Boolean);

        // Link ai prodotti/articoli — rilevamento specifico per piattaforma
        const hostname = window.location.hostname;
        const isAmazon = hostname.includes('amazon.');
        const isEbay   = hostname.includes('ebay.');
        let productLinks = [];
        if (isAmazon) {
          // Amazon: ogni card risultato ha un link al prodotto in h2 a
          productLinks = Array.from(document.querySelectorAll(
            '[data-component-type="s-search-result"] h2 a, .s-result-item h2 a'
          )).slice(0,20).map(a=>({
            text: (a.querySelector('span')?.textContent||a.textContent||'').trim().substring(0,60),
            href: a.href.startsWith('http') ? a.href : 'https://'+hostname+a.getAttribute('href')
          })).filter(l=>l.href&&l.href.includes('/dp/'));
        } else if (isEbay) {
          // eBay: ogni item ha un link in .s-item__link
          productLinks = Array.from(document.querySelectorAll(
            '.s-item .s-item__link, .srp-results .s-item a[href*="/itm/"]'
          )).slice(0,20).map(a=>({
            text: (a.closest('.s-item')?.querySelector('.s-item__title')?.textContent||a.textContent||'').trim().substring(0,60),
            href: a.href
          })).filter(l=>l.href&&(l.href.includes('/itm/')||l.href.includes('ebay.')));
        } else {
          productLinks = Array.from(document.querySelectorAll(
            'article a[href],.product a[href],.item a[href],[class*=product] h2 a,[class*=product] h3 a,[class*=articolo] a[href],.catalog a[href]'
          )).filter(a=>{const r=a.getBoundingClientRect();return r.width>0&&r.height>0;})
            .slice(0,20).map(a=>({text:(a.textContent||a.title||'').trim().substring(0,60),href:a.href}))
            .filter(l=>l.href&&!l.href.includes('#')&&l.href.startsWith('http'));
        }

        // Select/dropdown di filtro (marca, modello, anno)
        const selects = Array.from(document.querySelectorAll('select')).map(s=>({
          selector: s.id ? '#'+s.id : (s.name ? '[name="'+s.name+'"]' : 'select'),
          name: s.name || s.id || '',
          options: Array.from(s.options).slice(0,20).map(o=>o.text.trim()).filter(t=>t&&t!=='---'&&t!=='Tutti')
        })).filter(s=>s.options.length>0);

        return {
          pageTitle: document.title.substring(0,80),
          url: window.location.href,
          scrollHeight: scrollH,
          scrollPercent: scrollPct,
          hasMoreBelow: scrollPct < 88,
          pagination: pageLinks,
          resultCount: resultTexts.join(' | ').substring(0,200),
          productsVisible: products,
          productLinks: productLinks,
          filterSelects: selects
        };
      })()`,
      returnByValue: true
    });
    return result?.result?.value ?? null;
  }

  // Scrolla e cattura screenshot — per vedere più contenuto in pagine lunghe
  async scrollAndScreenshot(direction = 'down', amount = 700) {
    await this.cmd('Runtime.evaluate', {
      expression: `window.scrollBy(0, ${direction === 'down' ? amount : -amount})`
    });
    await this.sleep(500);
    return await this.screenshot();
  }

  // Ottieni tutti i link della pagina raggruppati (prodotti, nav, paginazione)
  async getLinks() {
    const result = await this.cmd('Runtime.evaluate', {
      expression: `(function() {
        function vis(el){ const r=el.getBoundingClientRect(); return r.width>0&&r.height>0; }
        const origin = window.location.origin;

        // PRODOTTI: tutti i link dello stesso dominio che sembrano pagine prodotto
        // Pattern comuni: PrestaShop, WooCommerce, Amazon /dp/, eBay /itm/, ecc.
        const productPatterns = [
          /\\/\\d+-[a-z0-9-]+\\.html/i,    // PrestaShop: /123-nome-prodotto.html
          /\\/[a-z-]+\\/\\d+/,              // WooCommerce: /prodotto/123
          /\\?id_product=/,                  // PrestaShop param
          /\\/prodotti?\\//i,               // /prodotto/ o /prodotti/
          /\\/articol/i,                     // /articolo/ o /articoli/
          /\\/ricambi?\\//i,                // /ricambio/ o /ricambi/
          /\\/dp\\/[A-Z0-9]{10}/,           // Amazon ASIN: /dp/B08N5WRWNW
          /\\/gp\\/product\\/[A-Z0-9]{10}/, // Amazon alternativo
          /\\/itm\\/[0-9]+/,                // eBay: /itm/123456789
          /\\/i\\.html\\?.*_trkparms/,      // eBay tracking
          /ebay\\.[a-z]+\\/itm/,            // eBay (qualunque dominio)
        ];
        const allLinks = Array.from(document.querySelectorAll('a[href]'))
          .filter(a => {
            if(!vis(a)) return false;
            const h = a.href || '';
            return h.startsWith(origin) && productPatterns.some(p=>p.test(h));
          });
        const products = allLinks.slice(0,30).map(a=>({
          text: (a.querySelector('h2,h3,.product-title,.product-name,span')?.textContent || a.textContent||'').trim().substring(0,70),
          href: a.href
        })).filter((l,i,arr)=>l.href&&arr.findIndex(x=>x.href===l.href)===i); // dedup

        const nav = Array.from(document.querySelectorAll('nav a,header a,[class*=menu] a,[class*=nav] a'))
          .filter(vis).slice(0,15)
          .map(a=>({text:a.textContent.trim().substring(0,40),href:a.getAttribute('href')||''}))
          .filter(l=>l.text&&l.href&&!l.href.startsWith('javascript')&&!l.href.startsWith('tel')&&!l.href.startsWith('mailto'));

        const pagination = Array.from(document.querySelectorAll(
          '[class*=paginat] a,[class*=pagina] a,.pager a,a[rel=next],a[rel=prev],[class*=page-link],[aria-label*=next],[aria-label*=prev],' +
          '.s-pagination-next,.s-pagination-item,' +  // Amazon
          '.pagination__next,a[aria-label*="Avanti"]' // eBay
        )).filter(vis).map(a=>({text:(a.textContent||a.ariaLabel||'').trim(),href:a.href})).filter(l=>l.text||l.href);

        return { products, nav, pagination };
      })()`,
      returnByValue: true
    });
    return result?.result?.value ?? { products: [], nav: [], pagination: [] };
  }

  // Estrae la struttura interattiva della pagina: input, bottoni, form, nav
  async getPageStructure() {
    const result = await this.cmd('Runtime.evaluate', {
      expression: `(function() {
        function vis(el) {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        function cls(el) {
          return (el.className || '').toString().split(' ').filter(Boolean).slice(0,3).join('.');
        }
        function sel(el) {
          let s = el.tagName.toLowerCase();
          if (el.id) s += '#' + el.id;
          else if (el.name) s += '[name="' + el.name + '"]';
          else if (el.type) s += '[type="' + el.type + '"]';
          else if (el.placeholder) s += '[placeholder*="' + el.placeholder.substring(0,15) + '"]';
          else { const c = cls(el).split('.')[0]; if(c) s += '.' + c; }
          return s;
        }

        const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]),textarea,select'))
          .filter(vis).slice(0,12).map(el => ({
            selector: sel(el),
            type: el.type || el.tagName.toLowerCase(),
            placeholder: el.placeholder || '',
            name: el.name || '',
            id: el.id || ''
          }));

        const buttons = Array.from(document.querySelectorAll('button,input[type=submit],input[type=button],[role=button],[type=submit]'))
          .filter(vis).slice(0,10).map(el => ({
            selector: sel(el),
            text: (el.textContent || el.value || '').trim().substring(0,40)
          })).filter(b => b.text);

        const forms = Array.from(document.querySelectorAll('form'))
          .filter(vis).slice(0,5).map(f => ({
            id: f.id || '',
            action: f.action || '',
            method: f.method || 'get'
          }));

        const navLinks = Array.from(document.querySelectorAll('nav a,header a,[class*=menu] a,[class*=nav] a'))
          .filter(vis).slice(0,15).map(a => ({
            text: a.textContent.trim().substring(0,35),
            href: a.getAttribute('href') || ''
          })).filter(l => l.text && l.href && !l.href.startsWith('javascript'));

        return { title: document.title.substring(0,80), inputs, buttons, forms, navLinks };
      })()`,
      returnByValue: true
    });
    return result?.result?.value ?? null;
  }

  // Leggi contenuto pagina + TUTTI i link dal sorgente HTML (DOM live).
  // I link vengono letti da a.href che nel browser è sempre l'URL assoluto completo.
  // Nessun filtro per pattern — il modello legge la lista e decide da solo
  // quali href sono prodotti. Questo evita errori su PrestaShop, eBay, Amazon, ecc.
  async readPage() {
    const result = await this.cmd('Runtime.evaluate', {
      expression: `(function() {
        // 1. Testo visibile — rimuovi elementi non utili per risparmiare spazio
        const body = document.body.cloneNode(true);
        body.querySelectorAll('script,style,noscript').forEach(e => e.remove());
        const pageText = body.innerText.replace(/\\s{3,}/g, '\\n\\n').trim().substring(0, 3500);

        // 2. TUTTI i link dal sorgente — come fare "Visualizza sorgente" e cercare <a href>
        // a.href nel DOM live è già assoluto (il browser risolve i path relativi)
        const seen = new Set();
        const links = Array.from(document.querySelectorAll('a[href]'))
          .filter(a => {
            const h = a.href;
            // Salta: ancoraggi, javascript:, mailto:, tel:, duplicati
            if (!h || !h.startsWith('http') || h.includes('#') || seen.has(h)) return false;
            seen.add(h);
            return true;
          })
          .map(a => {
            const text = (a.textContent || a.title || '').trim().replace(/\\s+/g,' ').substring(0, 55);
            return (text ? text + '  →  ' : '') + a.href;
          });

        return pageText +
          '\\n\\n=== LINK PAGINA (da sorgente HTML — usa questi URL, non costruirne di nuovi) ===\\n' +
          links.join('\\n');
      })()`,
      returnByValue: true
    });
    return result.result.value ?? '';
  }

  // Esegue JavaScript arbitrario nella pagina e restituisce il risultato serializzato.
  // Utile per estrarre dati dal DOM, cliccare elementi via JS, interagire con librerie
  // custom (Select2, Chosen, Vue, React, ecc.) che non rispondono ai metodi standard.
  async executeJs(code) {
    const wrapped = `(function() { try { return JSON.stringify(eval(${JSON.stringify(code)})); } catch(e) { return 'ERRORE: ' + e.message; } })()`;
    const result = await this.cmd('Runtime.evaluate', {
      expression: wrapped,
      returnByValue: true
    });
    const raw = result?.result?.value ?? 'null';
    // Limita output a 2000 chars per non saturare il contesto
    return typeof raw === 'string' ? raw.substring(0, 2000) : String(raw).substring(0, 2000);
  }

  // Click su coordinate fisiche dello schermo (x, y in pixel dalla viewport).
  // Utile per dropdown personalizzati, canvas, elementi non selezionabili via CSS.
  async clickCoords(x, y) {
    await this.cmd('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    });
    await this.sleep(80);
    await this.cmd('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    });
    await this.sleep(400);
  }

  // Scrolla all'interno di un elemento specifico (es. lista dropdown aperta)
  async scrollWithin(selector, direction = 'down', amount = 300) {
    const escaped = selector.replace(/'/g, "\\'");
    await this.cmd('Runtime.evaluate', {
      expression: `(function() {
        const el = document.querySelector('${escaped}');
        if (el) el.scrollBy(0, ${direction === 'down' ? amount : -amount});
      })()`
    });
    await this.sleep(300);
  }

  // ══════════════════════════════════════════════════════════
  // SET-OF-MARKS — numera visivamente gli elementi interattivi
  // Tecnica usata dagli agent browser moderni: badge numerati sugli
  // elementi cliccabili; il modello dice "clicca il 12" invece di
  // stimare coordinate o indovinare selettori CSS.
  // Funziona con TUTTI i modelli: ai vision arriva lo screenshot con
  // i badge, a tutti arriva la lista testuale [n] <tag> testo → URL.
  // ══════════════════════════════════════════════════════════

  async markPage() {
    const result = await this.cmd('Runtime.evaluate', {
      expression: `(function() {
        // Rimuovi marks precedenti
        document.querySelectorAll('.diggio-som').forEach(e => e.remove());
        window.__diggioMarks = [];

        const els = Array.from(document.querySelectorAll(
          'a[href],button,input:not([type=hidden]),select,textarea,' +
          '[role=button],[role=link],[role=tab],[role=menuitem],[role=combobox],' +
          '[role=checkbox],[role=radio],[role=option],[onclick],summary'
        ));
        const out = [];
        let n = 0;
        for (const el of els) {
          if (n >= 120) break;
          const r = el.getBoundingClientRect();
          // Solo elementi visibili nella viewport corrente
          if (r.width < 5 || r.height < 5) continue;
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;

          n++;
          window.__diggioMarks[n] = el;

          // Badge numerato (angolo alto-sinistra dell'elemento)
          const badge = document.createElement('div');
          badge.className = 'diggio-som';
          badge.textContent = n;
          badge.style.cssText = 'position:fixed;left:' + Math.max(0, r.left - 2) + 'px;top:' +
            Math.max(0, r.top - 14) + 'px;background:#7c3aed;color:#fff;' +
            'font:bold 11px/14px monospace;padding:0 4px;border-radius:3px;' +
            'z-index:2147483647;pointer-events:none;box-shadow:0 0 2px #000;';
          document.body.appendChild(badge);

          // Bordo attorno all'elemento
          const box = document.createElement('div');
          box.className = 'diggio-som';
          box.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' +
            r.width + 'px;height:' + r.height + 'px;outline:2px solid #7c3aed;' +
            'z-index:2147483646;pointer-events:none;';
          document.body.appendChild(box);

          const tag = el.tagName.toLowerCase();
          const text = (el.textContent || el.value || el.placeholder ||
                        el.getAttribute('aria-label') || el.title || '')
                        .trim().replace(/\\s+/g, ' ').substring(0, 60);
          const href = el.href ? '  →  ' + el.href.substring(0, 90) : '';
          out.push('[' + n + '] <' + tag + '> ' + text + href);
        }
        return out.join('\\n').substring(0, 4200) || 'Nessun elemento interattivo visibile nella viewport';
      })()`,
      returnByValue: true
    });
    await this.sleep(150); // lascia renderizzare i badge prima dello screenshot
    return result?.result?.value ?? '';
  }

  // Rimuove i badge Set-of-Marks dalla pagina
  async unmarkPage() {
    try {
      await this.cmd('Runtime.evaluate', {
        expression: `document.querySelectorAll('.diggio-som').forEach(e => e.remove())`
      });
    } catch {}
  }

  // Clicca l'elemento numerato n dell'ultimo markPage (click fisico al centro)
  async clickMark(n) {
    const result = await this.cmd('Runtime.evaluate', {
      expression: `(function() {
        const el = (window.__diggioMarks || [])[${parseInt(n)}];
        if (!el) return { ok: false, error: 'Elemento [${parseInt(n)}] non trovato — richiama mark_page (i numeri si azzerano dopo navigazioni/scroll)' };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        if (r.width === 0) return { ok: false, error: 'Elemento [${parseInt(n)}] non più visibile' };
        return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2,
                 desc: (el.textContent || el.value || '').trim().substring(0, 50) };
      })()`,
      returnByValue: true
    });
    const val = result?.result?.value;
    if (!val?.ok) throw new Error(val?.error ?? 'clickMark fallito');
    await this.unmarkPage(); // togli i badge prima del click (per screenshot puliti dopo)
    await this.clickCoords(val.x, val.y);
    return val.desc;
  }

  // ══════════════════════════════════════════════════════════
  // ZOOM — screenshot ingrandito di una regione della viewport
  // Per leggere testo piccolo (prezzi, codici) che nello screenshot
  // intero risulta illeggibile ai modelli vision.
  // x, y = angolo alto-sinistra della regione (coordinate viewport)
  // ══════════════════════════════════════════════════════════

  async zoomScreenshot(x = 0, y = 0, width = 600, height = 400) {
    // Converte coordinate viewport → coordinate pagina (il clip CDP usa quelle)
    const off = await this.cmd('Runtime.evaluate', {
      expression: `JSON.stringify({sx: window.scrollX, sy: window.scrollY, vw: innerWidth, vh: innerHeight})`,
      returnByValue: true
    });
    const { sx, sy, vw, vh } = JSON.parse(off?.result?.value ?? '{"sx":0,"sy":0,"vw":1280,"vh":800}');
    const w = Math.max(100, Math.min(width, vw));
    const h = Math.max(100, Math.min(height, vh));
    const cx = Math.max(0, Math.min(x, vw - w));
    const cy = Math.max(0, Math.min(y, vh - h));
    const scale = Math.min(3, Math.max(1.5, 1200 / w)); // ingrandimento 1.5x–3x

    const result = await this.cmd('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 85,
      captureBeyondViewport: true,
      clip: { x: sx + cx, y: sy + cy, width: w, height: h, scale }
    });
    return result.data;
  }

  // ══════════════════════════════════════════════════════════
  // ANALISI TECNICA — console browser, richieste di rete, tasti
  // (come le tab Console/Network di DevTools)
  // ══════════════════════════════════════════════════════════

  // Messaggi console registrati da quando l'agente è connesso
  readConsole() {
    if (this.consoleBuf.length === 0) {
      return 'Nessun messaggio in console da quando l\'agente è connesso. Se hai già navigato/ricaricato la pagina in questa sessione, significa che la pagina NON produce errori né warning (buon segno per la qualità del sito) — NON serve ricaricare di nuovo, prosegui con l\'analisi.';
    }
    const errors = this.consoleBuf.filter(e => e.level === 'error');
    const warns  = this.consoleBuf.filter(e => e.level === 'warning' || e.level === 'warn');
    const others = this.consoleBuf.filter(e => !errors.includes(e) && !warns.includes(e));
    const fmt = (list, max) => list.slice(-max).map(e => `  [${e.level}] ${e.text}`).join('\n');

    let out = `CONSOLE BROWSER (${this.consoleBuf.length} messaggi da inizio sessione):\n`;
    if (errors.length) out += `\n❌ ERRORI (${errors.length}):\n` + fmt(errors, 20) + '\n';
    if (warns.length)  out += `\n⚠️ WARNING (${warns.length}):\n` + fmt(warns, 12) + '\n';
    if (others.length) out += `\nℹ️ LOG (${others.length}, ultimi 10):\n` + fmt(others, 10);
    return out.substring(0, 3200);
  }

  // Riepilogo richieste di rete registrate da quando l'agente è connesso
  readNetwork() {
    const reqs = Array.from(this.networkMap.values());
    if (reqs.length === 0) {
      return 'Nessuna richiesta di rete registrata da quando l\'agente è connesso. Naviga/ricarica la pagina per catturare il traffico di caricamento, poi rileggi.';
    }
    // Fallita = status HTTP >= 400, oppure errore di rete SENZA alcuna risposta ricevuta.
    // (I beacon analytics con 204 + connessione chiusa NON sono errori)
    const failed = reqs.filter(r => (r.status && r.status >= 400) || (r.error && !r.status));
    const xhr    = reqs.filter(r => r.type === 'XHR' || r.type === 'Fetch');
    const scripts = reqs.filter(r => r.type === 'Script');
    const byType = {};
    reqs.forEach(r => { byType[r.type || 'Altro'] = (byType[r.type || 'Altro'] ?? 0) + 1; });
    const host = u => { try { return new URL(u).hostname; } catch { return u.substring(0, 40); } };

    let out = `RICHIESTE DI RETE (${reqs.length} da inizio sessione):\n`;
    out += 'Per tipo: ' + Object.entries(byType).map(([t, n]) => `${t}:${n}`).join(', ') + '\n';
    if (failed.length) {
      out += `\n❌ FALLITE / ERRORI (${failed.length}):\n` +
        failed.slice(-15).map(r => `  [${r.status ?? r.error}] ${r.method} ${r.url.substring(0, 110)}`).join('\n') + '\n';
    }
    if (xhr.length) {
      out += `\n📡 CHIAMATE XHR/FETCH (${xhr.length}, ultime 20):\n` +
        xhr.slice(-20).map(r => `  [${r.status ?? '…'}] ${r.method} ${r.url.substring(0, 110)}`).join('\n') + '\n';
    }
    if (scripts.length) {
      const domains = [...new Set(scripts.map(r => host(r.url)))].slice(0, 15);
      out += `\n📜 SCRIPT (${scripts.length}) da domini: ${domains.join(', ')}`;
    }
    return out.substring(0, 3200);
  }

  // Preme un tasto della tastiera (Enter, Escape, frecce, ecc.)
  async pressKey(name) {
    const KEYS = {
      enter:      { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
      tab:        { key: 'Tab', code: 'Tab', keyCode: 9 },
      escape:     { key: 'Escape', code: 'Escape', keyCode: 27 },
      esc:        { key: 'Escape', code: 'Escape', keyCode: 27 },
      backspace:  { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      delete:     { key: 'Delete', code: 'Delete', keyCode: 46 },
      space:      { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
      arrowdown:  { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      arrowup:    { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      arrowleft:  { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      pagedown:   { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      pageup:     { key: 'PageUp', code: 'PageUp', keyCode: 33 },
      home:       { key: 'Home', code: 'Home', keyCode: 36 },
      end:        { key: 'End', code: 'End', keyCode: 35 },
    };
    const k = KEYS[(name ?? '').toLowerCase().replace(/[\s_-]/g, '')];
    if (!k) throw new Error(`Tasto non supportato: "${name}" — usa: Enter, Tab, Escape, Space, Backspace, Delete, ArrowDown/Up/Left/Right, PageDown/Up, Home, End`);
    await this.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, key: k.key, code: k.code });
    if (k.text) await this.cmd('Input.dispatchKeyEvent', { type: 'char', text: k.text });
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, key: k.key, code: k.code });
    await this.sleep(300);
  }

  // URL corrente
  async getUrl() {
    const result = await this.cmd('Runtime.evaluate', {
      expression: `window.location.href`,
      returnByValue: true
    });
    return result.result.value ?? '';
  }

  // Screenshot base64
  async screenshot() {
    const result = await this.cmd('Page.captureScreenshot', {
      format: 'jpeg', quality: 75
    });
    return result.data;
  }

  // Scroll
  async scroll(direction) {
    const amount = direction === 'down' ? 600 : -600;
    await this.cmd('Runtime.evaluate', {
      expression: `window.scrollBy(0, ${amount})`
    });
    await this.sleep(300);
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
