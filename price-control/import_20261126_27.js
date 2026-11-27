'use strict';
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const M=require('./mix_catalog'),P=require('./produce-core');
const root=__dirname,read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8')),write=(p,x)=>fs.writeFileSync(path.join(root,p),JSON.stringify(x,null,2)+'\n');
const audit=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(audit.startIso,'2026-11-26');assert.equal(audit.endIso,'2026-11-27');assert.equal(audit.supplier,'ALL');assert.equal(audit.unreadable,0);
const first='2026-11-26',last='2026-11-27';
const key=d=>[M.iso(d.date),M.norm(d.supplier),String(d.invoice||d.number).trim()].join('\0');
const selected=new Map();
for(const d of audit.invoices){
 assert.ok(M.iso(d.date)>=first&&M.iso(d.date)<=last);
 assert.ok(d.supplier&&d.number&&Number.isInteger(d.version)&&d.items.length);
 // A transport duplicate is not an additional purchase when its title
 // names a normal invoice present in the same complete audit.
 if(/^TTN-/i.test(d.number)){
  const canonical=String(d.title||'').match(/Накладная №\s*(.*?)\s+от\s+\d{2}\.\d{2}\.\d{4}/i)?.[1];
  if(canonical&&audit.invoices.some(x=>x.date===d.date&&M.norm(x.supplier)===M.norm(d.supplier)&&x.number===canonical))continue;
 }
 assert.equal(new Set(d.items.map(x=>x.line)).size,d.items.length);
 for(const i of d.items)assert.ok(Number.isInteger(i.line)&&i.line>0&&i.name&&i.unit&&Number.isFinite(i.count)&&i.count>0&&Number.isFinite(i.sum)&&i.sum>=0,i.name);
 const k=key(d),old=selected.get(k);
 if(!old||d.version>old.version)selected.set(k,d);
 else if(d.version===old.version)assert.deepEqual(d.items,old.items);
}
const docs=[...selected.values()];
function merge(filename,C,kind){
 const raw=read(filename),oldHistory=raw.invoices.filter(d=>M.iso(d.date)<first||M.iso(d.date)>last);
 const before=JSON.stringify(oldHistory);
 const previous=new Map(raw.invoices.filter(d=>M.iso(d.date)>=first&&M.iso(d.date)<=last).map(d=>[key(d),d]));
 const merged=[],rows=[];
 for(const d of docs){
  const k=key(d),old=previous.get(k);previous.delete(k);
  if(old)assert.ok(d.version>=Number(old.version),'Older invoice in audit '+d.number);
  const items=d.items.flatMap(i=>{const p=C.classify(i.name);return p?[{line:i.line,productId:p.id,name:i.name,unit:i.unit,qty:i.count,sum:M.round2(i.sum)}]:[]});
  if(!items.length)continue;
  const receipt={date:d.date,supplier:String(d.supplier).trim().replace(/\s+/g,' '),invoice:String(d.number),version:d.version,items};
  merged.push(receipt);
  rows.push(...items.map(i=>({date:receipt.date,invoice:receipt.invoice,id:i.productId,name:i.name,qty:i.qty,unit:i.unit,sum:i.sum})));
 }
 assert.equal(previous.size,0,'A previously verified invoice was not returned by the complete audit: '+JSON.stringify([...previous.keys()]));
 raw.invoices=oldHistory.concat(merged).sort((a,b)=>M.iso(a.date).localeCompare(M.iso(b.date))||a.supplier.localeCompare(b.supplier,'ru')||a.invoice.localeCompare(b.invoice,'ru'));
 assert.equal(new Set(raw.invoices.map(key)).size,raw.invoices.length);
 assert.equal(JSON.stringify(raw.invoices.filter(d=>M.iso(d.date)<first||M.iso(d.date)>last)),before,'Closed raw history changed');
 Object.assign(raw,{generatedAt:audit.generatedAt,scanStart:first,lastSupplyIso:[raw.lastSupplyIso,...docs.map(d=>M.iso(d.date))].filter(Boolean).sort().at(-1),suppliesScanned:audit.selectedSupplies,invoicesScanned:audit.invoices.length,invoiceErrors:0,matchedInvoices:raw.invoices.length});
 write(filename,raw);
 console.log('IMPORT_'+kind+' '+JSON.stringify({rows,docs:merged.length,historyPreserved:true,lastSupplyIso:raw.lastSupplyIso}));
 return {raw,rows};
}
const oldMix=read('mix_data.json');
const mix=merge('mix_receipts.json',M,'MIX');
const produce=merge('produce_receipts.json',P,'PRODUCE');
cp.execFileSync(process.execPath,[path.join(root,'mix_build.js'),path.join(root,'mix_receipts.json'),path.join(root,'mix_data.json')],{stdio:'inherit'});
const data=read('mix_data.json');
for(const old of oldMix.products){
 const current=data.products.find(p=>p.id===old.id);
 assert.deepEqual(current.deliveries.filter(r=>r.dateIso<first||r.dateIso>last),old.deliveries.filter(r=>r.dateIso<first||r.dateIso>last),'Closed Mix history changed: '+old.id);
}
assert.deepEqual(data.index.points.filter(p=>p.dateIso<first),oldMix.index.points.filter(p=>p.dateIso<first),'Closed Mix index changed');
const pview=P.buildHistory(read('purchase_history.json'),read('full.json'),produce.raw);
const pv=pview.products.flatMap(p=>p.deliveries.filter(r=>r.dateIso>=first&&r.dateIso<=last).map(r=>({label:p.label,date:r.date,price:r.price,name:r.name,invoice:r.invoice})));
console.log('IMPORT_PRODUCE_VIEW '+JSON.stringify({rows:pv,stats:pview.stats}));
const view=data.products.flatMap(p=>p.deliveries.filter(r=>r.dateIso>=first&&r.dateIso<=last).map(r=>({label:p.label,date:r.date,price:r.displayFact??r.fact,name:r.name,invoice:r.invoice})));
console.log('IMPORT_MIX_VIEW '+JSON.stringify(view));
