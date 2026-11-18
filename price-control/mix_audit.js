'use strict';
// Read-only diagnostic of SKUs missing from Mix; never changes data or invoice state.
const {chromium}=require('playwright');
const fs=require('node:fs');
const AUTH=process.env.DOCSINBOX_STORAGE_STATE;
const START='2026-10-01',END='2026-11-18';
const WORKERS=5;
if(!AUTH||!fs.existsSync(AUTH))throw Error('MIX_AUDIT_AUTH_MISSING');
const iso=s=>{const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:''};
const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.MIX_CHROME_EXECUTABLE?{executablePath:process.env.MIX_CHROME_EXECUTABLE}:{})});
 const ctx=await browser.newContext({storageState:AUTH});
 try{
  const page=await ctx.newPage();
  await page.goto('https://dxbx.ru/fe/supplies?offset=0',{waitUntil:'domcontentloaded',timeout:60000});
  const supplies=await page.evaluate(async(start)=>{
   const toIso=s=>{const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:'';};
   const out=[];let offset=0;
   for(let n=0;n<1000;n++){
    const r=await fetch('/api/front/supplies?offset='+offset,{credentials:'include'});
    if(!r.ok)throw Error('SUPPLIES_HTTP_'+r.status);
    const j=await r.json(),rows=j.data||[];
    if(!rows.length)break;
    out.push(...rows);
    const dates=rows.map(x=>toIso(x.date)).filter(Boolean);
    if(dates.length&&dates.every(x=>x<start))break;
    offset+=rows.length;if(rows.length<10)break;
   }
   return out.filter(x=>toIso(x.date)>=start).map(x=>({date:x.date,supplier:x.supplier?.name||'',invoices:(x.invoices||[]).map(i=>({number:i.number||'',link:i.link||'',publicId:i.publicId||''}))}));
  },START);
  await page.close();
  const tasks=supplies.filter(x=>iso(x.date)<=END).flatMap(s=>s.invoices.map(i=>({s,i})));
  console.log('MIX_AUDIT_SCAN tasks='+tasks.length);
  const matches=[],errors=[],noRows=[];let next=0,processed=0;
  async function worker(){
   const p=await ctx.newPage();
   while(true){
    const idx=next++;if(idx>=tasks.length)break;
    const {s,i}=tasks[idx];
    try{
     if(!String(i.link||'').startsWith('https://dxbx.ru/'))throw Error('INVALID_INVOICE_LINK');
     await p.goto(i.link,{waitUntil:'domcontentloaded',timeout:60000});
     await p.waitForFunction(()=>{
      return [...document.querySelectorAll('table')].some(t=>{
       const h=[...t.querySelectorAll('th')].map(x=>String(x.textContent||'').replace(/\s+/g,' ').trim());
       return h.includes('Сумма')&&h.includes('Кол.')&&h.some(x=>/Номенклатура/i.test(x));
      });
     },undefined,{timeout:15000});
     const rows=await p.evaluate(()=>{
      const c=s=>String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
      const n=s=>{const t=c(s).replace(/\s/g,'').replace(',','.').replace(/[^\d.-]/g,'');return t&&Number.isFinite(Number(t))?Number(t):null};
      const table=[...document.querySelectorAll('table')].find(t=>{
       const h=[...t.querySelectorAll('th')].map(x=>c(x.textContent));
       return h.includes('Сумма')&&h.includes('Кол.')&&h.some(x=>/Номенклатура/i.test(x));
      });
      if(!table)return [];
      return [...table.querySelectorAll('tr')].flatMap(tr=>{
       const td=[...tr.querySelectorAll(':scope > td')];
       if(td.length<5)return [];
       const line=n(td[0].textContent),sum=n(td[1].textContent),qty=n(td[2].textContent),unit=c(td[3].textContent),name=c(td[4].textContent);
       return line!=null&&sum!=null&&qty!=null&&unit&&name?[{line,qty,unit,sum,name}]:[];
      });
     });
     if(!rows.length){noRows.push({date:s.date,supplier:s.supplier,invoice:i.number});continue;}
     for(const row of rows){
      const n=norm(row.name);
      if(/масл.{0,35}сливоч|сливоч.{0,45}масл|кревет|shrimp|тигров|яйц|яиц|брынз|фет[аы]|молокосод/.test(n))
       matches.push({date:s.date,supplier:s.supplier,invoice:i.number,...row});
     }
    }catch(e){errors.push({date:s.date,supplier:s.supplier,invoice:i.number,reason:String(e.message||e).slice(0,160)});}
    processed++;if(processed%60===0||processed===tasks.length)console.log('MIX_AUDIT_PROGRESS '+processed+'/'+tasks.length+' matches='+matches.length+' errors='+errors.length);
   }
   await p.close();
  }
  await Promise.all(Array.from({length:WORKERS},()=>worker()));
  if(errors.length)console.log('MIX_AUDIT_ERRORS '+encodeURIComponent(JSON.stringify(errors)));
  const sorted=matches.sort((a,b)=>iso(b.date).localeCompare(iso(a.date))||a.name.localeCompare(b.name,'ru'));
  const find=(r)=>{const n=norm(r.name);return /масл.{0,35}сливоч|сливоч.{0,45}масл/.test(n)?'butter':/кревет|shrimp|тигров/.test(n)?'shrimp':/яйц|яиц/.test(n)?'egg':/брынз|фет[аы]/.test(n)?'feta':'milkprod';};
  const groupMap=new Map();
  for(const row of sorted){
   const typ=find(row),key=[typ,row.name,row.unit,row.supplier].join('\0');
   if(!groupMap.has(key))groupMap.set(key,{type:typ,name:row.name,unit:row.unit,supplier:row.supplier,dates:[],invoices:[],qtySamples:[],sumSamples:[]});
   const grp=groupMap.get(key);
   if(!grp.dates.includes(row.date))grp.dates.push(row.date);
   if(!grp.invoices.includes(row.invoice))grp.invoices.push(row.invoice);
   if(grp.qtySamples.length<3){grp.qtySamples.push(row.qty);grp.sumSamples.push(row.sum)}
  }
  console.log('MIX_AUDIT_SUMMARY '+JSON.stringify({tasks:tasks.length,matches:matches.length,groups:groupMap.size,errors:errors.length,noRows:noRows.length,types:[...new Set([...groupMap.values()].map(x=>x.type))]}));
  for(const row of groupMap.values())console.log('MIX_AUDIT_NAME '+encodeURIComponent(JSON.stringify({...row,dates:row.dates.slice(0,16),invoices:row.invoices.slice(0,16)})));
 }finally{await ctx.close();await browser.close();}
})().catch(e=>{console.error(e.stack||String(e));process.exit(1)});
