'use strict';
// Read-only, all-supplier DocsInBox Mix scan. Keeps only the 30 selected product families.
// Incremental updates re-read 45 days and retain earlier verified matches.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const {classify,PRODUCTS,iso,round2,norm}=require('./mix_catalog');
const AUTH=process.env.DOCSINBOX_STORAGE_STATE;
const OUT=process.argv[2]||path.join(__dirname,'mix_receipts.json');
const MIN_DATE='2026-01-01';
const RECHECK_DAYS=45;
const CATALOG_REVISION=5; // Re-index beef/veal cheek aliases from all historical DocsInBox invoices.
const WORKERS=5;
if(!AUTH||!fs.existsSync(AUTH))throw new Error('DOCSINBOX_AUTH_MISSING');
const old=fs.existsSync(OUT)?JSON.parse(fs.readFileSync(OUT,'utf8')):null;
function pastDays(isoDate,days){
  return new Date(Date.parse(isoDate+'T12:00:00Z')-days*86400000).toISOString().slice(0,10);
}
const START=(old?.catalogRevision===CATALOG_REVISION&&old?.lastSupplyIso)?([MIN_DATE,pastDays(old.lastSupplyIso,RECHECK_DAYS)].sort().at(-1)):MIN_DATE;
function versionOrder(a,b){
  const av=Number.isFinite(a.version)?a.version:-1;
  const bv=Number.isFinite(b.version)?b.version:-1;
  return av-bv || String(a.publicId||'').localeCompare(String(b.publicId||''));
}
function clean(s){return String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
function num(s){
  const t=clean(s).replace(/\s/g,'').replace(',','.').replace(/[^\d.-]/g,'');
  const x=Number(t);
  return t&&Number.isFinite(x)?x:null;
}
(async()=>{
  const browser=await chromium.launch({
    headless:true,
    ...(process.env.MIX_CHROME_EXECUTABLE?{executablePath:process.env.MIX_CHROME_EXECUTABLE}:{})
  });
  const context=await browser.newContext({storageState:AUTH});
  try{
    const seed=await context.newPage();
    await seed.goto('https://dxbx.ru/fe/supplies?offset=0',{waitUntil:'domcontentloaded',timeout:60000});
    const supplies=await seed.evaluate(async(startIso)=>{
      const toIso=s=>{const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:'';};
      const out=[];let offset=0;
      for(let pageNo=0;pageNo<1000;pageNo++){
        const response=await fetch('/api/front/supplies?offset='+offset,{credentials:'include'});
        if(!response.ok)throw new Error('MIX_SUPPLIES_HTTP_'+response.status);
        const json=await response.json(),rows=json.data||[];
        if(!rows.length)break;
        out.push(...rows);
        const dates=rows.map(r=>toIso(r.date)).filter(Boolean);
        if(dates.length&&dates.every(d=>d<startIso))break;
        offset+=rows.length;
        if(rows.length<10)break;
        if(pageNo===999)throw new Error('MIX_SUPPLIES_PAGINATION_LIMIT');
      }
      return out.filter(s=>toIso(s.date)>=startIso)
        .map(s=>({date:s.date,supplier:cleanName(s.supplier?.name||'')||'Не указан',
          number:s.number||'',
          invoices:(s.invoices||[]).map(i=>({number:i.number||'',link:i.link||'',publicId:i.publicId||''}))}));
      function cleanName(s){return String(s).replace(/\s+/g,' ').trim();}
    },START);
    await seed.close();
    const tasks=[];
    for(const supply of supplies){
      for(const invoice of supply.invoices){
        if(!invoice.link)throw new Error('MIX_INVOICE_LINK_MISSING:'+invoice.number);
        tasks.push({supply,invoice});
      }
    }
    console.log('MIX_SCAN start='+START+' supplies='+supplies.length+' invoices='+tasks.length);
    const docs=[],errors=[],nonItemDocs=[],temporaryAish19=[];
    let next=0,scanned=0;
    async function parse(page,task){
      const {supply,invoice}=task;
      const link=String(invoice.link||'');
      if(!/^https:\/\/dxbx\.ru\//i.test(link)&&!link.startsWith('/'))throw new Error('MIX_UNTRUSTED_INVOICE_LINK');
      await page.goto(link.startsWith('/')?'https://dxbx.ru'+link:link,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>{
        const c=s=>String(s||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
        const table=[...document.querySelectorAll('table')].find(t=>{
          const heads=[...t.querySelectorAll('th')].map(x=>c(x.textContent));
          return heads.includes('Сумма')&&heads.includes('Кол.')&&heads.some(x=>/Номенклатура/i.test(x));
        });
        return table&&[...table.querySelectorAll('tr')].some(tr=>tr.querySelectorAll(':scope > td').length>=5);
      },undefined,{timeout:30000});
      const detail=await page.evaluate(()=>{
        const c=s=>String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
        const n=s=>{const v=c(s).replace(/\s/g,'').replace(',','.').replace(/[^\d.-]/g,'');return v&&Number.isFinite(Number(v))?Number(v):null;};
        const title=c([...document.querySelectorAll('h1,h2,h3,h4')].find(x=>/Накладная №/i.test(c(x.textContent)))?.textContent);
        const table=[...document.querySelectorAll('table')].find(t=>{
          const h=[...t.querySelectorAll('th')].map(x=>c(x.textContent));
          return h.includes('Сумма')&&h.includes('Кол.')&&h.some(x=>/Номенклатура/i.test(x));
        });
        const rows=[];
        for(const tr of table.querySelectorAll('tr')){
          const td=[...tr.querySelectorAll(':scope > td')];
          if(td.length<5)continue;
          const line=n(td[0].textContent),sum=n(td[1].textContent),qty=n(td[2].textContent),unit=c(td[3].textContent),name=c(td[4].textContent);
          if(line==null||sum==null||qty==null||!unit||!name)continue;
          rows.push({line,name,unit,qty,sum});
        }
        return{title,rows};
      });
      if(!detail.rows.length)throw new Error('MIX_NO_INVOICE_ROWS');
      if(supply.date==='19.11.2026'&&/айш гарден/i.test(supply.supplier.toLowerCase())) temporaryAish19.push({date:supply.date,supplier:supply.supplier,invoice:invoice.number||supply.number,items:detail.rows});
      const version=detail.title.match(/\(вер\.(\d+)\)/i);
      const items=[];
      for(const row of detail.rows){
        const match=classify(row.name);
        if(!match)continue;
        items.push({...row,productId:match.id});
      }
      docs.push({
        date:supply.date,supplier:supply.supplier,
        invoice:invoice.number||supply.number,version:version?Number(version[1]):-1,
        publicId:invoice.publicId,items
      });
    }
    async function worker(no){
      const page=await context.newPage();
      while(true){
        const i=next++;if(i>=tasks.length)break;
        const task=tasks[i];let error=null;
        for(let attempt=0;attempt<2;attempt++){
          try{await parse(page,task);error=null;break;}
          catch(err){error=err;if(attempt===0)await page.waitForTimeout(400);}
        }
        if(error){
          const reason=String(error.message||error).slice(0,150);
          const item={date:task.supply.date,supplier:task.supply.supplier,invoice:task.invoice.number,error:reason};
          // Utility/service documents can have no product-table rows. Log
          // separately; never treat them as food deliveries or fabricate lines.
          if(reason==='MIX_NO_INVOICE_ROWS')nonItemDocs.push(item);
          else errors.push(item);
        }
        scanned++;
        if(scanned%100===0||scanned===tasks.length)console.log('MIX_SCAN_PROGRESS',scanned,'/',tasks.length,'errors',errors.length,'nonItemDocs',nonItemDocs.length);
      }
      await page.close();
    }
    await Promise.all(Array.from({length:Math.min(WORKERS,Math.max(1,tasks.length))},(_,i)=>worker(i+1)));
    if(errors.length)throw new Error('MIX_INVOICE_SCAN_ERRORS:'+errors.length+':'+JSON.stringify(errors.slice(0,3)));
    const newest=new Map();
    for(const d of docs){
      const key=norm(d.supplier)+'\u0000'+d.invoice+'\u0000'+d.date;
      const prev=newest.get(key);
      if(!prev||versionOrder(d,prev)>0)newest.set(key,d);
    }
    const fresh=[...newest.values()].filter(x=>x.items.length).map(d=>({
      date:d.date,supplier:d.supplier,invoice:d.invoice,version:d.version,
      items:d.items.map(x=>({line:x.line,productId:x.productId,name:x.name,unit:x.unit,qty:x.qty,sum:round2(x.sum)}))
    }));
    const preserved=(old?.invoices||[]).filter(d=>iso(d.date)<START);
    const invoices=preserved.concat(fresh).sort((a,b)=>iso(a.date).localeCompare(iso(b.date))||a.supplier.localeCompare(b.supplier,'ru')||a.invoice.localeCompare(b.invoice,'ru'));
    const keys=invoices.map(d=>norm(d.supplier)+'\0'+d.invoice+'\0'+d.date);
    if(keys.length!==new Set(keys).size)throw new Error('MIX_DUPLICATE_INVOICE');
    const lastSupplyIso=supplies.map(s=>iso(s.date)).filter(Boolean).sort().at(-1)||old?.lastSupplyIso||START;
    const payload={
      schemaVersion:1,catalogRevision:CATALOG_REVISION,generatedAt:new Date().toISOString(),from:MIN_DATE,
      scanStart:START,lastSupplyIso,
      products:PRODUCTS.length,suppliesScanned:supplies.length,invoicesScanned:scanned,
      invoiceErrors:0,nonItemDocuments:nonItemDocs.length,
      nonItemSuppliers:[...new Set(nonItemDocs.map(x=>x.supplier))].sort((a,b)=>a.localeCompare(b,'ru')),
      matchedInvoices:invoices.length,
      temporaryAish19,
      invoices
    };
    fs.writeFileSync(OUT,JSON.stringify(payload,null,2)+'\n');
    console.log('MIX_SCAN_OK',JSON.stringify({scanStart:START,lastSupplyIso,matchedInvoices:invoices.length,items:invoices.reduce((n,d)=>n+d.items.length,0),suppliers:new Set(invoices.map(d=>d.supplier)).size,nonItemDocs:nonItemDocs.length,nonItemSuppliers:[...new Set(nonItemDocs.map(x=>x.supplier))]}));
  }finally{
    await context.close();
    await browser.close();
  }
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
