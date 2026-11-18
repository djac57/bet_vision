// Baromètre des paris — collecteur de cotes.
// Tourne sur GitHub Actions (runners US) : pas de blocage DNS français, pas de CORS,
// donc on appelle les API directement. Écrit data.json à la racine du repo.
// Node 18+ (fetch global). Aucune dépendance.

import { writeFileSync, readFileSync } from 'node:fs';

// France et Europe d'abord : collectés en plus de leur catégorie d'origine (repérés par le titre).
const GEO = [
  { key: 'france', re: /\b(france|french|fran[cç]aise?s?|macron|le ?pen|bardella|m[ée]lenchon|lecornu|philippe|attal|retailleau|lisnard|glucksmann|[ée]lys[ée]e|paris|psg|ligue 1)\b/i,
    man: 'France OR French OR Macron OR "Le Pen" OR Bardella OR Melenchon OR Paris' },
  { key: 'europe', re: /\b(europe|european|eu|eurozone|euro area|ecb|germany|german|bundestag|merz|uk|britain|british|starmer|spain|spanish|italy|italian|meloni|poland|polish|netherlands|dutch|sweden|belgium|portugal|swiss|switzerland|austria|greece|ireland|denmark|norway|finland|czech|hungary|orb[aá]n|romania)\b/i,
    man: 'Europe OR EU OR ECB OR Germany OR UK OR Spain OR Italy OR Poland OR Netherlands' },
];
const CATS = [
  { key: 'politique', pm: 'politics',    man: 'election OR president OR senate OR congress OR government OR democrat OR republican OR trump' },
  { key: 'crypto',    pm: 'crypto',      man: 'bitcoin OR ethereum OR crypto OR solana OR BTC OR ETH' },
  { key: 'sport',     pm: 'sports',      man: 'NFL OR NBA OR soccer OR football OR league OR match OR championship' },
  { key: 'eco',       pm: 'economy',     man: 'fed OR inflation OR recession OR interest rate OR stock OR GDP OR unemployment' },
  { key: 'culture',   pm: 'pop-culture', man: 'movie OR oscar OR grammy OR album OR box office OR celebrity OR netflix' },
  { key: 'monde',     pm: 'world',       man: 'war OR ukraine OR china OR israel OR nato OR nuclear OR geopolitics' },
  { key: 'tech',      pm: 'tech',        man: 'AI OR openai OR spacex OR tesla OR nvidia OR science OR nasa' },
];
const KMAP = { Politics:'politique', Elections:'politique', Sports:'sport', Economics:'eco', Financials:'eco', Entertainment:'culture', World:'monde', 'Science and Technology':'tech', Health:'tech', 'Climate and Weather':'monde' };
const CRYPTO = /bitcoin|crypto|ethereum|\bbtc\b|\beth\b|solana|dogecoin|\bxrp\b/i;

const UA = { headers: { 'accept': 'application/json', 'user-agent': 'barometre-paris (github actions)' } };
async function getJSON(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: UA.headers, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (a === 2) throw e; await new Promise(res => setTimeout(res, 1500)); }
  }
}
const r4 = n => Math.round(n * 1e4) / 1e4;
function money(n){ n=+n||0; if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B vol'; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M vol'; if(n>=1e3)return '$'+(n/1e3).toFixed(0)+'k vol'; return '$'+n.toFixed(0)+' vol'; }
function comp(n){ n=+n||0; if(n>=1e6)return (n/1e6).toFixed(1)+'M'; if(n>=1e3)return (n/1e3).toFixed(0)+'k'; return n.toFixed(0); }

function pmItems(evs, cat) {
  return (evs || []).map(e => {
    const ms = e.markets || [], outs = [];
    for (const m of ms) {
      if (m.closed) continue;
      let pr; try { pr = JSON.parse(m.outcomePrices || '[]'); } catch { continue; }
      if (!pr.length) continue;
      const y = parseFloat(pr[0]); if (!isFinite(y)) continue;
      outs.push({ l: ms.length > 1 ? (m.groupItemTitle || m.question) : 'Oui', p: r4(y) });
    }
    if (outs.length > 1) { const ps = outs.map(o => o.p); const sm = ps.reduce((a, b) => a + b, 0); if (Math.max(...ps) - Math.min(...ps) < 0.02 || sm > 1.8) return null; } // non tradé / non normalisé
    outs = outs.filter(o => !/^(person|candidate|outcome|team|option|choice|player|entrant|contestant)\s*([a-z]|\d{1,3})$/i.test(String(o.l).trim()));
    if (!outs.length) return null;
    outs.sort((a, b) => b.p - a.p);
    return { s: 'polymarket', t: e.title, u: e.slug ? 'https://polymarket.com/event/' + e.slug : '', e: e.endDate || '', c: cat, v: +e.volume || 0, m: money(+e.volume), o: outs.slice(0, 6) };
  }).filter(Boolean);
}
const KSPREAD = 0.15; // écart achat/vente maximal pour se fier au milieu de fourchette
function kPrice(m){
  // Proba = mid (bid+ask)/2 d'un VRAI marché à deux faces ; sinon le dernier prix SI ça a tradé ;
  // sinon rien. Évite les "ask fantômes" sans acheteur (ex. contrat jamais tradé affiché à 92 %).
  // Le mid n'a de sens que si la fourchette est serrée (écart ≤ 0,15) : achat 0,01 / vente 0,99
  // donnerait 50 % sur un carnet vide.
  const last=+m.last_price_dollars, bid=+m.yes_bid_dollars, ask=+m.yes_ask_dollars;
  const vol=+m.volume_fp||0, oi=+m.open_interest_fp||0;
  if(isFinite(bid)&&isFinite(ask)&&bid>0&&ask>0&&ask<1&&ask-bid<=KSPREAD+1e-9) return (bid+ask)/2;
  if(isFinite(last)&&last>0&&last<1&&(vol>0||oi>0)) return last;
  return null;
}
function kItem(e) {
  const ms = e.markets || [], outs = []; let oi = 0, end = null;
  for (const m of ms) {
    const p = kPrice(m); if (p == null) continue;
    outs.push({ l: ms.length > 1 ? (m.yes_sub_title || m.title) : 'Oui', p: r4(p), tk: m.ticker });
    oi += (+m.open_interest_fp || 0);
    if (m.close_time) end = m.close_time;
  }
  if (!outs.length) return null;
  outs.sort((a, b) => b.p - a.p);
  return { s: 'kalshi', t: e.title, u: e.series_ticker ? 'https://kalshi.com/markets/' + e.series_ticker : '', e: end || '', c: null, v: oi, m: comp(oi) + ' OI', series: e.series_ticker || '', o: outs.slice(0, 6) };
}
function manItems(arr, cat) {
  return (arr || []).filter(m => typeof m.probability === 'number' && !m.isResolved)
    .map(m => ({ s: 'manifold', t: m.question, u: m.url, e: m.closeTime || '', c: cat, v: +m.volume || 0, m: 'Ṁ' + comp(+m.volume || 0), o: [{ l: 'Oui', p: r4(m.probability) }] }));
}

async function run() {
  const all = [];
  const sources = { polymarket: { ok: false, n: 0 }, kalshi: { ok: false, n: 0 }, manifold: { ok: false, n: 0 } };

  // Polymarket n'est PAS collecté ici : son API bloque les IP datacenter de GitHub.
  // La page le charge en direct côté navigateur (via jina), où ça fonctionne.

  // Kalshi — pagination au curseur, réparti dans les onglets
  try {
    const base = 'https://api.elections.kalshi.com/trade-api/v2/events?limit=200&status=open&with_nested_markets=true';
    const buckets = {}; CATS.forEach(c => buckets[c.key] = []); GEO.forEach(g => buckets[g.key] = []);
    let cursor = null, pages = 0, seen = 0;
    do {
      const data = await getJSON(base + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      const evs = data.events || []; seen += evs.length;
      for (const e of evs) {
        const it = kItem(e); if (!it) continue;
        for (const g of GEO) if (g.re.test(e.title || '')) { buckets[g.key].push({ ...it, c: g.key }); break; }
        const tab = CRYPTO.test(e.title || '') ? 'crypto' : KMAP[e.category];
        if (!tab) continue;
        it.c = tab; buckets[tab].push(it);
      }
      cursor = data.cursor; pages++;
      if (!cursor || !evs.length) break;
    } while (pages < 6);
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => b.v - a.v);
      const top = buckets[k].slice(0, 45);
      all.push(...top); sources.kalshi.n += top.length;
    }
    sources.kalshi.ok = true;
    console.log('Kalshi events scanned:', seen);
  } catch (e) { console.error('Kalshi:', e.message); }

  // Manifold — recherche par thème (monnaie fictive)
  try {
    for (const c of [...GEO, ...CATS]) {
      const arr = await getJSON(`https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(c.man)}&limit=40&sort=liquidity&filter=open&contractType=BINARY`);
      const items = manItems(arr, c.key).slice(0, 30);
      all.push(...items); sources.manifold.n += items.length;
    }
    sources.manifold.ok = true;
  } catch (e) { console.error('Manifold:', e.message); }

  // Rien collecté (toutes les sources en panne) : on NE réécrit PAS data.json,
  // on conserve la dernière version valide versionnée pour ne pas vider le site.
  if (!all.length) {
    console.error('Aucun marché collecté — conservation du data.json existant.');
    process.exitCode = 1;   // le workflow passe au rouge (et redéploie le dernier bon fichier)
    return;
  }
  // Une seule source en panne : on n'écrit pas un fichier amputé d'une source, on garde le dernier
  // bon data.json (la page affiche sa date) et on sort en erreur → workflow rouge.
  if (!sources.kalshi.ok || !sources.manifold.ok) {
    console.error('Source en panne — conservation du data.json existant.', JSON.stringify(sources));
    process.exitCode = 1;
    return;
  }
  const generated = new Date().toISOString();
  const prev = previous(generated);
  const out = { generated, sources, all };
  if (prev) { out.prev = prev; out.moves = moves(all, prev); }
  writeFileSync('data.json', JSON.stringify(out));
  console.log('Wrote data.json —', all.length, 'markets', JSON.stringify(sources));
}
// ---- « ce qui a bougé » : comparaison avec le data.json COMMITÉ un jour précédent ----
// Le data.json lu ici est celui du dépôt (dernier commit). S'il date d'un jour précédent, il devient la
// référence ; s'il est déjà d'aujourd'hui, on reprend la référence qu'il porte (commitée avec lui).
// Clés stables : ticker Kalshi, URL Manifold. Polymarket n'est pas dans data.json (collecté côté navigateur).
function okey(it, o) { return it.s === 'kalshi' ? (o.tk ? 'k|' + o.tk : null) : it.s === 'manifold' ? (it.u ? 'm|' + it.u : null) : null; }
function snapshot(all) { const p = {}; for (const it of all || []) for (const o of it.o || []) { const k = okey(it, o); if (k) p[k] = o.p; } return p; }
function previous(generated) {
  let old = null; try { old = JSON.parse(readFileSync('data.json', 'utf8')); } catch { return null; }
  if (!old || !old.generated) return null;
  if (old.generated.slice(0, 10) < generated.slice(0, 10)) return { date: old.generated, p: snapshot(old.all) };
  return old.prev && old.prev.p ? old.prev : null;
}
function moves(all, prev) {
  const out = [], seen = new Set();
  for (const it of all) for (const o of it.o || []) {
    const k = okey(it, o); if (!k || !(k in prev.p)) continue;
    const d = r4(o.p - prev.p[k]); if (Math.abs(d) < 0.02) continue;      // < 2 points : bruit
    const id = k + '|' + it.c; if (seen.has(id)) continue; seen.add(id);
    out.push({ s: it.s, t: it.t, u: it.u, c: it.c, l: o.l, p: o.p, d });
  }
  out.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const per = {}; return out.filter(m => (per[m.c] = (per[m.c] || 0) + 1) <= 12);   // 12 par onglet au plus
}
run().catch(e => { console.error(e); process.exit(1); });
