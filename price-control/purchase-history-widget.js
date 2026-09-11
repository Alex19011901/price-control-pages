(function(){
  'use strict';

  const DATA_URL='./full.json';
  const MAX_PREVIOUS=5;

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
            <th>Сегодня</th>
            <th>Пред. 1</th>
            <th>Пред. 2</th>
            <th>Пред. 3</th>
            <th>Пред. 4</th>
            <th>Пред. 5</th>
          </tr></thead>
          <tbody id="purchaseHistoryBody"></tbody>
        </table>
      </div>
      <div class="purchase-history-note">Для каждого товара берётся последняя накладная дня. Если товара не было в предыдущей поставке, поиск идёт дальше назад до ближайшей поставки этого товара.</div>
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

  function latestByProductAndDay(deliveries){
    const byProduct=new Map();
    for(const d of deliveries){
      if(!byProduct.has(d.key))byProduct.set(d.key,new Map());
      const byDay=byProduct.get(d.key);
      const old=byDay.get(d.date);
      if(!old||compareInvoiceDesc(d.invoice,old.invoice)<0)byDay.set(d.date,d);
    }
    const result=new Map();
    for(const [key,byDay] of byProduct){
      result.set(key,[...byDay.values()].sort((a,b)=>{
        const dd=dateKey(b.date).localeCompare(dateKey(a.date));
        return dd||compareInvoiceDesc(a.invoice,b.invoice);
      }));
    }
    return result;
  }

  function currentDateFromCurrentPeriod(data){
    const current=(data.periods||[]).find(p=>p.key===data.currentKey)||((data.periods||[])[0]||null);
    if(!current)return '';
    const dates=(current.rowsData||[]).map(r=>String(r[1]||'')).filter(Boolean);
    return dates.sort((a,b)=>dateKey(b).localeCompare(dateKey(a)))[0]||'';
  }

  function render(data){
    const body=document.getElementById('purchaseHistoryBody');
    const dateEl=document.getElementById('purchaseHistoryDate');
    if(!body||!dateEl)return;

    const rows=allRows(data);
    const deliveries=collapseDeliveries(rows);
    const history=latestByProductAndDay(deliveries);
    const currentDate=currentDateFromCurrentPeriod(data);
    dateEl.textContent=currentDate?'Последняя поставка: '+currentDate:'Нет данных';

    if(!currentDate){
      body.innerHTML='<tr><td colspan="7"><div class="purchase-history-empty">Нет данных о поставках</div></td></tr>';
      return;
    }

    const current=[];
    for(const list of history.values()){
      if(list.length&&list[0].date===currentDate)current.push(list[0]);
    }
    current.sort((a,b)=>a.name.localeCompare(b.name,'ru'));

    if(!current.length){
      body.innerHTML='<tr><td colspan="7"><div class="purchase-history-empty">Нет товаров в последней поставке</div></td></tr>';
      return;
    }

    body.innerHTML=current.map(today=>{
      const list=history.get(today.key)||[];
      const previous=list.filter(d=>d.date!==currentDate).slice(0,MAX_PREVIOUS);
      const cells=[];
      cells.push('<td class="purchase-history-name" title="'+esc(today.name)+'">'+esc(today.name)+'</td>');
      cells.push('<td class="purchase-history-current">'+money(today.price,today.unit)+'</td>');
      for(let i=0;i<MAX_PREVIOUS;i++){
        const d=previous[i];
        cells.push(d
          ?'<td class="purchase-history-past"><span class="purchase-history-past-date">'+esc(String(d.date).slice(0,5))+'</span>'+money(d.price,d.unit)+'</td>'
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

  async function load(){
    try{
      const r=await fetch(DATA_URL+'?cb='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json();
      if(!data||!Array.isArray(data.periods))throw new Error('Некорректные данные');
      render(data);
    }catch(e){
      showError();
    }
  }

  function init(){
    installStyles();
    if(buildShell())load();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
