(function(){
  'use strict';

  const DATA_URL='./full.json';
  const MAX_PREVIOUS=5;
  const state={data:null};

  function esc(v){
    return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmt(v){
    if(v===null||v===undefined||!Number.isFinite(Number(v)))return '—';
    return Number(v).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2});
  }
  function money(v,unit){
    if(v===null||v===undefined||!Number.isFinite(Number(v)))return '—';
    return fmt(v)+' ₽/'+esc(unit||'ед.');
  }
  function normName(v){
    return String(v==null?'':v)
      .toLowerCase()
      .replace(/ё/g,'е')
      .replace(/\u00a0/g,' ')
      .replace(/^\s*\d{4,}\s*[·|:\-]?\s*/,'')
      .replace(/\s+/g,' ')
      .trim();
  }
  function normUnit(v){
    return String(v==null?'':v).toLowerCase().replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  }
  function productKey(row){return normName(row[0])+'\u0000'+normUnit(row[4])}
  function dateKey(v){
    const m=String(v||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m?m[3]+m[2]+m[1]:String(v||'');
  }
  function invoiceRank(v){
    const s=String(v||'');
    const nums=s.match(/\d+/g);
    const n=nums&&nums.length?Number(nums[nums.length-1]):NaN;
    return {n:Number.isFinite(n)?n:-1,s};
  }
  function compareInvoiceDesc(a,b){
    const ra=invoiceRank(a),rb=invoiceRank(b);
    if(ra.n!==rb.n)return rb.n-ra.n;
    return rb.s.localeCompare(ra.s,'ru');
  }
  function compareDeliveryDesc(a,b){
    const dd=dateKey(b.date).localeCompare(dateKey(a.date));
    return dd||compareInvoiceDesc(a.invoice,b.invoice);
  }
  function isBefore(delivery,base){
    const d=dateKey(delivery.date),b=dateKey(base.date);
    if(d!==b)return d<b;
    return compareInvoiceDesc(delivery.invoice,base.invoice)>0;
  }
  function priceForRows(rows){
    let qty=0,total=0,fallback=null;
    for(const r of rows){
      const q=Number(r[3]),p=Number(r[6]);
      if(Number.isFinite(p))fallback=p;
      if(Number.isFinite(q)&&q>0&&Number.isFinite(p)){
        qty+=q;
        total+=q*p;
      }
    }
    if(qty>0)return total/qty;
    return fallback;
  }

  function installStyles(){
    if(document.getElementById('purchaseHistoryStyles'))return;
    const style=document.createElement('style');
    style.id='purchaseHistoryStyles';
    style.textContent=`
      .purchase-history-card{margin-top:10px;overflow:hidden}
      .purchase-history-head{padding:12px 14px;border-bottom:1px solid var(--line2);display:flex;justify-content:space-between;gap:12px;align-items:center}
      .purchase-history-head strong{font-size:16px}
      .purchase-history-date{font-size:11px;color:var(--muted);white-space:nowrap}
      .purchase-history-wrap{overflow-x:auto}
      .purchase-history-table{width:100%;min-width:1080px;border-collapse:collapse;table-layout:fixed;font-size:10px}
      .purchase-history-table th,.purchase-history-table td{padding:8px 7px;border-bottom:1px solid var(--line2);white-space:nowrap;vertical-align:middle;text-align:right}
      .purchase-history-table th{position:static;background:#0f1a28;color:#aebdd0;font-weight:600}
      .purchase-history-table th:first-child,.purchase-history-table td:first-child{text-align:left;width:270px}
      .purchase-history-table th:not(:first-child),.purchase-history-table td:not(:first-child){width:135px}
      .purchase-history-name{font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis}
      .purchase-history-current{font-size:11px;font-weight:800;color:var(--text)}
      .purchase-history-past{color:#c4cfdb}
      .purchase-history-past-date{color:var(--muted);margin-right:5px}
      .purchase-history-empty{padding:16px 14px;color:var(--muted);font-size:12px}
      .purchase-history-note{padding:9px 14px 11px;color:var(--muted);font-size:10px;line-height:1.35}
      @media(max-width:900px){
        .purchase-history-head{align-items:flex-start;flex-direction:column;gap:3px}
      }
    `;
    document.head.appendChild(style);
  }

  function buildShell(){
    if(document.getElementById('purchaseHistoryCard'))return true;
    const anchor=document.querySelector('.table-card');
    if(!anchor)return false;
    const section=document.createElement('section');
    section.id='purchaseHistoryCard';
    section.className='card purchase-history-card';
    section.innerHTML=`
      <div class="purchase-history-head">
        <strong>История цен прихода</strong>
        <span class="purchase-history-date" id="purchaseHistoryDate">—</span>
      </div>
      <div class="purchase-history-wrap">
        <table class="purchase-history-table">
          <thead><tr>
            <th>Товар</th>
            <th id="purchaseHistoryBaseHead">Выбранная</th>
            <th>Пред. 1</th>
            <th>Пред. 2</th>
            <th>Пред. 3</th>
            <th>Пред. 4</th>
            <th>Пред. 5</th>
          </tr></thead>
          <tbody id="purchaseHistoryBody"></tbody>
        </table>
      </div>
      <div class="purchase-history-note">База — выбранная сверху накладная. При «Все накладные» берётся последняя накладная выбранного периода. Для каждого товара показываются 5 предыдущих фактических цен; если товара не было в ближайшей поставке, поиск идёт дальше назад.</div>
    `;
    anchor.insertAdjacentElement('afterend',section);
    return true;
  }

  function allRows(data){
    const out=[];
    for(const period of (data.periods||[])){
      for(const row of (period.rowsData||[])){
        if(Array.isArray(row)&&row.length>=7)out.push(row);
      }
    }
    return out;
  }

  function collapseDeliveries(rows){
    const groups=new Map();
    for(const row of rows){
      const key=productKey(row)+'\u0000'+String(row[1]||'')+'\u0000'+String(row[2]||'');
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(row);
    }
    const deliveries=[];
    for(const group of groups.values()){
      const r=group[0];
      const price=priceForRows(group);
      if(!Number.isFinite(Number(price)))continue;
      deliveries.push({
        key:productKey(r),
        name:String(r[0]||''),
        unit:String(r[4]||''),
        date:String(r[1]||''),
        invoice:String(r[2]||''),
        price:Number(price)
      });
    }
    return deliveries;
  }

  function selectedPeriod(data){
    const week=document.getElementById('weekFilter');
    const key=week&&week.value?week.value:data.currentKey;
    return (data.periods||[]).find(p=>p.key===key)||((data.periods||[])[0]||null);
  }

  function latestInvoiceInPeriod(period){
    if(!period)return '';
    const seen=new Map();
    for(const r of (period.rowsData||[])){
      const invoice=String(r[2]||'');
      const date=String(r[1]||'');
      if(!invoice)continue;
      const old=seen.get(invoice);
      if(!old||dateKey(date)>dateKey(old.date))seen.set(invoice,{invoice,date});
    }
    return [...seen.values()].sort(compareDeliveryDesc)[0]?.invoice||'';
  }

  function baseInvoice(period){
    const filter=document.getElementById('invoiceFilter');
    const selected=filter&&filter.value?filter.value:'';
    return selected||latestInvoiceInPeriod(period);
  }

  function baseDeliveries(period,invoice){
    if(!period||!invoice)return [];
    return collapseDeliveries((period.rowsData||[]).filter(r=>String(r[2]||'')===invoice)).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  }

  function previousForProduct(allDeliveries,base){
    const candidates=allDeliveries.filter(d=>d.key===base.key&&isBefore(d,base));
    const latestByDay=new Map();
    for(const d of candidates){
      const old=latestByDay.get(d.date);
      if(!old||compareInvoiceDesc(d.invoice,old.invoice)<0)latestByDay.set(d.date,d);
    }
    return [...latestByDay.values()].sort(compareDeliveryDesc).slice(0,MAX_PREVIOUS);
  }

  function render(data){
    const body=document.getElementById('purchaseHistoryBody');
    const dateEl=document.getElementById('purchaseHistoryDate');
    const baseHead=document.getElementById('purchaseHistoryBaseHead');
    if(!body||!dateEl||!baseHead)return;

    const period=selectedPeriod(data);
    const invoice=baseInvoice(period);
    const base=baseDeliveries(period,invoice);
    const deliveries=collapseDeliveries(allRows(data));

    if(!invoice||!base.length){
      dateEl.textContent='Нет данных';
      baseHead.textContent='Выбранная';
      body.innerHTML='<tr><td colspan="7"><div class="purchase-history-empty">В выбранной накладной нет товаров</div></td></tr>';
      return;
    }

    const baseDate=base[0].date||'';
    dateEl.textContent=invoice+(baseDate?' · '+baseDate:'');
    baseHead.textContent=invoice;

    body.innerHTML=base.map(current=>{
      const previous=previousForProduct(deliveries,current);
      const cells=[];
      cells.push('<td class="purchase-history-name" title="'+esc(current.name)+'">'+esc(current.name)+'</td>');
      cells.push('<td class="purchase-history-current">'+money(current.price,current.unit)+'</td>');
      for(let i=0;i<MAX_PREVIOUS;i++){
        const d=previous[i];
        cells.push(d
          ?'<td class="purchase-history-past" title="'+esc(d.invoice)+'"><span class="purchase-history-past-date">'+esc(String(d.date).slice(0,5))+'</span>'+money(d.price,d.unit)+'</td>'
          :'<td class="purchase-history-past">—</td>');
      }
      return '<tr>'+cells.join('')+'</tr>';
    }).join('');
  }

  function showError(){
    const body=document.getElementById('purchaseHistoryBody');
    const dateEl=document.getElementById('purchaseHistoryDate');
    if(dateEl)dateEl.textContent='Ошибка загрузки';
    if(body)body.innerHTML='<tr><td colspan="7"><div class="purchase-history-empty">Не удалось загрузить историю поставок</div></td></tr>';
  }

  function queueRender(){
    if(!state.data)return;
    requestAnimationFrame(()=>render(state.data));
  }

  async function load(){
    try{
      const r=await fetch(DATA_URL+'?cb='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json();
      if(!data||!Array.isArray(data.periods))throw new Error('Некорректные данные');
      state.data=data;
      render(data);
    }catch(e){
      showError();
    }
  }

  function bindFilters(){
    document.addEventListener('change',event=>{
      const target=event.target;
      if(!target)return;
      if(target.id==='weekFilter'||target.id==='invoiceFilter')queueRender();
    },true);

    const observer=new MutationObserver(mutations=>{
      if(mutations.some(m=>m.type==='attributes'&&m.attributeName==='data-last-applied-generated-at'))load();
    });
    observer.observe(document.body,{attributes:true,attributeFilter:['data-last-applied-generated-at']});
  }

  function init(){
    installStyles();
    if(buildShell()){
      bindFilters();
      load();
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
