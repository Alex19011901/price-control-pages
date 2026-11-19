(function(){
'use strict';
const URL='./mix_data.json', NS='http://www.w3.org/2000/svg', MAX=5;
let state=null;
const id=k=>document.getElementById(k);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,n=2)=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:n});
const svg=(tag,attrs={},value)=>{const x=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>x.setAttribute(k,String(v)));if(value!=null)x.textContent=String(value);return x};

const DUCK_SKIN_IDS=new Set(['duck_fillet_oz500','duck_fillet_oz400','duck_fillet_myasko','duck_fillet_china']);
function duckSkinOther(row){
 const name=String(row.name||'').toLowerCase().replace(/ё/g,'е');
 return !/(?:без\s+кожи|б\/к)/.test(name)&&/(?:на\s+коже|с\s+кожей|н\/к)/.test(name);
}
// Combine only the visible purchase-history rows, preserving exact SKU indexing.
function tableProducts(){
 const all=state.products;
 const other=all.find(p=>p.id==='duck_fillet_other');
 const duck=all.filter(p=>DUCK_SKIN_IDS.has(p.id));
 const history=duck.flatMap(p=>p.deliveries)
   .concat(other?other.deliveries.filter(duckSkinOther):[])
   .sort((a,b)=>b.dateIso.localeCompare(a.dateIso)||a.supplier.localeCompare(b.supplier,'ru')||a.invoice.localeCompare(b.invoice,'ru'));
 let inserted=false;
 return all.flatMap(p=>{
   if(DUCK_SKIN_IDS.has(p.id)){
     if(inserted)return [];
     inserted=true;
     return [{id:'duck_fillet_skin',label:'Филе утки на коже',group:p.group,
       deliveries:history,searchLabels:duck.map(x=>x.label).join(' ')}];
   }
   if(p.id==='duck_fillet_other'){
     const remaining=p.deliveries.filter(row=>!duckSkinOther(row));
     return remaining.length?[{...p,deliveries:remaining}]:[];
   }
   return [p];
 });
}
// Box prices are comparable per kg only when the box's exact weight is printed.
function boxWeightKg(row){
 const u=String(row.unit||'').toLowerCase().replace(/ё/g,'е').replace(/\./g,'').trim();
 if(!['кор','короб','коробка','коробки','ящик'].includes(u))return null;
 const name=String(row.name||'').toLowerCase().replace(/ё/g,'е').replace(/\u00a0/g,' ');
 const matches=[...name.matchAll(/(\d+(?:[.,]\d+)?)\s*кг\s*\/\s*(?:кор(?:обк[ауеи])?|монолит|ящик)(?=$|[^а-яa-z])/g)];
 if(matches.length!==1)return null;
 const weight=Number(matches[0][1].replace(',','.'));
 return Number.isFinite(weight)&&weight>0?weight:null;
}
function visiblePrice(row){
 const weight=boxWeightKg(row),sum=Number(row.sum),qty=Number(row.qty);
 if(weight&&Number.isFinite(sum)&&qty>0)
   return {fact:sum/(qty*weight),unit:'кг',boxKg:weight};
 return {fact:row.displayFact==null?row.fact:row.displayFact,
   unit:row.displayUnit||row.unit,boxKg:null};
}
function install(){
 if(id('mixCard'))return;
 const style=document.createElement('style');style.id='mixStyles';
 style.textContent=[
 '.mix-card,.mix-index-card{margin-top:12px;padding:14px;min-width:0}',
 '.mix-title{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}',
 '.mix-title h2{font-size:17px;font-weight:800;margin:0;color:var(--text)}',
 '.mix-muted,.mix-note{font-size:11px;color:var(--muted);line-height:1.45}',
 '.mix-note{margin-top:9px}.mix-meta{margin-top:7px;font-size:12px;color:var(--muted)}',
 '.mix-tools{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}',
 '.mix-tools label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--muted)}',
 '.mix-tools select,.mix-tools input{border:1px solid var(--line2);border-radius:8px;background:#0d1825;color:var(--text);padding:7px 9px;min-width:150px;font:inherit}',
 '.mix-table-scroll{overflow-x:auto;border:1px solid var(--line2);border-radius:10px}',
 '.mix-table{width:100%;min-width:1080px;border-collapse:collapse;table-layout:fixed;font-size:11px}',
 '.mix-table th,.mix-table td{text-align:right;vertical-align:top;padding:8px;border-bottom:1px solid var(--line2)}',
 '.mix-table th{background:#101b2a;color:#aebdd0;font-weight:700}',
 '.mix-table td:first-child,.mix-table th:first-child{text-align:left;width:220px}',
 '.mix-group-row td{background:#182838;color:#dce8f5;font-weight:800;text-align:left!important}',
 '.mix-prod{font-weight:700}.mix-price{font-weight:700}',
 '.mix-date,.mix-supplier{font-size:10px;color:var(--muted)}',
 '.mix-date.mix-date-today,.mix-date.mix-date-yesterday,.mix-date.mix-date-before-yesterday{display:inline-block;padding:2px 5px;border-radius:4px;font-weight:800}',
 '.mix-date.mix-date-today{background:#174b31;color:#a5f2c0}',
 '.mix-date.mix-date-yesterday{background:#594316;color:#ffe78a}',
 '.mix-date.mix-date-before-yesterday{background:#442758;color:#e8bdff}',
 '.mix-supplier{display:block;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;margin-top:3px;max-width:135px;color:#aebdd0}',
 '.mix-empty{color:var(--muted)}',
 '.mix-stats{display:flex;gap:28px;flex-wrap:wrap;margin:10px 0}',
 '.mix-stats span{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--muted)}',
 '.mix-stats b{font-size:20px;color:var(--text)}',
 '.mix-graph-frame{background:#0d1825;border:1px solid var(--line2);border-radius:10px;padding:9px}',
 '.mix-graph-frame svg{display:block;width:100%;height:auto;max-height:278px}',
 '.mix-axis{font-size:10px;fill:#9fb0c5}.mix-grid{stroke:#314155;stroke-width:1;stroke-dasharray:3 4}',
 '.mix-path{fill:none;stroke:#a38bff;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}',
 '.mix-dot{fill:#a38bff;stroke:#0d1825;stroke-width:1.4}',
 '@media(max-width:700px){.mix-card,.mix-index-card{padding:10px}.mix-tools label{min-width:130px;flex:1}.mix-tools select{width:100%}}'
 ].join('\n');
 document.head.appendChild(style);
 const anchor=id('purchaseHistoryCard')||document.querySelector('.table-card');
 if(!anchor)return;
 const a=document.createElement('section');a.id='mixCard';a.className='card mix-card';
 a.innerHTML=
 '<div class="mix-title"><h2>Виджет Микс</h2><span class="mix-muted" id="mixUpdated">Загрузка DocsInBox…</span></div>'+
 '<div id="mixMeta" class="mix-meta">Закупки выбранных товаров от всех поставщиков</div>'+
 '<div class="mix-tools"><label>Категория<select id="mixGroup"><option value="">Все категории</option></select></label>'+
 '<label>Поставщик<select id="mixSupplier"><option value="">Все поставщики</option></select></label>'+
 '<label>Название<input id="mixSearch" placeholder="Поиск товара" type="search"></label></div>'+
 '<div class="mix-table-scroll"><table class="mix-table"><thead><tr>'+
 '<th>Товар</th><th>Последняя закупка</th><th>Пред. 1</th><th>Пред. 2</th><th>Пред. 3</th><th>Пред. 4</th><th>Пред. 5</th>'+
 '</tr></thead><tbody id="mixRows"><tr><td colspan="7">Загрузка истории…</td></tr></tbody></table></div>'+
 '<div class="mix-note">История закупок DocsInBox по всем поставщикам. В каждом столбце дата, фактическая цена и поставщик; номер накладной и полное название видны при наведении. Несколько строк одного товара в одной накладной объединяются по сумме и количеству. Яйца показываются по цене за 1 шт; креветки и коробки с указанным весом — за 1 кг. Варианты филе утки на коже собраны в одну строку, а для остальных товаров сохраняется единица накладной.</div>';
 const b=document.createElement('section');b.id='mixIndexCard';b.className='card mix-index-card';
 b.innerHTML=
 '<div class="mix-title"><h2>Индекс Микс</h2><span class="mix-muted">База 100</span></div>'+
 '<div class="mix-stats"><span>Индекс сейчас<b id="mixIndexValue">—</b></span>'+
 '<span>Товаров с ценой<b id="mixIndexCoverage">—</b></span>'+
 '<span>Начало<b id="mixIndexStart">—</b></span></div>'+
 '<div class="mix-graph-frame"><svg id="mixGraph" viewBox="0 0 920 260" role="img" aria-label="Кривая изменения индекса Микс"></svg></div>'+
 '<div class="mix-note">Цепной индекс с базой 100: равный вес товарных групп. Для изменения цены сравниваются только повторные закупки одной номенклатуры у того же поставщика в сопоставимой единице. Разные марки, сорта, упаковки и поставщики друг с другом не сравниваются. Без сопоставимой повторной закупки значение сохраняется, новые позиции включаются без искусственного скачка. Фильтры таблицы на индекс не влияют.</div>';
 anchor.insertAdjacentElement('afterend',a);a.insertAdjacentElement('afterend',b);
 for(const k of ['mixGroup','mixSupplier','mixSearch'])id(k).addEventListener(k==='mixSearch'?'input':'change',renderTable);
}
// Dates are highlighted only in the Last Purchase column, based on Moscow's current date.
function moscowTodayIso(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const get=kind=>parts.find(p=>p.type===kind)?.value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
function recentDateClass(iso,today){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||'')))return '';
 const dayDiff=Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(iso+'T00:00:00Z'))/86400000);
 return dayDiff===0?'mix-date-today':dayDiff===1?'mix-date-yesterday':dayDiff===2?'mix-date-before-yesterday':'';
}
function cell(row,isLatest=false,today=''){
 if(!row)return '<td class="mix-empty">—</td>';
 const shown=visiblePrice(row);
 const info=shown.boxKg!=null?'Вес коробки: '+fmt(shown.boxKg)+' кг · Цена за кг: '+fmt(shown.fact)+' ₽':
   row.displayFact!=null?'Цена за '+shown.unit+': '+fmt(shown.fact)+' ₽':'';
 const title=[row.date,row.supplier,row.invoice,row.name,
   'В накладной: '+row.qty+' '+row.unit+' на '+fmt(row.sum)+' ₽',info].filter(Boolean).join(' · ');
 const dateClass=isLatest?recentDateClass(row.dateIso,today):'';
 return '<td title="'+esc(title)+'"><span class="mix-date'+(dateClass?' '+dateClass:'')+'">'+esc(row.date.slice(0,5))+'</span>'+
 '<div class="mix-price">'+fmt(shown.fact)+' ₽/'+esc(shown.unit)+'</div>'+
 '<span class="mix-supplier">'+esc(row.supplier)+'</span></td>';
}
function renderTable(){
 if(!state)return;
 const gsel=id('mixGroup').value,ssel=id('mixSupplier').value,query=id('mixSearch').value.toLowerCase().replace(/ё/g,'е').trim();
 const today=moscowTodayIso();
 let html='',found=0;
 for(const group of state.groups){
  if(gsel&&group.id!==gsel)continue;
  const products=tableProducts().filter(p=>p.group===group.id&&[p.label,p.searchLabels||''].join(' ').toLowerCase().replace(/ё/g,'е').includes(query));
  if(!products.length)continue;
  html+='<tr class="mix-group-row"><td colspan="7">'+esc(group.label)+'</td></tr>';
  for(const p of products){
   const entries=p.deliveries.filter(r=>!ssel||r.supplier===ssel);
   html+='<tr><td><div class="mix-prod">'+esc(p.label)+'</div><div class="mix-date">'+entries.length+' поставок</div></td>';
   for(let i=0;i<=MAX;i++)html+=cell(entries[i],i===0,today);
   html+='</tr>';found++;
  }
 }
 id('mixRows').innerHTML=found?html:'<tr><td colspan="7" class="mix-empty">Подходящих товаров нет</td></tr>';
}
function draw(){
 const chart=id('mixGraph');while(chart.firstChild)chart.removeChild(chart.firstChild);
 const idx=state.index||{},points=idx.points||[];
 id('mixIndexValue').textContent=fmt(idx.current);
 id('mixIndexCoverage').textContent=(idx.coverage||0)+' / '+state.stats.selectedProducts;
 id('mixIndexStart').textContent=idx.baseDate||'—';
 if(!points.length){chart.appendChild(svg('text',{x:460,y:120,'text-anchor':'middle',class:'mix-axis'},'Нет данных для индекса'));return;}
 const W=920,H=260,L=56,R=22,T=18,B=40;
 const begin=Date.parse(points[0].dateIso+'T00:00:00Z'),end=Date.parse(points.at(-1).dateIso+'T00:00:00Z');
 const values=points.map(p=>Number(p.value)).filter(Number.isFinite);
 const lo=Math.floor((Math.min(...values,100)-3)/5)*5,hi=Math.ceil((Math.max(...values,100)+3)/5)*5;
 const X=d=>L+(begin===end?(W-L-R)/2:(Date.parse(d+'T00:00:00Z')-begin)/(end-begin)*(W-L-R));
 const Y=v=>T+(hi-v)/(hi-lo||1)*(H-T-B);
 for(let i=0;i<=4;i++){
  const v=lo+(hi-lo)*i/4,y=Y(v);
  chart.appendChild(svg('line',{x1:L,x2:W-R,y1:y,y2:y,class:'mix-grid'}));
  chart.appendChild(svg('text',{x:L-8,y:y+4,'text-anchor':'end',class:'mix-axis'},fmt(v,1)));
 }
 chart.appendChild(svg('path',{d:points.map((p,i)=>(i?'L':'M')+X(p.dateIso).toFixed(1)+','+Y(p.value).toFixed(1)).join(' '),class:'mix-path'}));
 const ticks=Math.min(6,points.length),last=points.length-1;
 const seen=new Set();
 for(let k=0;k<ticks;k++){
  const i=Math.round(k*last/Math.max(1,ticks-1)),p=points[i];if(seen.has(i))continue;seen.add(i);
  chart.appendChild(svg('text',{x:X(p.dateIso),y:H-11,'text-anchor':i===0?'start':i===last?'end':'middle',class:'mix-axis'},p.date.slice(0,5)));
 }
 const every=Math.max(1,Math.ceil(points.length/70));
 for(let i=0;i<points.length;i++){
  if(i%every&&i!==last)continue;
  const p=points[i],dot=svg('circle',{cx:X(p.dateIso),cy:Y(p.value),r:i===last?4:2.5,class:'mix-dot'});
  dot.appendChild(svg('title',{},p.date+' · '+fmt(p.value)+' · товаров '+p.coverage+' · изменилось '+p.compared));
  chart.appendChild(dot);
 }
}
async function load(){
 const r=await fetch(URL+'?cb='+Date.now(),{cache:'no-store'});
 if(!r.ok)throw new Error('HTTP '+r.status);
 const j=await r.json();
 if(!Array.isArray(j.products)||!Array.isArray(j.groups)||!j.index)throw new Error('Неверный формат данных');
 state=j;
 id('mixGroup').innerHTML='<option value="">Все категории</option>'+j.groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.label)+'</option>').join('');
 id('mixSupplier').innerHTML='<option value="">Все поставщики</option>'+j.suppliers.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
 id('mixUpdated').textContent='По '+(j.stats.lastSupplyIso||'—');
 id('mixMeta').textContent='Выбрано '+j.stats.selectedProducts+' · с закупками '+j.stats.productsWithData+' · поставщиков '+j.stats.suppliers+' · записей '+j.stats.matchedDeliveries;
 renderTable();draw();
}
function init(){
 install();
 // An open dashboard also rolls the highlight window forward at midnight Moscow time.
 let previousDay=moscowTodayIso();
 setInterval(()=>{const day=moscowTodayIso();if(day!==previousDay){previousDay=day;renderTable();}},60000);
 load().catch(e=>{
  if(id('mixRows'))id('mixRows').innerHTML='<tr><td colspan="7" class="mix-empty">Данные Микс пока недоступны: '+esc(e.message)+'</td></tr>';
  if(id('mixUpdated'))id('mixUpdated').textContent='Ожидается обновление';
 });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
