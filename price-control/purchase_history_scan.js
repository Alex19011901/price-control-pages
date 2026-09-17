const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = process.env.DOCSINBOX_STORAGE_STATE;
const OUT = process.argv[2] || path.join(__dirname, 'purchase_history.json');
const START_ISO = '2026-01-01';
const SUPPLIER_NEEDLE = 'парадис экзотика';
const WORKERS = 4;

function clean(v){return String(v ?? '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
function ruToIso(s){const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';}
function round2(v){return Math.round((Number(v)+Number.EPSILON)*100)/100;}
function compareDocVersion(a,b){
  const av=Number.isFinite(a.version)?a.version:null;
  const bv=Number.isFinite(b.version)?b.version:null;
  if(av!==null&&bv!==null&&av!==bv)return av-bv;
  if(av!==null&&bv===null)return 1;
  if(av===null&&bv!==null)return -1;
  return String(a.publicId||'').localeCompare(String(b.publicId||''));
}

(async()=>{
  if(!AUTH)throw new Error('DOCSINBOX_AUTH_PATH_MISSING');
  if(!fs.existsSync(AUTH))throw new Error('DOCSINBOX_AUTH_MISSING');

  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({storageState:AUTH});
  const seed=await context.newPage();
  await seed.goto('https://dxbx.ru/fe/supplies?offset=0',{waitUntil:'domcontentloaded',timeout:60000});

  const supplies=await seed.evaluate(async({startIso,supplierNeedle})=>{
    const r2i=s=>{const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';};
    const all=[];let offset=0;
    for(let pageNo=0;pageNo<1000;pageNo++){
      const r=await fetch('/api/front/supplies?offset='+offset,{credentials:'include'});
      if(!r.ok)throw new Error('supplies HTTP '+r.status);
      const j=await r.json();const rows=j.data||[];
      if(!rows.length)break;
      all.push(...rows);
      const isos=rows.map(x=>r2i(x.date)).filter(Boolean);
      if(isos.length&&isos.every(x=>x<startIso))break;
      offset+=rows.length;
      if(rows.length<10)break;
    }
    return all.filter(s=>
      r2i(s.date)>=startIso &&
      String(s.supplier?.name||'').toLowerCase().includes(supplierNeedle)
    ).map(s=>({
      date:s.date,
      supplyNumber:s.number||'',
      supplier:s.supplier?.name||'',
      invoices:(s.invoices||[]).map(i=>({number:i.number||'',publicId:i.publicId||'',link:i.link||''}))
    }));
  },{startIso:START_ISO,supplierNeedle:SUPPLIER_NEEDLE});
  await seed.close();

  const tasks=[];
  for(const supply of supplies)for(const inv of supply.invoices||[])if(inv.link)tasks.push({supply,inv});
  console.log('Paradis supplies in range:',supplies.length,'invoice tasks:',tasks.length);

  const docs=[];const errors=[];let nextIndex=0;let scanned=0;

  async function readInvoice(page,task){
    const {supply,inv}=task;
    await page.goto(inv.link,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForSelector('table',{timeout:8000}).catch(()=>null);
    const detail=await page.evaluate(()=>{
      const c=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
      const n=v=>{const z=Number(c(v).replace(/\s/g,'').replace(',','.').replace(/[^\d.-]/g,''));return Number.isFinite(z)?z:null;};
      const heading=[...document.querySelectorAll('h1,h2,h3,h4')].find(x=>/Накладная №/i.test(c(x.textContent)));
      const table=[...document.querySelectorAll('table')].find(t=>{const h=[...t.querySelectorAll('th')].map(x=>c(x.textContent));return h.includes('Сумма')&&h.includes('Кол.')&&h.some(x=>/Номенклатура/i.test(x));});
      if(!table)return{title:c(heading?.textContent),items:[]};
      const items=[];
      for(const tr of table.querySelectorAll('tr')){
        const td=[...tr.querySelectorAll(':scope > td')];
        if(td.length<5)continue;
        const line=n(td[0]?.textContent),sum=n(td[1]?.textContent),count=n(td[2]?.textContent),unit=c(td[3]?.textContent),name=c(td[4]?.textContent);
        if(line===null||sum===null||count===null||!unit||!name)continue;
        items.push({line,name,qty:count,unit,sum,fact:count?Math.round((sum/count+Number.EPSILON)*100)/100:null});
      }
      return{title:c(heading?.textContent),items};
    });
    if(!detail.items.length)throw new Error('INVOICE_ROWS_NOT_FOUND');
    const vm=String(detail.title||'').match(/\(вер\.(\d+)\)/i);
    docs.push({
      date:supply.date,
      supplier:supply.supplier,
      invoice:inv.number||supply.supplyNumber,
      publicId:inv.publicId,
      version:vm?Number(vm[1]):null,
      items:detail.items
    });
  }

  async function worker(no){
    const page=await context.newPage();
    while(true){
      const i=nextIndex++;if(i>=tasks.length)break;
      const task=tasks[i];let ok=false,lastErr=null;
      for(let attempt=1;attempt<=2&&!ok;attempt++){
        try{await readInvoice(page,task);ok=true;}catch(err){lastErr=err;if(attempt<2)await page.waitForTimeout(500);}
      }
      if(!ok)errors.push({date:task.supply.date,invoice:task.inv.number||task.supply.supplyNumber,publicId:task.inv.publicId,error:String(lastErr&&(lastErr.message||lastErr)||'UNKNOWN')});
      scanned+=1;if(scanned%25===0||scanned===tasks.length)console.log('Progress',scanned+'/'+tasks.length,'errors',errors.length,'worker',no);
    }
    await page.close();
  }

  await Promise.all(Array.from({length:Math.max(1,Math.min(WORKERS,tasks.length||1))},(_,i)=>worker(i+1)));
  await browser.close();

  const latestByNumber=new Map();
  for(const d of docs){
    const prev=latestByNumber.get(d.invoice);
    if(!prev||compareDocVersion(d,prev)>0)latestByNumber.set(d.invoice,d);
  }

  const invoices=[...latestByNumber.values()]
    .sort((a,b)=>ruToIso(a.date).localeCompare(ruToIso(b.date))||String(a.invoice).localeCompare(String(b.invoice),'ru'))
    .map(d=>({
      date:d.date,
      invoice:d.invoice,
      version:d.version,
      items:d.items.map(x=>({line:x.line,name:x.name,qty:round2(x.qty),unit:x.unit,sum:round2(x.sum),fact:x.fact}))
    }));

  const payload={
    generatedAt:new Date().toISOString(),
    start:'01.01.2026',
    source:'DocsInBox',
    supplier:'Парадис Экзотика',
    suppliesScanned:supplies.length,
    invoicesScanned:scanned,
    activeInvoices:invoices.length,
    invoiceErrors:errors.length,
    errors,
    invoices
  };
  fs.writeFileSync(OUT,JSON.stringify(payload,null,2),'utf8');
  console.log(JSON.stringify({generatedAt:payload.generatedAt,suppliesScanned:payload.suppliesScanned,invoicesScanned:payload.invoicesScanned,activeInvoices:payload.activeInvoices,invoiceErrors:payload.invoiceErrors},null,2));
  if(errors.length)throw new Error('INVOICE_SCAN_ERRORS:'+errors.length);
})().catch(err=>{console.error(err&&(err.stack||err.message)||err);process.exit(1);});
