const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = process.env.DOCSINBOX_STORAGE_STATE;
const OUT = process.argv[2] || path.join(__dirname, 'new_products_audit.json');
const START_ISO = '2026-01-01';
const WORKERS = 4;

function clean(v){return String(v ?? '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
function norm(v){return clean(v).toLowerCase().replace(/ё/g,'е');}
function ruToIso(s){const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';}
function compareDocVersion(a,b){
  const av=Number.isFinite(a.version)?a.version:null;
  const bv=Number.isFinite(b.version)?b.version:null;
  if(av!==null&&bv!==null&&av!==bv)return av-bv;
  if(av!==null&&bv===null)return 1;
  if(av===null&&bv!==null)return -1;
  return String(a.publicId||'').localeCompare(String(b.publicId||''));
}

const CATEGORIES = [
  {key:'sea_bass_400_600',label:'Сибас 400–600',test:n=>n.includes('сибас')&&/400\D{0,8}600/.test(n)},
  {key:'gorgonzola_cheese',label:'Сыр Горгонзола',test:n=>n.includes('горгонз')||n.includes('gorgonz')},
  {key:'pineapple',label:'Ананас',test:n=>n.includes('ананас')},
  {key:'spinach_standard',label:'Шпинат Стандарт',test:n=>n.includes('шпинат')},
  {key:'mozzarella_125',label:'Сыр Моцарелла 125 г',test:n=>(n.includes('моцар')||n.includes('моцц')||n.includes('mozz'))&&/125\s*(г|гр|g|gram|мл)?\b/.test(n)}
];
function classify(name){const n=norm(name);return CATEGORIES.filter(c=>c.test(n)).map(c=>c.key);}

(async()=>{
  if(!AUTH)throw new Error('DOCSINBOX_AUTH_PATH_MISSING');
  if(!fs.existsSync(AUTH))throw new Error('DOCSINBOX_AUTH_MISSING');

  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({storageState:AUTH});
  const seed=await context.newPage();
  await seed.goto('https://dxbx.ru/fe/supplies?offset=0',{waitUntil:'domcontentloaded',timeout:60000});

  const supplies=await seed.evaluate(async({startIso})=>{
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
    return all.filter(s=>r2i(s.date)>=startIso).map(s=>({
      date:s.date,
      supplyNumber:s.number||'',
      supplier:s.supplier?.name||'',
      invoices:(s.invoices||[]).map(i=>({number:i.number||'',publicId:i.publicId||'',link:i.link||''}))
    }));
  },{startIso:START_ISO});
  await seed.close();

  const tasks=[];
  for(const supply of supplies)for(const inv of supply.invoices||[])if(inv.link)tasks.push({supply,inv});
  const docs=[];const candidates=[];const errors=[];let nextIndex=0;let scanned=0;

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
        items.push({line,sum,count,unit,name});
      }
      return{title:c(heading?.textContent),items};
    });
    const vm=String(detail.title||'').match(/\(вер\.(\d+)\)/i);
    const version=vm?Number(vm[1]):null;
    const doc={date:supply.date,supplier:supply.supplier,invoice:inv.number||supply.supplyNumber,publicId:inv.publicId,version};
    docs.push(doc);
    for(const item of detail.items||[]){
      const keys=classify(item.name); if(!keys.length)continue;
      for(const key of keys)candidates.push({key,date:supply.date,supplier:supply.supplier,invoice:doc.invoice,publicId:inv.publicId,version,line:item.line,name:item.name,unit:item.unit,qty:item.count,sum:item.sum,fact:item.count?Math.round((item.sum/item.count+Number.EPSILON)*100)/100:null});
    }
  }

  async function worker(no){
    const page=await context.newPage();
    while(true){
      const i=nextIndex++;if(i>=tasks.length)break;
      const task=tasks[i];let ok=false,lastErr=null;
      for(let attempt=1;attempt<=2&&!ok;attempt++){
        try{await readInvoice(page,task);ok=true;}catch(err){lastErr=err;if(attempt<2)await page.waitForTimeout(500);}
      }
      if(!ok)errors.push({date:task.supply.date,supplier:task.supply.supplier,invoice:task.inv.number||task.supply.supplyNumber,publicId:task.inv.publicId,error:String(lastErr&&(lastErr.message||lastErr)||'UNKNOWN')});
      scanned+=1;if(scanned%50===0||scanned===tasks.length)console.log('Progress',scanned+'/'+tasks.length,'matches',candidates.length,'errors',errors.length,'worker',no);
    }
    await page.close();
  }

  await Promise.all(Array.from({length:Math.max(1,Math.min(WORKERS,tasks.length||1))},(_,i)=>worker(i+1)));
  await browser.close();

  const latestByNumber=new Map();
  for(const d of docs){const prev=latestByNumber.get(d.invoice);if(!prev||compareDocVersion(d,prev)>0)latestByNumber.set(d.invoice,d);}
  const active=candidates.filter(c=>{const latest=latestByNumber.get(c.invoice);if(!latest)return true;if(latest.publicId&&c.publicId)return latest.publicId===c.publicId;if(Number.isFinite(latest.version)&&Number.isFinite(c.version))return latest.version===c.version;return true;});
  active.sort((a,b)=>a.key.localeCompare(b.key)||ruToIso(a.date).localeCompare(ruToIso(b.date))||String(a.invoice).localeCompare(String(b.invoice),'ru')||Number(a.line||0)-Number(b.line||0));

  const summaries={};
  for(const cfg of CATEGORIES){
    const rows=active.filter(x=>x.key===cfg.key);
    summaries[cfg.key]={label:cfg.label,rows:rows.length,invoices:new Set(rows.map(x=>x.invoice)).size,exactNames:[...new Set(rows.map(x=>`${x.name} | ${x.unit}`))].sort((a,b)=>a.localeCompare(b,'ru')),suppliers:[...new Set(rows.map(x=>x.supplier))].sort((a,b)=>a.localeCompare(b,'ru')),firstDate:rows[0]?.date||null,lastDate:rows[rows.length-1]?.date||null};
  }
  const payload={generatedAt:new Date().toISOString(),start:'01.01.2026',suppliesScanned:supplies.length,invoicesScanned:scanned,invoiceErrors:errors.length,errors,summaries,matches:active};
  fs.writeFileSync(OUT,JSON.stringify(payload,null,2),'utf8');
  console.log(JSON.stringify(summaries,null,2));
  if(errors.length)throw new Error('INVOICE_SCAN_ERRORS:'+errors.length);
})().catch(err=>{console.error(err&&(err.stack||err.message)||err);process.exit(1);});
