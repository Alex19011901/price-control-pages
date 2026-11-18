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
const distinctInvoices=[...uniqueInvoices.values()];
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
const entries=[...grouped.values()].map(x=>{
 const name=[...x.names].sort((a,b)=>a.localeCompare(b,'ru'))[0];
 const n=normalizeIndexQty({name,qty:x.qty,unit:x.unit},x.productId);
 return{
   productId:x.productId,date:x.date,dateIso:x.dateIso,supplier:x.supplier,
   invoice:x.invoice,qty:round2(x.qty),sum:round2(x.sum),unit:x.unit,
   fact:round2(x.sum/x.qty),name,
   // Actual price per egg; for shrimp, normalized price per kilogram.
   displayFact:((x.productId==='chicken_egg'||x.productId==='quail_egg'||x.productId==='tiger_shrimp')&&n&&n.qty>0)?round2(x.sum/n.qty):null,
   displayUnit:((x.productId==='chicken_egg'||x.productId==='quail_egg'||x.productId==='tiger_shrimp')&&n&&n.qty>0)?n.u:null,
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
