// Baromètre des paris — collecteur de cotes.
// Tourne sur GitHub Actions (runners US) : pas de blocage DNS français, pas de CORS,
// donc on appelle les API directement. Écrit data.json à la racine du repo.
// Node 18+ (fetch global). Aucune dépendance.

import { writeFileSync } from 'node:fs';

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
function kPrice(m){ for(const k of ['last_price_dollars','yes_ask_dollars','yes_bid_dollars']){ const v=m[k]; if(v!=null&&isFinite(+v)&&+v>0) return +v; } return null; }
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
    const buckets = {}; CATS.forEach(c => buckets[c.key] = []);
    let cursor = null, pages = 0, seen = 0;
    do {
      const data = await getJSON(base + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      const evs = data.events || []; seen += evs.length;
      for (const e of evs) {
        const it = kItem(e); if (!it) continue;
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
    for (const c of CATS) {
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
    return;
  }
  const out = { generated: new Date().toISOString(), sources, all };
  writeFileSync('data.json', JSON.stringify(out));
  console.log('Wrote data.json —', all.length, 'markets', JSON.stringify(sources));
}
run().catch(e => { console.error(e); process.exit(1); });
