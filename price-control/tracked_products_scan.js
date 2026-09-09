const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = process.env.DOCSINBOX_STORAGE_STATE;
const OUT = process.argv[2] || path.join(__dirname, 'tracked_products_audit.json');
const START_ISO = '2026-01-01';
const WORKERS = 4;
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
function compareDocVersion(a, b) {
  const av = Number.isFinite(a.version) ? a.version : null;
  const bv = Number.isFinite(b.version) ? b.version : null;
  if (av !== null && bv !== null && av !== bv) return av - bv;
  if (av !== null && bv === null) return 1;
  if (av === null && bv !== null) return -1;
  return String(a.publicId || '').localeCompare(String(b.publicId || ''));
}

(async () => {
  if (!AUTH) throw new Error('DOCSINBOX_AUTH_PATH_MISSING');
  if (!fs.existsSync(AUTH)) throw new Error('DOCSINBOX_AUTH_MISSING');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH });
  const seedPage = await context.newPage();
  await seedPage.goto('https://dxbx.ru/fe/supplies?offset=0', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const supplies = await seedPage.evaluate(async ({ startIso }) => {
    const ruToIsoLocal = s => {
      const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
    };
    const all = [];
    let offset = 0;
    for (let pageNo = 0; pageNo < 1000; pageNo++) {
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
  await seedPage.close();

  const tasks = [];
  for (const supply of supplies) {
    for (const inv of supply.invoices || []) {
      if (!inv.link) continue;
      tasks.push({ supply, inv });
    }
  }

  console.log('Supplies in range:', supplies.length, 'invoice tasks:', tasks.length);

  const docs = [];
  const candidates = [];
  const errors = [];
  let nextIndex = 0;
  let scanned = 0;

  async function readInvoice(page, task) {
    const { supply, inv } = task;
    await page.goto(inv.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 8000 }).catch(() => null);
    const detail = await page.evaluate(() => {
      const cleanLocal = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const numLocal = v => {
        const z = Number(cleanLocal(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
        return Number.isFinite(z) ? z : null;
      };
      const heading = [...document.querySelectorAll('h1,h2,h3,h4')]
        .find(x => /Накладная №/i.test(cleanLocal(x.textContent)));
      const table = [...document.querySelectorAll('table')].find(t => {
        const h = [...t.querySelectorAll('th')].map(x => cleanLocal(x.textContent));
        return h.includes('Сумма') && h.includes('Кол.') && h.some(x => /Номенклатура/i.test(x));
      });
      if (!table) return { title: cleanLocal(heading?.textContent), items: [], noFoodTable: true };
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
      return { title: cleanLocal(heading?.textContent), items, noFoodTable: false };
    });

    const vm = String(detail.title || '').match(/\(вер\.(\d+)\)/i);
    const version = vm ? Number(vm[1]) : null;
    const doc = {
      date: supply.date,
      supplier: supply.supplier,
      invoice: inv.number || supply.supplyNumber,
      publicId: inv.publicId,
      version,
      title: detail.title,
      noFoodTable: Boolean(detail.noFoodTable)
    };
    docs.push(doc);

    for (const item of detail.items || []) {
      const productKeys = classify(item.name);
      if (!productKeys.length) continue;
      const fact = item.count ? Math.round((item.sum / item.count + Number.EPSILON) * 100) / 100 : null;
      candidates.push({
        productKeys,
        date: supply.date,
        supplier: supply.supplier,
        invoice: doc.invoice,
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
  }

  async function worker(workerNo) {
    const page = await context.newPage();
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) break;
      const task = tasks[index];
      let ok = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        try {
          await readInvoice(page, task);
          ok = true;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) await page.waitForTimeout(500);
        }
      }
      if (!ok) {
        errors.push({
          date: task.supply.date,
          supplier: task.supply.supplier,
          invoice: task.inv.number || task.supply.supplyNumber,
          publicId: task.inv.publicId,
          error: String(lastErr && (lastErr.message || lastErr) || 'UNKNOWN')
        });
      }
      scanned += 1;
      if (scanned % 25 === 0 || scanned === tasks.length) {
        console.log('Progress:', scanned + '/' + tasks.length, 'matches:', candidates.length, 'errors:', errors.length, 'worker:', workerNo);
      }
    }
    await page.close();
  }

  const workerCount = Math.max(1, Math.min(WORKERS, tasks.length || 1));
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));
  await browser.close();

  const latestByNumber = new Map();
  for (const d of docs) {
    const prev = latestByNumber.get(d.invoice);
    if (!prev || compareDocVersion(d, prev) > 0) latestByNumber.set(d.invoice, d);
  }

  const active = candidates.filter(c => {
    const latest = latestByNumber.get(c.invoice);
    if (!latest) return true;
    if (latest.publicId && c.publicId) return latest.publicId === c.publicId;
    if (Number.isFinite(latest.version) && Number.isFinite(c.version)) return latest.version === c.version;
    return true;
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
    invoicesScanned: scanned,
    invoiceErrors: errors.length,
    errors,
    summary,
    matches: active
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify({
    start: payload.start,
    suppliesScanned: payload.suppliesScanned,
    invoicesScanned: payload.invoicesScanned,
    invoiceErrors: payload.invoiceErrors,
    summary
  }, null, 2));

  if (errors.length) throw new Error('INVOICE_SCAN_ERRORS:' + errors.length);
})().catch(err => {
  console.error(err && (err.stack || err.message) || err);
  process.exit(1);
});
