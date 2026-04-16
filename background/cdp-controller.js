// background/cdp-controller.js
// Controlla il browser tramite Chrome DevTools Protocol

export class CDPController {

  constructor(tabId) {
    this.tabId    = tabId;
    this.attached = false;
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
  }

  async detach() {
    if (!this.attached) return;
    try { await chrome.debugger.detach({ tabId: this.tabId }); } catch {}
    this.attached = false;
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
