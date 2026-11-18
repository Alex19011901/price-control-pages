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
  if(['шт','упак','уп','пак','бут','бутылка','банка'].includes(u)){
    const eggs=id==='chicken_egg'||id==='quail_egg';
    if(eggs){
      if(u==='шт'&&!/(?:\d+)\s*шт\s*\/\s*уп/.test(name))return{u:'шт',qty};
      if(u!=='шт'){
        const m=name.match(/(\d{1,3})\s*шт(?:ук)?(?:\/\s*уп|(?:\s|$))/);
        if(m&&Number(m[1])>=2&&Number(m[1])<=360)return{u:'шт',qty:qty*Number(m[1])};
      }
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
for(const invoice of data.invoices){
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
const updatesByDay=new Map();
for(const p of indexedProducts){
 for(const e of byProduct.get(p.id)){
   if(e.indexUnit!==p.indexUnit||!e.indexQty)continue;
   if(!updatesByDay.has(e.dateIso))updatesByDay.set(e.dateIso,new Map());
   const productsOfDay=updatesByDay.get(e.dateIso);
   if(!productsOfDay.has(p.id))productsOfDay.set(p.id,{sum:0,qty:0});
   const x=productsOfDay.get(p.id);x.sum+=e.sum;x.qty+=e.indexQty;
 }
}
const lastPrices=new Map();
const points=[];
let value=100;
for(const [dateIso,changes] of [...updatesByDay].sort((a,b)=>a[0].localeCompare(b[0]))){
 const knownBefore=lastPrices.size,ratios=[],newlyAdded=[];
 for(const [id,change] of changes){
   const price=change.sum/change.qty;
   if(!(price>0)||!Number.isFinite(price))throw new Error('MIX_INVALID_PRICE');
   const prev=lastPrices.get(id);
   if(prev!==undefined)ratios.push({id,ratio:price/prev});
   else newlyAdded.push(id);
 }
 // Equal-weight chain-linking: unchanged known products contribute 1. Newly
 // observed products join at their first price without moving the index.
 if(knownBefore){
   let totalRelative=knownBefore;
   for(const x of ratios)totalRelative+=x.ratio-1;
   value*=totalRelative/knownBefore;
 }
 for(const [id,change] of changes)lastPrices.set(id,change.sum/change.qty);
 if(!Number.isFinite(value)||value<=0)throw new Error('MIX_INDEX_NONFINITE');
 points.push({date:dateIso.slice(8,10)+'.'+dateIso.slice(5,7)+'.'+dateIso.slice(0,4),
   dateIso,value:round2(value),coverage:lastPrices.size,
   compared:ratios.length,newProducts:newlyAdded.length,totalProducts:PRODUCTS.length});
}
const suppliers=[...new Set(entries.map(x=>x.supplier))].sort((a,b)=>a.localeCompare(b,'ru'));
const output={
 schemaVersion:1,generatedAt:data.generatedAt,source:'DocsInBox',start:data.from,
 methodology:'Индекс Микс: цепной индекс с базой 100; равный вес уже известных товаров. При покупке цена товара обновляется, отсутствующие покупки сохраняют предыдущую цену. Новые товары включаются без скачка индекса. Сравнение только в сопоставимых единицах. Разные марки и сорта могут влиять на приблизительную оценку.',
 groups:GROUPS,products,suppliers,
 stats:{selectedProducts:PRODUCTS.length,productsWithData:products.filter(p=>p.count>0).length,
   indexedProducts:indexedProducts.length,suppliers:suppliers.length,
   matchedDeliveries:entries.length,matchedInvoices:data.matchedInvoices,
   lastSupplyIso:data.lastSupplyIso,scanStart:data.scanStart},
 index:{baseDate:points[0]?.date||null,base:100,current:points.at(-1)?.value??null,
   coverage:points.at(-1)?.coverage||0,productsWithNoIndex:products.filter(x=>!x.indexUnit).map(x=>x.id),
   points}
};
fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
console.log('MIX_BUILD_OK',JSON.stringify(output.stats),'index=',output.index.current,'points=',points.length);
