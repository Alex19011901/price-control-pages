const fs = require('fs');
const path = require('path');

const TRACKED_PATH = process.argv[2] || path.join(__dirname, 'tracked_products.json');
const AUDIT_PATH = process.argv[3] || path.join(__dirname, 'courage_audit.json');

const NAMES = new Set([
  '!Огурцы Кураж,кг (2087874)',
  'Огурцы Кураж ,кг (00-00000168)',
  'Огурцы Кураж выс/кат ,кг (00-00000074)',
  'Огурцы Кураж короткоплодные Стандарт,кг (00-00009388)',
  'Огурцы Кураж Тепличные,кг (00-00001354)',
  'Огурцы Кураж,кг (00-00000168)',
  'Огурцы Кураж,кг (2087874)',
  'Огурцы Кураж,кг (УТ000007874)'
]);

function ruToIso(s){
  const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function round2(v){return Math.round((Number(v)+Number.EPSILON)*100)/100;}
function round1(v){return Math.round((Number(v)+Number.EPSILON)*10)/10;}

const tracked = JSON.parse(fs.readFileSync(TRACKED_PATH, 'utf8'));
const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
if (!Array.isArray(tracked.products)) tracked.products = [];
if (!Array.isArray(audit.matches)) throw new Error('COURAGE_AUDIT_MATCHES_MISSING');

const rows = audit.matches.filter(r => NAMES.has(String(r.name || '')) && String(r.unit || '').trim() === 'кг');
const groups = new Map();
for (const r of rows) {
  const key = [r.date, r.supplier, r.invoice].join('\u0000');
  if (!groups.has(key)) {
    groups.set(key, {date:r.date, supplier:r.supplier, invoice:r.invoice, qty:0, sum:0, sourceNames:new Set()});
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
    sourceNames: [...g.sourceNames].sort((a,b)=>a.localeCompare(b,'ru'))
  }))
  .sort((a,b)=>a.dateIso.localeCompare(b.dateIso) || String(a.invoice).localeCompare(String(b.invoice),'ru') || String(a.supplier).localeCompare(String(b.supplier),'ru'));

const base = points[0]?.fact || null;
for (const p of points) p.index = base ? round1(p.fact / base * 100) : null;

const product = {
  key: 'courage_cucumber',
  label: 'Огурцы Кураж',
  color: '#ffae42',
  base: points[0] ? {date:points[0].date, supplier:points[0].supplier, invoice:points[0].invoice, fact:points[0].fact} : null,
  points,
  aliases: [...NAMES]
};

tracked.products = tracked.products.filter(p => p.key !== product.key);
tracked.products.push(product);
tracked.generatedAt = audit.generatedAt || tracked.generatedAt || new Date().toISOString();
tracked.start = tracked.start || audit.start || '01.01.2026';
tracked.source = 'DocsInBox';

fs.writeFileSync(TRACKED_PATH, JSON.stringify(tracked, null, 2), 'utf8');
console.log(JSON.stringify({key:product.key, points:points.length, base:product.base, last:points[points.length-1] || null}, null, 2));
