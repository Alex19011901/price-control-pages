const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = process.env.DOCSINBOX_STORAGE_STATE;
const SUPPLIER = String(process.env.DXBX_SUPPLIER || 'парадис экзотика').trim().toLowerCase() === 'all' ? '' : 'парадис экзотика';
const TARGET_ISO = process.env.TARGET_ISO || new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const START_ISO = process.env.DXBX_START_ISO || TARGET_ISO;
const END_ISO = process.env.DXBX_END_ISO || TARGET_ISO;
if (!/^\d{4}-\d{2}-\d{2}$/.test(START_ISO) || !/^\d{4}-\d{2}-\d{2}$/.test(END_ISO) || START_ISO > END_ISO) throw new Error('INVALID_INSPECT_DATE_RANGE');

function ruToIso(s) {
  const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

(async () => {
  if (!AUTH || !fs.existsSync(AUTH)) throw new Error('DOCSINBOX_AUTH_MISSING');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH });
  const page = await context.newPage();
  await page.goto('https://dxbx.ru/fe/supplies?offset=0', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const selected = await page.evaluate(async ({supplierNeedle, startIso, endIso}) => {
    const ruToIso = s => {
      const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
    };
    const all = [];
    let offset = 0;
    for (let pageNo = 0; pageNo < 50; pageNo++) {
      const r = await fetch('/api/front/supplies?offset=' + offset, { credentials: 'include' });
      if (!r.ok) throw new Error('supplies HTTP ' + r.status);
      const j = await r.json();
      const rows = j.data || [];
      all.push(...rows);
      if (!rows.length) break;
      const isos = rows.map(x => ruToIso(x.date)).filter(Boolean);
      if (isos.length && isos.every(x => x < startIso)) break;
      offset += rows.length;
      if (rows.length < 10) break;
    }
    return all.filter(s =>
      ruToIso(s.date) >= startIso && ruToIso(s.date) <= endIso &&
      String(s.supplier?.name || '').toLowerCase().includes(supplierNeedle)
    ).map(s => ({
      date: s.date,
      number: s.number,
      supplier: String(s.supplier?.name || ''),
      invoices: (s.invoices || []).map(i => ({ number: i.number, publicId: i.publicId, link: i.link }))
    }));
  }, { supplierNeedle: SUPPLIER, startIso: START_ISO, endIso: END_ISO });

  const docs = [];
  for (const supply of selected) {
    for (const inv of (supply.invoices || [])) {
      try {
      if (!inv.link) throw new Error('INVOICE_LINK_MISSING');
      await page.goto(inv.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => {
        const clean = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const heading = [...document.querySelectorAll('h1,h2,h3,h4')].find(x => /Накладная №/i.test(clean(x.textContent)));
        const table = [...document.querySelectorAll('table')].find(t => {
          const h = [...t.querySelectorAll('th')].map(x => clean(x.textContent));
          return h.includes('Номер') && h.includes('Сумма') && h.includes('Кол.') && h.some(x => /Номенклатура/i.test(x));
        });
        return Boolean(heading && table && [...table.querySelectorAll('tr')].some(tr => tr.querySelectorAll(':scope > td').length >= 5));
      }, undefined, { timeout: 30000 });

      const detail = await page.evaluate(() => {
        const clean = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const num = v => {
          const z = Number(clean(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
          return Number.isFinite(z) ? z : null;
        };
        const heading = [...document.querySelectorAll('h1,h2,h3,h4')].find(x => /Накладная №/i.test(clean(x.textContent)));
        const table = [...document.querySelectorAll('table')].find(t => {
          const h = [...t.querySelectorAll('th')].map(x => clean(x.textContent));
          return h.includes('Номер') && h.includes('Сумма') && h.includes('Кол.') && h.some(x => /Номенклатура/i.test(x));
        });
        const items = [];
        if (table) {
          for (const tr of table.querySelectorAll('tr')) {
            const td = [...tr.querySelectorAll(':scope > td')];
            if (td.length < 5) continue;
            const line = num(td[0]?.textContent);
            const sum = num(td[1]?.textContent);
            const count = num(td[2]?.textContent);
            const unit = clean(td[3]?.textContent);
            const name = clean(td[4]?.textContent);
            if (line === null || sum === null || count === null || !unit || !name) continue;
            items.push({ line, name, count, unit, sum });
          }
        }
        return { title: clean(heading?.textContent), items };
      });
      const vm = detail.title.match(/\(вер\.(\d+)\)/i);
      docs.push({ date: supply.date, supplier: supply.supplier, number: inv.number || supply.number, publicId: inv.publicId, version: vm ? Number(vm[1]) : null, title: detail.title, items: detail.items });
      } catch (err) {
        console.log('DXBX_TODAY_UNREADABLE supplier=' + supply.supplier + ' number=' + (inv.number || supply.number) + ' reason=' + String(err?.message || err).split('\n')[0].slice(0,100));
      }
    }
  }
  await browser.close();

  const latest = new Map();
  for (const d of docs) {
    const key = d.supplier + '|' + d.number;
    const prev = latest.get(key);
    if (!prev || (d.version !== null && (prev.version === null || d.version > prev.version))) latest.set(key, d);
  }
  const invoices = [...latest.values()];
  const bySupplier = new Map();
  let totalAmount = 0;
  for (const invoice of invoices) {
    const amount = Math.round(invoice.items.reduce((sum, item) => sum + item.sum, 0) * 100) / 100;
    const supplier = invoice.supplier || 'Не указан';
    const previous = bySupplier.get(supplier) || {invoices: 0, rows: 0, amount: 0};
    previous.invoices++;
    previous.rows += invoice.items.length;
    previous.amount = Math.round((previous.amount + amount) * 100) / 100;
    bySupplier.set(supplier, previous);
    totalAmount = Math.round((totalAmount + amount) * 100) / 100;
    console.log('DXBX_DAY_INVOICE supplier=' + supplier + ' number=' + invoice.number + ' rows=' + invoice.items.length + ' amount=' + amount.toFixed(2));
  }
  console.log('DXBX_DAY_TOTAL date=' + TARGET_ISO + ' selectedSupplies=' + selected.length + ' readableInvoices=' + invoices.length + ' amount=' + totalAmount.toFixed(2));
  for (const [supplier, data] of bySupplier) {
    console.log('DXBX_DAY_SUPPLIER supplier=' + supplier + ' invoices=' + data.invoices + ' rows=' + data.rows + ' amount=' + data.amount.toFixed(2));
  }
  const result = { targetIso: TARGET_ISO, startIso: START_ISO, endIso: END_ISO, supplier: SUPPLIER || 'ALL', selectedSupplies: selected.length, invoices };
  console.log('DXBX_AUDIT_RANGE start=' + START_ISO + ' end=' + END_ISO + ' supplier=' + (SUPPLIER || 'ALL') + ' selected=' + selected.length + ' invoices=' + invoices.length);
  for (const item of invoices) console.log('DXBX_AUDIT_INVOICE date=' + item.date + ' number=' + item.number + ' rows=' + item.items.length + ' supplier=' + item.supplier);
  console.log('DXBX_AUDIT_B64=' + Buffer.from(JSON.stringify(result)).toString('base64'));
  console.log('DXBX_TODAY_JSON=' + JSON.stringify(result));
})().catch(err => {
  console.error(err && (err.stack || err.message) || err);
  process.exit(1);
});
