const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = process.env.DOCSINBOX_STORAGE_STATE;
const OUT = process.argv[2] || path.join(__dirname, 'tracked_products_audit.json');
const START_ISO = '2026-01-01';
const TOKENS = [
  { key: 'eye_muscle', label: 'Глазной мускул', stems: ['глазн', 'мускул'] },
  { key: 'salmon', label: 'Лосось', stems: ['лосос'] },
  { key: 'eggplant', label: 'Баклажан', stems: ['баклаж'] }
];

function clean(v) {
  return String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function norm(v) {
  return clean(v).toLowerCase().replace(/ё/g, 'е');
}
function ruToIso(s) {
  const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function num(v) {
  const z = Number(clean(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(z) ? z : null;
}
function classify(name) {
  const n = norm(name);
  const out = [];
  for (const t of TOKENS) {
    if (t.key === 'eye_muscle') {
      if (t.stems.every(s => n.includes(s))) out.push(t.key);
    } else if (t.stems.some(s => n.includes(s))) {
      out.push(t.key);
    }
  }
  return out;
}

(async () => {
  if (!AUTH) throw new Error('DOCSINBOX_AUTH_PATH_MISSING');
  if (!fs.existsSync(AUTH)) throw new Error('DOCSINBOX_AUTH_MISSING');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH });
  const page = await context.newPage();
  await page.goto('https://dxbx.ru/fe/supplies?offset=0', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const supplies = await page.evaluate(async ({ startIso }) => {
    const ruToIsoLocal = s => {
      const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
    };
    const all = [];
    let offset = 0;
    for (let pageNo = 0; pageNo < 500; pageNo++) {
      const r = await fetch('/api/front/supplies?offset=' + offset, { credentials: 'include' });
      if (!r.ok) throw new Error('supplies HTTP ' + r.status);
      const j = await r.json();
      const rows = j.data || [];
      if (!rows.length) break;
      all.push(...rows);
      const isos = rows.map(x => ruToIsoLocal(x.date)).filter(Boolean);
      if (isos.length && isos.every(x => x < startIso)) break;
      offset += rows.length;
      if (rows.length < 10) break;
    }
    return all
      .filter(s => ruToIsoLocal(s.date) >= startIso)
      .map(s => ({
        date: s.date,
        supplyNumber: s.number || '',
        supplier: s.supplier?.name || '',
        invoices: (s.invoices || []).map(i => ({
          number: i.number || '',
          publicId: i.publicId || '',
          link: i.link || ''
        }))
      }));
  }, { startIso: START_ISO });

  const candidates = [];
  let invoicesScanned = 0;

  for (const supply of supplies) {
    for (const inv of supply.invoices || []) {
      if (!inv.link) continue;
      await page.goto(inv.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => {
        const tables = [...document.querySelectorAll('table')];
        return tables.some(t => {
          const h = [...t.querySelectorAll('th')].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim());
          return h.includes('Сумма') && h.includes('Кол.') && h.some(x => /Номенклатура/i.test(x));
        });
      }, undefined, { timeout: 30000 });

      const detail = await page.evaluate(() => {
        const cleanLocal = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const numLocal = v => {
          const z = Number(cleanLocal(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
          return Number.isFinite(z) ? z : null;
        };
        const table = [...document.querySelectorAll('table')].find(t => {
          const h = [...t.querySelectorAll('th')].map(x => cleanLocal(x.textContent));
          return h.includes('Сумма') && h.includes('Кол.') && h.some(x => /Номенклатура/i.test(x));
        });
        const heading = [...document.querySelectorAll('h1,h2,h3,h4')]
          .find(x => /Накладная №/i.test(cleanLocal(x.textContent)));
        if (!table) return { title: cleanLocal(heading?.textContent), items: [] };
        const items = [];
        for (const tr of table.querySelectorAll('tr')) {
          const td = [...tr.querySelectorAll(':scope > td')];
          if (td.length < 5) continue;
          const line = numLocal(td[0]?.textContent);
          const sum = numLocal(td[1]?.textContent);
          const count = numLocal(td[2]?.textContent);
          const unit = cleanLocal(td[3]?.textContent);
          const name = cleanLocal(td[4]?.textContent);
          if (line === null || sum === null || count === null || !unit || !name) continue;
          items.push({ line, sum, count, unit, name });
        }
        return { title: cleanLocal(heading?.textContent), items };
      });

      invoicesScanned += 1;
      const vm = detail.title.match(/\(вер\.(\d+)\)/i);
      const version = vm ? Number(vm[1]) : null;
      for (const item of detail.items) {
        const productKeys = classify(item.name);
        if (!productKeys.length) continue;
        const fact = item.count ? Math.round((item.sum / item.count + Number.EPSILON) * 100) / 100 : null;
        candidates.push({
          productKeys,
          date: supply.date,
          supplier: supply.supplier,
          invoice: inv.number || supply.supplyNumber,
          publicId: inv.publicId,
          version,
          line: item.line,
          name: item.name,
          unit: item.unit,
          qty: item.count,
          sum: item.sum,
          fact
        });
      }
      console.log('Scanned', supply.date, inv.number || supply.supplyNumber, 'matches', candidates.length);
    }
  }

  await browser.close();

  // Keep only the latest numeric version of each invoice number.
  const latestVersion = new Map();
  for (const c of candidates) {
    const prev = latestVersion.get(c.invoice);
    if (prev == null || (c.version != null && c.version > prev)) latestVersion.set(c.invoice, c.version);
  }
  const active = candidates.filter(c => {
    const latest = latestVersion.get(c.invoice);
    return latest == null || c.version == null || c.version === latest;
  });

  active.sort((a, b) => {
    const d = ruToIso(a.date).localeCompare(ruToIso(b.date));
    if (d) return d;
    const i = String(a.invoice).localeCompare(String(b.invoice), 'ru');
    if (i) return i;
    return Number(a.line || 0) - Number(b.line || 0);
  });

  const summary = {};
  for (const t of TOKENS) {
    const rows = active.filter(x => x.productKeys.includes(t.key));
    summary[t.key] = {
      label: t.label,
      rows: rows.length,
      invoices: new Set(rows.map(x => x.invoice)).size,
      exactNames: [...new Set(rows.map(x => `${x.name} | ${x.unit}`))].sort((a,b) => a.localeCompare(b, 'ru')),
      suppliers: [...new Set(rows.map(x => x.supplier))].sort((a,b) => a.localeCompare(b, 'ru')),
      firstDate: rows[0]?.date || null,
      lastDate: rows[rows.length - 1]?.date || null
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    start: '01.01.2026',
    suppliesScanned: supplies.length,
    invoicesScanned,
    summary,
    matches: active
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify({ start: payload.start, suppliesScanned: payload.suppliesScanned, invoicesScanned, summary }, null, 2));
})().catch(err => {
  console.error(err && (err.stack || err.message) || err);
  process.exit(1);
});
