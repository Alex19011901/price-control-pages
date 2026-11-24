'use strict';
// Build the public Mix widgets without modifying the original price dashboard.
const fs=require('node:fs'),path=require('node:path');
const {PRODUCTS,GROUPS,iso,unit,round2,norm}=require('./mix_catalog');
const INPUT=process.argv[2]||path.join(__dirname,'mix_receipts.json');
const OUT=process.argv[3]||path.join(__dirname,'mix_data.json');
const data=JSON.parse(fs.readFileSync(INPUT,'utf8'));
if(data.schemaVersion!==1||!Array.isArray(data.invoices)||data.invoiceErrors!==0)throw new Error('MIX_INVALID_RECEIPTS');
const knownIds=new Set(PRODUCTS.map(p=>p.id));
function normalizeIndexQty(r,id){
  const qty=Number(r.qty),u=unit(r.unit),name=String(r.name||'').toLowerCase().replace(/ё/g,'е');
  if(!Number.isFinite(qty)||qty<=0)return null;
  if(u==='кг'||u==='kg')return{u:'кг',qty};
  if(u==='г'||u==='гр')return{u:'кг',qty:qty/1000};
  if(u==='л'||u==='литр'||u==='литры')return{u:'л',qty};
  if(u==='мл')return{u:'л',qty:qty/1000};
  // DocsInBox can call a tray 'яч.' while specifying its exact egg count.
  // Only multiply when the receipt explicitly says how many eggs are in it.
  if(id==='quail_egg'&&u==='яч'){
    const tray=name.match(/\(\s*(\d{1,3})\s*шт\.?\s*\)/);
    const pieces=tray?Number(tray[1]):null;
    return pieces>=2&&pieces<=360?{u:'шт',qty:qty*pieces}:null;
  }
  // For package goods, convert only exact printed content. Never guess volume/weight.
  if(['шт','штука','штуки','упак','упаковка','уп','пак','бут','бутылка','банка'].includes(u)){
    const eggs=id==='chicken_egg'||id==='quail_egg';
    if(eggs){
      // Metro may sell a whole 180-piece carton with invoice count=1 "шт".
      // Interfood sometimes writes "360шт" but counts individual eggs.
      const prefix=name.match(/^\s*(\d{2,4})\s*шт(?=\s|[,;/()]|$)/);
      const pack=name.match(/(\d{1,4})\s*шт(?:ук)?\s*\/\s*уп(?:ак|аковк(?:а|у|и)?)?/);
      const pieces=prefix?Number(prefix[1]):pack?Number(pack[1]):null;
      const isPiece=['шт','штука','штуки'].includes(u);
      if(isPiece){
        if(pieces>=2&&pieces<=360&&qty<pieces)return{u:'шт',qty:qty*pieces};
        return{u:'шт',qty};
      }
      if(pieces>=2&&pieces<=360)return{u:'шт',qty:qty*pieces};
      return null;
    }
    // No conversion for composite packs (6x1л, 12*500г, etc.)
    if(/\d+\s*[xх*]\s*\d+\s*(?:мл|л|гр|г|кг)/.test(name))return null;
    const found=[...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(мл|литр|л|кг|гр|г)(?=[^а-яa-z]|$)/g)];
    const stable=found.filter(m=>{
      // Ignore 33% or fat percentages (the token pattern excludes %, but keep defensive check).
      const v=Number(m[1].replace(',','.'));
      return Number.isFinite(v)&&v>0;
    });
    if(stable.length===1){
      const m=stable[0],v=Number(m[1].replace(',','.'));
      if(m[2]==='л'||m[2]==='литр')return{u:'л',qty:qty*v};
      if(m[2]==='мл')return{u:'л',qty:qty*v/1000};
      if(m[2]==='кг')return{u:'кг',qty:qty*v};
      if(m[2]==='г'||m[2]==='гр')return{u:'кг',qty:qty*v/1000};
    }
    return{u,qty};
  }
  return null;
}
function byDateAsc(a,b){
 return a.dateIso.localeCompare(b.dateIso)||a.supplier.localeCompare(b.supplier,'ru')||a.invoice.localeCompare(b.invoice,'ru');
}
const grouped=new Map();
// Global Foods publishes identical invoice numbers/dates via two aliases:
// "ТД ГЛОБАЛ ФУДС" and "Торговый дом Глобал Фудс".
function supplierIdentity(s){
 const n=norm(s);
 return n.includes('глобал фудс')?'global-foods-alias':n;
}
function sourceVersion(d){const v=Number(d.version);return Number.isFinite(v)?v:-1;}
function detailScore(d){return (d.items||[]).reduce((n,x)=>n+String(x.name||'').length,0);}
const uniqueInvoices=new Map();
for(const d of data.invoices){
 const key=[iso(d.date),String(d.invoice||''),supplierIdentity(d.supplier)].join('\u0000');
 const prev=uniqueInvoices.get(key);
 if(!prev||sourceVersion(d)>sourceVersion(prev)||
   (sourceVersion(d)===sourceVersion(prev)&&detailScore(d)>detailScore(prev)))
      uniqueInvoices.set(key,d);
}
// DocsInBox can expose the same Aish Garden invoice as "3367" and
// "УТАГ0003367". Collapse these aliases ONLY if date, supplier and every
// line (SKU, quantity and sum) are identical. Different contents are separate.
function aishInvoiceNumber(d){
 if(!norm(d.supplier).includes('айш гарден'))return null;
 const m=String(d.invoice||'').toUpperCase().replace(/\s/g,'').match(/^(?:УТАГ)?0*(\d+)$/);
 return m?m[1]:null;
}
function invoiceItemsSignature(d){
 // Row numbers can differ between DocsInBox representations of the same
 // supplier invoice. Compare the complete selected SKU/quantity/total instead.
 return JSON.stringify((d.items||[]).map(x=>[
   x.productId,norm(x.name),unit(x.unit),Number(x.qty),round2(Number(x.sum))
 ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
const distinctInvoices=[];
const identicalAishInvoices=new Map();
for(const doc of uniqueInvoices.values()){
 const n=aishInvoiceNumber(doc);
 if(n===null){distinctInvoices.push(doc);continue;}
 const key=[iso(doc.date),supplierIdentity(doc.supplier),n,invoiceItemsSignature(doc)].join('\u0000');
 if(!identicalAishInvoices.has(key)){
   identicalAishInvoices.set(key,distinctInvoices.length);
   distinctInvoices.push(doc);
 }else{
   const idx=identicalAishInvoices.get(key);
   if(String(doc.invoice).length>String(distinctInvoices[idx].invoice).length)
     distinctInvoices[idx]=doc;
 }
}
const duplicateDocumentsRemoved=data.invoices.length-distinctInvoices.length;
for(const invoice of distinctInvoices){
 const date=String(invoice.date||''),dateIso=iso(date),supplier=String(invoice.supplier||'').trim(),number=String(invoice.invoice||'').trim();
 if(!dateIso||!supplier||!number)throw new Error('MIX_BAD_INVOICE');
 for(const item of invoice.items||[]){
   if(!knownIds.has(item.productId))throw new Error('MIX_UNKNOWN_PRODUCT_ID:'+item.productId);
   const q=Number(item.qty),sum=Number(item.sum),rawUnit=unit(item.unit);
   if(!(q>0)||!(sum>=0)||!Number.isFinite(sum)||!rawUnit)throw new Error('MIX_BAD_RECEIPT_ROW');
   // Keep separate receipt lines for different products/units even inside same invoice.
   const key=[item.productId,date,supplier,number,rawUnit,norm(item.name)].join('\u0000');
   if(!grouped.has(key))grouped.set(key,{productId:item.productId,date,dateIso,supplier,invoice:number,qty:0,sum:0,unit:rawUnit,names:new Set()});
   const g=grouped.get(key);g.qty+=q;g.sum+=sum;g.names.add(String(item.name||''));
 }
}
// Special invoice convention: one 3 kg wholesale pack contains 24 individual
// mozzarella portions of 125 g. Show the price per 125 g piece, while leaving
// the original package-level SKU index and the original invoice totals intact.
function mozzarella125Pieces(name){
 const s=String(name||'').toLowerCase().replace(/ё/g,'е').replace(/\u00a0/g,' ');
 if(!/125\s*(?:гр|г|g)(?=$|[^а-яa-z])/.test(s))return null;
 const packs=[...s.matchAll(/(?:^|[\s,(])уп\.?\s*(\d+(?:[.,]\d+)?)\s*(кг|гр|г)(?=$|[^а-яa-z])/g)];
 if(packs.length!==1)return null;
 const x=packs[0],massG=Number(x[1].replace(',','.'))*(x[2]==='кг'?1000:1);
 const count=massG/125;
 return Number.isInteger(count)&&count>=2&&count<=240?count:null;
}
// User-confirmed DocsInBox exception for 19 Nov Aish Garden:
// "Горошек зеленый с/м" 0.8 kg = two retail 400 g packs.
 // Convert only the DISPLAY; keep the source kg/qty/sum and the index as-is.
function confirmedFrozenPeaPacks(x,name){
  const document=String(x.invoice||'').toUpperCase().replace(/\s+/g,'');
  const correctDocument=/^(?:УТАГ0*)?3351$/.test(document);
  if(x.productId!=='frozen_peas'||x.dateIso!=='2026-11-19'||
    !norm(x.supplier).includes('айш гарден')||!correctDocument||
    !name.includes('(00000003057)')||x.unit!=='кг'||
    round2(x.qty)!==0.8||round2(x.sum)!==162.56)return null;
  return {pieces:2,gramsPerPack:400};
}
const entries=[...grouped.values()].map(x=>{
 const name=[...x.names].sort((a,b)=>a.localeCompare(b,'ru'))[0];
 const n=normalizeIndexQty({name,qty:x.qty,unit:x.unit},x.productId);
 // Flour and lump sugar: a package has an exact declared weight, so display
 // the actual price per kg. Butter is deliberately left per pack, as approved.
 const flourOrSugar=(x.productId==='wheat_flour'||x.productId==='cube_sugar')&&n?.u==='кг';
 const normalizedDisplay=(x.productId==='chicken_egg'||x.productId==='quail_egg'||x.productId==='tiger_shrimp'||flourOrSugar)&&n&&n.qty>0;
 const mozzaPieces=x.productId==='mozzarella_125'&&['шт','штука','штуки'].includes(x.unit)?mozzarella125Pieces(name):null;
 const mozzaTotalPieces=mozzaPieces&&x.qty>0?x.qty*mozzaPieces:null;
 const peaPacks=confirmedFrozenPeaPacks(x,name);
 return{
   productId:x.productId,date:x.date,dateIso:x.dateIso,supplier:x.supplier,
   invoice:x.invoice,qty:round2(x.qty),sum:round2(x.sum),unit:x.unit,
   fact:round2(x.sum/x.qty),name,
   // Actual price per egg; shrimp as before; flour/sugar per confirmed kg.
   displayFact:peaPacks?round2(x.sum/peaPacks.pieces):mozzaTotalPieces?round2(x.sum/mozzaTotalPieces):normalizedDisplay?round2(x.sum/n.qty):null,
   displayUnit:peaPacks?'шт':mozzaTotalPieces?'шт':normalizedDisplay?n.u:null,
   displayPack:peaPacks?'2 пачки по 400 г':null,
   indexUnit:n?.u||null,indexQty:n?Number(n.qty.toFixed(6)):null
 };
}).sort(byDateAsc);
const byProduct=new Map(PRODUCTS.map(p=>[p.id,[]]));
for(const e of entries)byProduct.get(e.productId).push(e);
const products=PRODUCTS.map(p=>{
 const deliveries=byProduct.get(p.id);
 // Keep only comparable units in the aggregate index. Never mix pieces, kg and liters.
 const counts=new Map();
 for(const r of deliveries)if(r.indexUnit&&r.indexQty>0)counts.set(r.indexUnit,(counts.get(r.indexUnit)||0)+1);
 const dominant=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||null;
 return {id:p.id,label:p.label,group:p.group,indexUnit:dominant,
   deliveries:[...deliveries].reverse(),count:deliveries.length,
   indexedDeliveries:deliveries.filter(r=>r.indexUnit===dominant).length};
});
const indexedProducts=products.filter(p=>p.indexUnit&&p.indexedDeliveries>0);
// Only compare identical catalog rows from the same supplier in the same
// normalized physical unit. Broader product family/group is for display only;
// different brands, pack sizes, grades and suppliers must never be priced as
// if they were identical purchases.
const daily=new Map();
for(const p of indexedProducts){
  for(const r of byProduct.get(p.id)){
    if(r.indexUnit!==p.indexUnit||!(r.indexQty>0)||!(r.sum>0))continue;
    const sku=[p.id,norm(r.supplier),norm(r.name),r.indexUnit].join('\u0000');
    if(!daily.has(r.dateIso))daily.set(r.dateIso,new Map());
    const day=daily.get(r.dateIso);
    if(!day.has(sku))day.set(sku,{productId:p.id,sku,sum:0,qty:0});
    const v=day.get(sku);v.sum+=r.sum;v.qty+=r.indexQty;
  }
}
const lastSkuPrices=new Map();
const activeProductIds=new Set();
const points=[];
let value=100;
for(const [dateIso,day] of [...daily].sort((a,b)=>a[0].localeCompare(b[0]))){
  const productsBefore=activeProductIds.size;
  const comparableByProduct=new Map();
  let comparableSkus=0,newSkus=0;
  for(const [sku,item] of day){
    const price=item.sum/item.qty;
    if(!(price>0)||!Number.isFinite(price))throw new Error('MIX_INDEX_INVALID_SKU_PRICE');
    const previous=lastSkuPrices.get(sku);
    if(previous!==undefined){
      const ratio=price/previous;
      if(!(ratio>0)||!Number.isFinite(ratio))throw new Error('MIX_INDEX_INVALID_SKU_RATIO');
      if(!comparableByProduct.has(item.productId))comparableByProduct.set(item.productId,[]);
      comparableByProduct.get(item.productId).push(ratio);
      comparableSkus++;
    }else newSkus++;
  }
  // Geometric mean across independently comparable SKUs of one product.
  // Arithmetic equal-weight mean across the already observed 30 product families.
  // Unchanged products contribute 1; a new SKU begins at its first verified
  // purchase with ratio 1, never generating a synthetic price jump.
  if(productsBefore>0){
    let deviation=0;
    for(const ratios of comparableByProduct.values()){
      const rel=Math.exp(ratios.reduce((sum,ratio)=>sum+Math.log(ratio),0)/ratios.length);
      deviation+=rel-1;
    }
    const factor=1+deviation/productsBefore;
    if(!(factor>0)||!Number.isFinite(factor))throw new Error('MIX_INDEX_INVALID_DAY_FACTOR');
    value*=factor;
  }
  for(const [sku,item] of day){
    lastSkuPrices.set(sku,item.sum/item.qty);
    activeProductIds.add(item.productId);
  }
  if(!(value>0)||!Number.isFinite(value))throw new Error('MIX_INDEX_NONFINITE');
  points.push({date:dateIso.slice(8,10)+'.'+dateIso.slice(5,7)+'.'+dateIso.slice(0,4),
    dateIso,value:round2(value),coverage:activeProductIds.size,
    compared:comparableSkus,comparedProducts:comparableByProduct.size,
    newProducts:activeProductIds.size-productsBefore,newSkus,totalProducts:PRODUCTS.length});
}
const suppliers=[...new Set(entries.map(x=>x.supplier))].sort((a,b)=>a.localeCompare(b,'ru'));
const output={
 schemaVersion:1,generatedAt:data.generatedAt,source:'DocsInBox',start:data.from,
 methodology:'Индекс Микс: база 100, равный вес каждой из выбранных товарных групп. Индекс изменяется только при повторной закупке одной и той же номенклатуры у того же поставщика в сопоставимой единице. Разные сорта, бренды, упаковки и поставщики не сравниваются между собой для расчёта изменения цены. При отсутствии повторной закупки предыдущее значение сохраняется, новые позиции включаются без скачка. История показывает все найденные товары и поставщиков.',
 groups:GROUPS,products,suppliers,
 stats:{selectedProducts:PRODUCTS.length,productsWithData:products.filter(p=>p.count>0).length,
   indexedProducts:indexedProducts.length,suppliers:suppliers.length,
   matchedDeliveries:entries.length,matchedInvoices:distinctInvoices.length,
   rawMatchedInvoices:data.matchedInvoices,duplicateDocumentsRemoved,
   lastSupplyIso:data.lastSupplyIso,scanStart:data.scanStart},
 index:{baseDate:points[0]?.date||null,base:100,current:points.at(-1)?.value??null,
   coverage:points.at(-1)?.coverage||0,productsWithNoIndex:products.filter(x=>!x.indexUnit).map(x=>x.id),
   points}
};
fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
console.log('MIX_BUILD_OK',JSON.stringify(output.stats),'index=',output.index.current,'points=',points.length);
