const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = process.env.DOCSINBOX_STORAGE_STATE;
const SUPPLIER = 'парадис экзотика';
const TARGET_ISO = process.env.TARGET_ISO || new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

  const selected = await page.evaluate(async ({supplierNeedle, targetIso}) => {
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
      if (isos.length && isos.every(x => x < targetIso)) break;
      offset += rows.length;
      if (rows.length < 10) break;
    }
    return all.filter(s =>
      ruToIso(s.date) === targetIso &&
      String(s.supplier?.name || '').toLowerCase().includes(supplierNeedle)
    ).map(s => ({
      date: s.date,
      number: s.number,
      invoices: (s.invoices || []).map(i => ({ number: i.number, publicId: i.publicId, link: i.link }))
    }));
  }, { supplierNeedle: SUPPLIER, targetIso: TARGET_ISO });

  const docs = [];
  for (const supply of selected) {
    for (const inv of (supply.invoices || [])) {
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
      docs.push({ date: supply.date, number: inv.number || supply.number, publicId: inv.publicId, version: vm ? Number(vm[1]) : null, title: detail.title, items: detail.items });
    }
  }
  await browser.close();

  const latest = new Map();
  for (const d of docs) {
    const prev = latest.get(d.number);
    if (!prev || (d.version !== null && (prev.version === null || d.version > prev.version))) latest.set(d.number, d);
  }
  const result = { targetIso: TARGET_ISO, supplier: 'Парадис Экзотика', invoices: [...latest.values()] };
  console.log('DXBX_TODAY_JSON=' + JSON.stringify(result));
})().catch(err => {
  console.error(err && (err.stack || err.message) || err);
  process.exit(1);
});
