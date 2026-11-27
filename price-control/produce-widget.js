(function(){
 'use strict';
 const id=k=>document.getElementById(k);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=(v,d=2)=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:d});
 const urls=['./purchase_history.json','./full.json','./produce_receipts.json'];
 let state=null,visible=[];
 function date(s){return String(s||'').split('-').reverse().join('.')}
 function install(){
  if(id('produceCard'))return;
  const anchor=id('mixIndexCard')||id('mixCard')||id('purchaseHistoryCard')||document.querySelector('.table-card');
  if(!anchor)return;
  const css=document.createElement('style');css.id='produceStyles';
  css.textContent=[
   '.produce-card{margin-top:12px;padding:14px;min-width:0;overflow:hidden}',
   '.produce-head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px}',
   '.produce-head h2{font-size:17px;font-weight:800;margin:0;color:var(--text)}',
   '.produce-meta,.produce-note{font-size:11px;color:var(--muted);line-height:1.5;margin-top:7px}',
   '.produce-tools{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}',
   '.produce-tools label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--muted)}',
   '.produce-tools input,.produce-tools select{min-width:125px;padding:7px 9px;border:1px solid var(--line2);border-radius:8px;background:#0d1825;color:var(--text);font:inherit}',
   '.produce-scroll{overflow-x:auto;border:1px solid var(--line2);border-radius:10px}',
   '.produce-table{width:100%;min-width:1040px;border-collapse:collapse;table-layout:fixed;font-size:11px}',
   '.produce-table th,.produce-table td{padding:8px;border-bottom:1px solid var(--line2);text-align:right;vertical-align:top}',
   '.produce-table th{background:#101b2a;color:#aebdd0;font-weight:700}',
   '.produce-table th:first-child,.produce-table td:first-child{width:224px;text-align:left}',
   '.produce-group td{background:#182838;color:#dce8f5;font-weight:800;text-align:left!important}',
   '.produce-table tbody tr:last-child td{border-bottom:0}',
   '.produce-name,.produce-price{font-weight:700;color:var(--text)}',
   '.produce-muted{color:var(--muted);font-size:10px}',
   '.produce-date{color:var(--muted);font-size:10px}',
   '.produce-date.today,.produce-date.yesterday,.produce-date.before-yesterday{display:inline-block;padding:2px 5px;border-radius:4px;font-weight:800}',
   '.produce-date.today{background:#2bd673;color:#082016}',
   '.produce-date.yesterday{background:#ffd24c;color:#302100}',
   '.produce-date.before-yesterday{background:#9254ef;color:#fff}',
   '.produce-recent-meta{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:0 0 9px;font-size:11px;color:var(--muted)}',
   '.produce-entry{display:block;width:100%;border:0;background:none;color:inherit;font:inherit;text-align:right;padding:0;cursor:pointer}',
   '.produce-entry:focus-visible{outline:1px solid #829bb4;outline-offset:2px;border-radius:3px}',
   '.produce-detail{margin-top:9px;padding:9px 11px;border:1px solid var(--line2);border-radius:8px;font-size:11px;line-height:1.6}',
   '.produce-detail[hidden]{display:none}',
   '.produce-empty{color:var(--muted);text-align:center!important}',
   '@media(max-width:600px){.produce-card{padding:10px}.produce-tools{gap:7px}.produce-tools input,.produce-tools select{min-width:110px}}'
  ].join('\n');
  document.head.appendChild(css);
  const s=document.createElement('section');s.id='produceCard';s.className='card produce-card';
  s.innerHTML='<div class="produce-head"><h2>Растительность</h2><span class="produce-muted" id="produceThrough">—</span></div>'+
   '<div class="produce-meta" id="produceMeta">Загрузка истории закупок…</div>'+
   '<div class="produce-tools"><label>Категория<select id="produceGroup"><option value="">Все категории</option></select></label>'+
   '<label>Поставщик<select id="produceSupplier"><option value="">Все поставщики</option></select></label>'+
   '<label>Название<input id="produceSearch" type="search" placeholder="Поиск товара"></label>'+
   '<label>Последняя закупка<select id="produceRecent"><option value="">Все даты</option><option value="recent">Последние 3 дня</option><option value="today">Сегодня</option><option value="yesterday">Вчера</option><option value="before-yesterday">Позавчера</option></select></label>'+
   '<label>Закупок в строке<select id="produceCount"><option value="6">6</option><option value="12">12</option><option value="24">24</option><option value="all">Все</option></select></label></div>'+
   '<div class="produce-recent-meta" id="produceRecentMeta"></div>'+
   '<div class="produce-scroll"><table class="produce-table" id="produceTable"><thead id="produceHead"></thead><tbody id="produceRows"><tr><td colspan="7" class="produce-empty">Загрузка…</td></tr></tbody></table></div>'+
   '<div class="produce-detail" id="produceDetail" hidden aria-live="polite"></div>'+
   '<div class="produce-note">Фактические закупочные цены по накладным DocsInBox, без заморозки, солений и переработанных продуктов. Все цены в ₽/кг: весовые товары — по фактической цене; упаковки — по указанному весу. Если вес неизвестен, цена за кг не рассчитывается. Сорта томатов разделены. Нажмите на закупку, чтобы увидеть исходное название и накладную. Виджет не входит в индекс «Микс» и не изменяет другие индексы.</div>';
  anchor.insertAdjacentElement('afterend',s);
  for(const k of ['produceGroup','produceSupplier','produceSearch','produceCount','produceRecent'])id(k).addEventListener(k==='produceSearch'?'input':'change',render);
  id('produceRows').addEventListener('click',e=>{
   const button=e.target.closest('button[data-p][data-r]');if(!button)return;
   const row=visible[Number(button.dataset.p)]?.deliveries[Number(button.dataset.r)];
   if(!row)return;
   const detail=id('produceDetail');detail.hidden=false;
   detail.innerHTML='<strong>'+esc(row.name)+'</strong><br>'+esc(row.date)+' · '+esc(row.supplier)+' · Накладная '+esc(row.invoice)+
    '<br>Количество: '+fmt(row.qty,3)+' '+esc(row.unit)+' · Сумма: '+fmt(row.sum)+' ₽'+
    (row.kg!=null?' · Вес: '+fmt(row.kg,3)+' кг':' · Вес не подтверждён')+
    (row.price!=null?' · '+fmt(row.price)+' ₽/кг':'')+
    (row.archive?'<br><span class="produce-muted">Источник: ранее сохранённая накладная.</span>':'');
  });
 }
 function cell(r,p,i,today){
  if(!r)return '<td class="produce-empty">—</td>';
  const title=[r.date,r.supplier,r.invoice,r.name,fmt(r.qty,3)+' '+r.unit,fmt(r.sum)+' ₽',r.kg!=null?fmt(r.kg,3)+' кг':'Вес неизвестен'].join(' · ');
  const dateClass=i===0?ProduceCore.recentDateClass(r.dateIso,today):'';
  return '<td><button type="button" class="produce-entry" data-p="'+p+'" data-r="'+i+'" title="'+esc(title)+'">'+
    '<div class="produce-date'+(dateClass?' '+dateClass:'')+'">'+esc(r.date.slice(0,5))+'</div><div class="produce-price">'+
    (r.price==null?'—':fmt(r.price)+' ₽/кг')+'</div><div class="produce-muted">'+esc(r.supplier)+'</div>'+
    (r.price==null?'<div class="produce-muted">Нет веса</div>':'')+'</button></td>';
 }
 function render(){
  if(!state)return;
  const g=id('produceGroup').value,s=id('produceSupplier').value,q=ProduceCore.norm(id('produceSearch').value);
  visible=state.products.filter(p=>!g||p.group===g).map(p=>({...p,deliveries:p.deliveries.filter(r=>!s||r.supplier===s)}))
   .filter(p=>p.deliveries.length&&(!q||ProduceCore.norm(p.label).includes(q)||p.deliveries.some(r=>ProduceCore.norm(r.name).includes(q))));
  const today=ProduceCore.moscowTodayIso(),recent=id('produceRecent').value;
  const counts={'today':0,'yesterday':0,'before-yesterday':0};
  for(const p of visible){
   const key=ProduceCore.recentDateClass(p.deliveries[0].dateIso,today);
   if(key)counts[key]++;
  }
  id('produceRecentMeta').innerHTML='<span>Последние закупки (МСК):</span>'+
   [['today','Сегодня'],['yesterday','Вчера'],['before-yesterday','Позавчера']].map(([key,label])=>'<span class="produce-date '+key+'">'+label+' · '+counts[key]+'</span>').join('');
  if(recent)visible=visible.filter(p=>{
   const key=ProduceCore.recentDateClass(p.deliveries[0].dateIso,today);
   return recent==='recent'?!!key:key===recent;
  });
  const limit=id('produceCount').value==='all'?Math.max(1,...visible.map(p=>p.deliveries.length)):Number(id('produceCount').value);
  id('produceTable').style.minWidth=Math.max(1040,224+limit*136)+'px';
  id('produceHead').innerHTML='<tr><th>Товар</th><th>Последняя закупка</th>'+Array.from({length:limit-1},(_,i)=>'<th>Пред. '+(i+1)+'</th>').join('')+'</tr>';
  let html='';
  for(const group of state.groups){
   const rows=visible.filter(p=>p.group===group.id);if(!rows.length)continue;
   html+='<tr class="produce-group"><td colspan="'+(limit+1)+'">'+esc(group.label)+' · '+rows.length+'</td></tr>';
   for(const p of rows){
    const pi=visible.indexOf(p);
    html+='<tr><td><div class="produce-name">'+esc(p.label)+'</div><div class="produce-muted">'+p.deliveries.length+' закупок</div></td>'+
      Array.from({length:limit},(_,i)=>cell(p.deliveries[i],pi,i,today)).join('')+'</tr>';
   }
  }
  id('produceRows').innerHTML=html||'<tr><td colspan="'+(limit+1)+'" class="produce-empty">Нет закупок по выбранным фильтрам</td></tr>';
  id('produceDetail').hidden=true;
 }
 async function get(url){
  const r=await fetch(url+'?cb='+Date.now(),{cache:'no-store'});
  if(!r.ok)throw Error('HTTP '+r.status);
  return r.json();
 }
 async function init(){
  install();if(!id('produceCard'))return;
  try{
   const results=await Promise.allSettled(urls.map(get));
   const h=results[0].status==='fulfilled'?results[0].value:null;
   const f=results[1].status==='fulfilled'?results[1].value:null;
   const raw=results[2].status==='fulfilled'?results[2].value:null;
   if(!h&&!f&&!raw)throw Error('Источники недоступны');
   state=ProduceCore.buildHistory(h,f,raw);
   const s=state.stats;
   id('produceGroup').innerHTML='<option value="">Все категории</option>'+state.groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.label)+'</option>').join('');
   id('produceSupplier').innerHTML='<option value="">Все поставщики</option>'+state.suppliers.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
   id('produceThrough').textContent=s.to?'Закупки по '+date(s.to):'Нет закупок';
   const status=s.scanComplete?'DocsInBox проверен по '+date(s.scanThrough):'Пока показана ранее сохранённая история; полная выгрузка не подтверждена';
   id('produceMeta').textContent='Позиций '+s.products+' · закупок '+s.deliveries+' · поставщиков '+s.suppliers+
    (s.from?' · период '+date(s.from)+' — '+date(s.to):'')+' · '+status+
    (s.unknownWeight?' · без подтверждённого веса '+s.unknownWeight:'')+
    (s.scanComplete&&s.archiveOnly?' · архивных накладных '+s.archiveOnly:'')+
    ((!h||!f)?' · часть архивных источников недоступна':'');
   render();
   let previousDay=ProduceCore.moscowTodayIso();
   setInterval(()=>{const day=ProduceCore.moscowTodayIso();if(day!==previousDay){previousDay=day;render();}},60000);
  }catch(e){id('produceMeta').textContent='Ошибка загрузки: '+e.message;id('produceRows').innerHTML='<tr><td colspan="7" class="produce-empty">Данные недоступны</td></tr>'}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
