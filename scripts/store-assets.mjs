import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.DIGGIO_PLAYWRIGHT || 'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const brandIcon='data:image/png;base64,'+fs.readFileSync(path.join(root,'icons/icon128.png')).toString('base64');
const out=path.join(root,'docs','assets'); fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'diggio-assets-'));
const extension=path.join(temp,'extension'); fs.mkdirSync(extension);
for(const name of ['manifest.json','background','shared','sidepanel','icons'])fs.cpSync(path.join(root,name),path.join(extension,name),{recursive:true});
const server=http.createServer(async(req,res)=>{
 for await(const chunk of req){}
 res.setHeader('Content-Type','application/json');
 res.setHeader('x-ratelimit-limit-requests','100');res.setHeader('x-ratelimit-remaining-requests','99');res.setHeader('x-ratelimit-reset-requests','1m');
 res.end(JSON.stringify({choices:[{message:{content:'## Una settimana, tre priorità\n\n**1. Chiarisci la proposta**\nScegli 5 prodotti e scrivi a chi sono utili.\n\n**2. Prepara il catalogo**\nRaccogli foto, descrizioni e prezzi in una tabella.\n\n**3. Organizza il lancio**\nDefinisci consegne, assistenza e un piccolo calendario.\n\nVuoi iniziare dalla tabella dei prodotti?'}}],usage:{prompt_tokens:420,completion_tokens:180,total_tokens:600}}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let context;
const shot=async(page)=>'data:image/png;base64,'+(await page.screenshot({animations:'disabled'})).toString('base64');
try{
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:430,height:880}});
 const sw=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'); const id=sw.url().split('/')[2];
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/sidepanel/panel.html`); await page.waitForFunction(()=>document.querySelector('#footerVersion').textContent==='v2.2.1');
 const light=await shot(page);await page.click('#btnTheme');const dark=await shot(page);await page.click('#btnTheme');
 await page.evaluate(endpoint=>chrome.storage.local.set({provider:'custom',apiEndpoint:endpoint,model:'modello-demo',apiKey:'',vision:'off'}),`http://127.0.0.1:${server.address().port}/v1/chat/completions`);
 await page.reload(); await page.fill('#taskInput','Aiutami a organizzare la prima settimana del mio negozio online.');await page.click('#btnStart');
 await page.waitForFunction(()=>!document.querySelector('#btnStart').disabled&&document.querySelector('.message.done'));
 const chat=await shot(page);await page.click('#btnUsage');await page.waitForFunction(()=>document.querySelector('#usageLocal').textContent.includes('600'));const usage=await shot(page);await page.locator('#usagePanel .drawer-close').click();
 await page.click('#btnSettings');await page.selectOption('#providerSelect','custom');await page.fill('#apiEndpoint','https://api.example.com/v1');await page.fill('#modelManual','il-tuo-modello');const custom=await shot(page);await page.locator('#settingsPanel .drawer-close').click();
 await page.click('#btnTools');await page.click('#btnLearning');await page.fill('#procedureName','Confronta un prodotto');await page.fill('#procedureInstructions','1. Apri {{sito}}.\n2. Cerca {{prodotto}}.\n3. Leggi prezzo e disponibilità.\n4. Riporta il link della fonte.\n5. Non acquistare.');await page.click('#btnSaveProcedure');await page.waitForFunction(()=>document.querySelector('#learningStatus').textContent.includes('revisione 1'));await page.locator('#learningPanel').evaluate(el=>el.scrollTop=0);const learn=await shot(page);
 let poster=await context.newPage();await poster.setViewportSize({width:1280,height:800});
 const css=`*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#172d46;background:#f1f5fc}main{height:800px;padding:54px 60px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 90% 15%,#d4e1ff,transparent 65%)}.brand{font-size:24px;font-weight:800;letter-spacing:-1px}.logo{display:inline-flex;background:transparent;vertical-align:middle;object-fit:contain;width:42px;height:42px;margin-right:12px}.version{font-size:13px;font-weight:normal;color:#52657e;margin-left:14px;letter-spacing:0}.copy{width:555px;padding-top:75px}.eyebrow{font-size:13px;font-weight:bold;letter-spacing:2px;color:#215fe5}h1{font-size:60px;line-height:1.04;letter-spacing:-2.5px;margin:22px 0}h1 span{color:#2466ec}.intro{font-size:22px;line-height:1.45;color:#4c607a;max-width:500px}.features{display:grid;gap:13px;margin-top:32px;font-size:17px}.features div:before{content:'✓';display:inline-block;color:#138971;font-weight:bold;width:28px}.screen{position:absolute;right:68px;top:44px;height:708px;border:1px solid #ced8e8;border-radius:22px;box-shadow:0 20px 55px #13274924}.foot{position:absolute;bottom:27px;left:60px;font-size:12px;color:#5b6d82}.tag{font-size:11px;color:#60718a;position:absolute;right:92px;bottom:26px}.twins .copy{width:420px;padding-top:104px}.twins h1{font-size:52px}.twins .intro{font-size:20px}.twins .screen{height:644px;top:100px;right:33px;border-radius:18px}.twins .first{right:360px;top:70px}.twins .tag{right:55px}`;
 const data=[
 ['01-interfaccia','Il tuo spazio.<br><span>Il tuo stile.</span>','Chat e agente browser, con tema chiaro o scuro selezionabile.',['Configura il modello prima di iniziare','Lavora accanto alle tue pagine','Firma e sito sempre a portata di mano'],dark,light],
 ['02-chat','Da un’idea<br><span>al primo passo.</span>','Scrivi, ragiona e organizza il lavoro nella tua chat.',['Riprendi le conversazioni','Scegli chat o modalità agente','Esporta i risultati'],chat],
 ['03-endpoint','Il modello<br><span>lo scegli tu.</span>','Provider cloud, modelli locali e servizi personalizzati.',['Indirizzo e modello configurabili','Chiave solo se richiesta dal servizio','Compatibilità e autenticazione avanzate'],custom],
 ['04-consumi','Consumi chiari.<br><span>Limiti visibili.</span>','Consulta ciò che il provider comunica, per connessione e modello.',['Token su 1, 7 o 30 giorni','Dati mancanti indicati esplicitamente','Dashboard anche per Ollama cloud'],usage],
 ['05-procedure','Mostragli come.<br><span>Poi riutilizza.</span>','Costruisci procedure con Insegnami: in chat o registrando i tuoi clic.',['Controlla e approva la bozza','Correggi i passaggi e salvali','Prepara la procedura in chat'],learn]
 ];
 for(const [name,title,intro,features,screen,second] of data){
 await poster.close();poster=await context.newPage();await poster.setViewportSize({width:1280,height:800});
 await poster.setContent(`<style>${css}</style><main class="${second?'twins':''}"><div class="brand"><img class="logo" src="${brandIcon}">Diggio Agent IA<span class="version">2.2</span></div><section class="copy"><div class="eyebrow">IL TUO SPAZIO PER FARE</div><h1>${title}</h1><p class="intro">${intro}</p><div class="features">${features.map(x=>`<div>${x}</div>`).join('')}</div></section>${second?`<img class="screen first" src="${second}">`:''}<img class="screen" src="${screen}"><div class="foot">Antonio Di Giorgio · Diggio3000 · www.diggio3000.it</div><div class="tag">Interfaccia reale · esempio dimostrativo${name==='04-consumi'?' · dati simulati':''}</div></main>`);
 await poster.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 await poster.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});
 }
 for(const [width,height,name] of [[440,280,'promo-440x280'],[1400,560,'marquee-1400x560']]){
 await poster.setViewportSize({width,height});const small=width===440;
 await poster.setContent(`<style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#142c46;color:white}main{padding:${small?'28px':'65px 90px'};height:${height}px;background:radial-gradient(ellipse at 90% 10%,#254c80,transparent 65%)}.brand{font-size:${small?21:30}px;font-weight:bold}.brand img{width:42px;height:42px;object-fit:contain;vertical-align:middle;margin-right:12px}h1{font-size:${small?34:74}px;line-height:1.08;letter-spacing:-1px;max-width:960px;margin:${small?'26px':'48px'} 0 18px}h1 span{color:#8ab3ff}p{font-size:${small?13:23}px;color:#bdcce1}footer{margin-top:${small?22:38}px;font-size:${small?11:15}px;color:#bacce1}</style><main><div class="brand"><img src="${brandIcon}">Diggio Agent IA</div><h1>Dal pensiero<br><span>all’azione, nel browser.</span></h1><p>Il tuo modello. Chat, agente e procedure Insegnami.</p><footer>Diggio3000 · www.diggio3000.it</footer></main>`);await poster.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 await poster.screenshot({path:path.join(out,name+'.png')});
 }
 console.log('Creati 5 screenshot 1280×800 e 2 grafiche promozionali:',out);
} finally {await context?.close();server.close();if(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('diggio-assets-'))fs.rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
