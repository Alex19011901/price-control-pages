const fs = require('fs');
const path = require('path');

const INPUT = process.argv[2] || path.join(__dirname, 'tracked_products_audit.json');
const OUTPUT = process.argv[3] || path.join(__dirname, 'tracked_products.json');

const TRACKED = [
  {
    key: 'eye_muscle',
    label: 'Глазной мускул',
    color: '#7d5cff',
    names: new Set([
      'Глазной мускул вес Бразилия,кг (00000002218)',
      'Глазной мускул с/м в/у вес Фермерский Бычок (Брянск) Россия,кг (00000009014)',
      'Говядина глазной мускул б/к ~3-7кг в/у ~25кг/кор Тимашевскмясопродукт (КОР) (КОД 73170)(-18°С),кг (73170)',
      'Говядина глазной мускул б/к п/сухожил мышца ~2кг в/у Вахавяк + Беларусь (КОД 76109) (-18°С),кг (76109)',
      'Говядина глазной мускул б/к п/сухожил мышца ~2кг в/у Вахавяк + Беларусь,кг (76109)',
      'Говядина глазной мускул нар/ч бедра б/к ~2-2,6кг в/у (Eye of Round,171C) Primebeef® (КОД 19821) (-18°С),кг (19821)',
      'Говядина глазной мускул нар/ч бедра б/к ~2,7кг в/у мраморная (Eye of Round,171C) Cutsbeef™ (КОД 71639)(-18°С),кг (71639)',
      'Говядина глазной мускул нар/ч бедра б/к ~25кг/кор Plena™ SIF №3215 Бразилия (КОР) (КОД 77880) (-18°C),кг (77880)'
    ])
  },
  {
    key: 'salmon',
    label: 'Лосось',
    color: '#4ea1ff',
    names: new Set([
      'Лосось, филе н/к трим. D, охл., в/у, п/п,кг (00-00000019)',
      'Филе Лосося (сёмги) ТРИМ D 1,8-2,3 вес Чили,кг (00000004235)'
    ])
  },
  {
    key: 'eggplant',
    label: 'Баклажан',
    color: '#36d16b',
    names: new Set([
      'Баклажаны ,кг (00-00012458)',
      'Баклажаны ,кг (00000000069)',
      'Баклажаны имп. Стандарт,кг (00-00009312)',
      'Баклажаны Импорт в пленке ,кг (00-00012458)',
      'Баклажаны Импорт в пленке,кг (00-00012458)',
      'Баклажаны импорт Стандарт,кг (00-00009312)',
      'Баклажаны импортные ,кг (00-00000110)',
      'Баклажаны импортные,кг (00-00000110)',
      'Баклажаны,кг (2100069)'
    ])
  }
];

function ruToIso(s) {
  const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}
function round1(v) {
  return Math.round((Number(v) + Number.EPSILON) * 10) / 10;
}

const audit = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
if (!Array.isArray(audit.matches)) throw new Error('AUDIT_MATCHES_MISSING');

const products = [];
for (const cfg of TRACKED) {
  const rows = audit.matches.filter(r => cfg.names.has(String(r.name || '')) && String(r.unit || '').trim() === 'кг');
  const groups = new Map();

  for (const r of rows) {
    const key = [r.date, r.supplier, r.invoice].join('\u0000');
    if (!groups.has(key)) {
      groups.set(key, {
        date: r.date,
        supplier: r.supplier,
        invoice: r.invoice,
        qty: 0,
        sum: 0,
        sourceNames: new Set()
      });
    }
    const g = groups.get(key);
    g.qty += Number(r.qty || 0);
    g.sum += Number(r.sum || 0);
    g.sourceNames.add(String(r.name || ''));
  }

  const points = [...groups.values()]
    .filter(g => g.qty > 0 && g.sum > 0)
    .map(g => ({
      date: g.date,
      dateIso: ruToIso(g.date),
      supplier: g.supplier,
      invoice: g.invoice,
      qty: round2(g.qty),
      sum: round2(g.sum),
      fact: round2(g.sum / g.qty),
      sourceNames: [...g.sourceNames].sort((a,b) => a.localeCompare(b, 'ru'))
    }))
    .sort((a,b) => a.dateIso.localeCompare(b.dateIso) || String(a.invoice).localeCompare(String(b.invoice), 'ru') || String(a.supplier).localeCompare(String(b.supplier), 'ru'));

  const base = points[0]?.fact || null;
  for (const p of points) p.index = base ? round1(p.fact / base * 100) : null;

  products.push({
    key: cfg.key,
    label: cfg.label,
    color: cfg.color,
    base: points[0] ? {
      date: points[0].date,
      supplier: points[0].supplier,
      invoice: points[0].invoice,
      fact: points[0].fact
    } : null,
    points,
    aliases: [...cfg.names]
  });
}

const payload = {
  generatedAt: audit.generatedAt || new Date().toISOString(),
  start: audit.start || '01.01.2026',
  source: 'DocsInBox',
  methodology: 'First available factual purchase price for each tracked product = 100; later supply prices are indexed to that baseline. Multiple lines of the same product in one invoice are quantity-weighted.',
  products
};

fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify({
  generatedAt: payload.generatedAt,
  start: payload.start,
  counts: Object.fromEntries(products.map(p => [p.key, p.points.length])),
  bases: Object.fromEntries(products.map(p => [p.key, p.base]))
}, null, 2));
