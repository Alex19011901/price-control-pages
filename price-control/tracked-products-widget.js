(function(){
  'use strict';

  const DATA_URL='./tracked_products.json';
  const NS='http://www.w3.org/2000/svg';
  const state={data:null,visible:new Set(),loaded:false};

  function esc(v){
    return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmt(v,digits){
    if(v===null||v===undefined||!Number.isFinite(Number(v)))return '—';
    return Number(v).toLocaleString('ru-RU',{minimumFractionDigits:digits||0,maximumFractionDigits:digits==null?2:digits});
  }
  function money(v){
    if(v===null||v===undefined||!Number.isFinite(Number(v)))return '—';
    return Number(v).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽/кг';
  }
  function svg(tag,attrs,text){
    const el=document.createElementNS(NS,tag);
    Object.entries(attrs||{}).forEach(([k,v])=>el.setAttribute(k,String(v)));
    if(text!=null)el.textContent=text;
    return el;
  }
  function timeOf(p){
    const t=Date.parse(String(p.dateIso||'')+'T00:00:00Z');
    return Number.isFinite(t)?t:0;
  }

  function installStyles(){
    if(document.getElementById('trackedProductStyles'))return;
    const style=document.createElement('style');
    style.id='trackedProductStyles';
    style.textContent=`
      .tracked-index-card{margin-top:10px;padding:14px}
      .tracked-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
      .tracked-head .index-title{margin-bottom:0}
      .tracked-period{font-size:12px;color:var(--muted);white-space:nowrap}
      .tracked-layout{display:grid;grid-template-columns:1fr;gap:10px}
      .tracked-chart-box{position:relative;background:#0d1825;border:1px solid var(--line2);border-radius:12px;padding:12px}
      .tracked-controls{display:flex;gap:8px 16px;flex-wrap:wrap;margin-bottom:10px}
      .tracked-toggle{display:inline-flex;align-items:center;gap:7px;color:#c4cfdb;font-size:12px;cursor:pointer;user-select:none}
      .tracked-toggle input{width:15px;height:15px;margin:0;cursor:pointer;accent-color:var(--purple)}
      .tracked-swatch{width:9px;height:9px;border-radius:50%;display:inline-block;flex:0 0 auto}
      #trackedPriceChart{display:block;width:100%;height:300px;overflow:visible}
      .tracked-grid{stroke:#263549;stroke-width:1;stroke-dasharray:4 4}
      .tracked-baseline{stroke:#56657a;stroke-width:1.2;stroke-dasharray:5 4}
      .tracked-axis{fill:#9fb0c5;font-size:11px}
      .tracked-baseline-label{fill:#c4cfdb;font-size:11px;font-weight:700}
      .tracked-line{fill:none;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
      .tracked-point{fill:#0d1825;stroke-width:2.5;cursor:default}
      .tracked-empty{fill:#9fb0c5;font-size:13px}
      .tracked-note{font-size:12px;color:var(--muted);line-height:1.45;margin-top:8px}
      .tracked-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
      .tracked-summary-item{background:#0d1825;border:1px solid var(--line2);border-radius:10px;padding:10px 12px;min-width:0}
      .tracked-summary-name{font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px}
      .tracked-summary-value{font-size:18px;font-weight:800;margin-top:5px}
      .tracked-summary-hint{color:var(--muted);font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      @media(max-width:900px){
        #trackedPriceChart{height:260px}
        .tracked-summary{grid-template-columns:1fr}
        .tracked-head{display:block}
        .tracked-period{margin-top:4px;white-space:normal}
      }
    `;
    document.head.appendChild(style);
  }

  function buildShell(){
    if(document.getElementById('trackedProductIndexCard'))return;
    const anchor=document.querySelector('.index-card');
    if(!anchor)return;
    const section=document.createElement('section');
    section.id='trackedProductIndexCard';
    section.className='card tracked-index-card';
    section.innerHTML=`
      <div class="tracked-head">
        <div>
          <div class="index-title">Динамика цен по товарам</div>
          <div class="hint">Индекс фактической закупочной цены</div>
        </div>
        <div class="tracked-period" id="trackedPeriod">с 01.01.2026</div>
      </div>
      <div class="tracked-layout">
        <div class="tracked-chart-box">
          <div class="tracked-controls" id="trackedControls"></div>
          <svg id="trackedPriceChart" viewBox="0 0 980 300" role="img" aria-label="Динамика индекса цен: Глазной мускул, Лосось, Баклажан"></svg>
          <div class="tracked-note">Для каждого товара первая найденная поставка с 01.01.2026 принимается за 100. Каждая следующая точка — фактическая цена поставки относительно этой базы. Если товар разбит на несколько строк одной накладной, цена рассчитывается по общей сумме и количеству.</div>
        </div>
        <div class="tracked-summary" id="trackedSummary"></div>
      </div>
    `;
    anchor.insertAdjacentElement('afterend',section);
  }

  function buildControls(){
    const box=document.getElementById('trackedControls');
    if(!box||!state.data)return;
    box.innerHTML='';
    for(const p of state.data.products||[]){
      state.visible.add(p.key);
      const label=document.createElement('label');
      label.className='tracked-toggle';
      label.innerHTML='<input type="checkbox" checked data-key="'+esc(p.key)+'"><span class="tracked-swatch" style="background:'+esc(p.color)+'"></span><span>'+esc(p.label)+'</span>';
      const input=label.querySelector('input');
      input.addEventListener('change',function(){
        if(this.checked)state.visible.add(p.key);else state.visible.delete(p.key);
        render();
      });
      box.appendChild(label);
    }
  }

  function latestPoint(product){
    const pts=product.points||[];
    return pts.length?pts[pts.length-1]:null;
  }

  function renderSummary(){
    const box=document.getElementById('trackedSummary');
    if(!box||!state.data)return;
    box.innerHTML=(state.data.products||[]).map(p=>{
      const last=latestPoint(p);
      return '<div class="tracked-summary-item">'+
        '<div class="tracked-summary-name"><span class="tracked-swatch" style="background:'+esc(p.color)+'"></span>'+esc(p.label)+'</div>'+
        '<div class="tracked-summary-value">'+(last?fmt(last.index,1):'—')+'</div>'+
        '<div class="tracked-summary-hint">Последняя поставка: '+(last?esc(last.date):'—')+'</div>'+
        '<div class="tracked-summary-hint">Последняя цена: '+(last?money(last.fact):'—')+'</div>'+
      '</div>';
    }).join('');
  }

  function render(){
    const chart=document.getElementById('trackedPriceChart');
    if(!chart||!state.data)return;
    chart.innerHTML='';

    const visible=(state.data.products||[]).filter(p=>state.visible.has(p.key)&&(p.points||[]).length);
    const all=visible.flatMap(p=>(p.points||[]).map(pt=>({product:p,point:pt,t:timeOf(pt)}))).filter(x=>x.t>0&&Number.isFinite(Number(x.point.index)));
    if(!all.length){
      chart.appendChild(svg('text',{x:490,y:150,'text-anchor':'middle',class:'tracked-empty'},'Выберите товар для отображения'));
      return;
    }

    const W=980,H=300,L=56,R=22,T=18,B=42;
    const innerW=W-L-R,innerH=H-T-B;
    const minT=Math.min(...all.map(x=>x.t)),maxT=Math.max(...all.map(x=>x.t));
    const vals=all.map(x=>Number(x.point.index)).concat([100]);
    let minY=Math.min(...vals),maxY=Math.max(...vals);
    let pad=Math.max(5,(maxY-minY)*0.10);
    minY=Math.floor((minY-pad)/5)*5;
    maxY=Math.ceil((maxY+pad)/5)*5;
    if(maxY-minY<10){minY-=5;maxY+=5}

    const X=t=>L+(maxT===minT?innerW/2:(t-minT)/(maxT-minT)*innerW);
    const Y=v=>T+(maxY-v)/(maxY-minY)*innerH;

    for(let i=0;i<=5;i++){
      const v=minY+(maxY-minY)*i/5;
      const yy=Y(v);
      chart.appendChild(svg('line',{x1:L,y1:yy,x2:W-R,y2:yy,class:'tracked-grid'}));
      chart.appendChild(svg('text',{x:L-9,y:yy+4,'text-anchor':'end',class:'tracked-axis'},fmt(v,0)));
    }

    const baseY=Y(100);
    chart.appendChild(svg('line',{x1:L,y1:baseY,x2:W-R,y2:baseY,class:'tracked-baseline'}));
    chart.appendChild(svg('text',{x:W-R-2,y:baseY-6,'text-anchor':'end',class:'tracked-baseline-label'},'100 · база'));

    const uniqueDates=[...new Map(all.sort((a,b)=>a.t-b.t).map(x=>[x.point.dateIso,x])).values()];
    const tickCount=Math.min(6,uniqueDates.length);
    const ticks=[];
    if(tickCount===1)ticks.push(uniqueDates[0]);
    else{
      for(let i=0;i<tickCount;i++)ticks.push(uniqueDates[Math.round(i*(uniqueDates.length-1)/(tickCount-1))]);
    }
    const seen=new Set();
    for(const x of ticks){
      if(!x||seen.has(x.point.dateIso))continue;
      seen.add(x.point.dateIso);
      const xx=X(x.t);
      chart.appendChild(svg('line',{x1:xx,y1:H-B,x2:xx,y2:H-B+5,stroke:'#56657a','stroke-width':1}));
      chart.appendChild(svg('text',{x:xx,y:H-14,'text-anchor':'middle',class:'tracked-axis'},String(x.point.date||'').slice(0,5)));
    }

    for(const p of visible){
      const pts=(p.points||[]).map(pt=>({pt,t:timeOf(pt)})).filter(x=>x.t>0&&Number.isFinite(Number(x.pt.index))).sort((a,b)=>a.t-b.t||String(a.pt.invoice).localeCompare(String(b.pt.invoice),'ru'));
      if(!pts.length)continue;
      const poly=svg('polyline',{class:'tracked-line',stroke:p.color,points:pts.map(x=>X(x.t).toFixed(1)+','+Y(Number(x.pt.index)).toFixed(1)).join(' ')});
      chart.appendChild(poly);
      for(const x of pts){
        const circle=svg('circle',{class:'tracked-point',cx:X(x.t).toFixed(1),cy:Y(Number(x.pt.index)).toFixed(1),r:4,stroke:p.color});
        const title=svg('title',{},p.label+' · '+x.pt.date+' · индекс '+fmt(x.pt.index,1)+' · '+money(x.pt.fact)+' · '+x.pt.supplier+' · '+x.pt.invoice);
        circle.appendChild(title);
        chart.appendChild(circle);
      }
    }
  }

  function showError(text){
    const chart=document.getElementById('trackedPriceChart');
    if(!chart)return;
    chart.innerHTML='';
    chart.appendChild(svg('text',{x:490,y:150,'text-anchor':'middle',class:'tracked-empty'},text));
  }

  async function load(){
    try{
      const r=await fetch(DATA_URL+'?cb='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json();
      if(!data||!Array.isArray(data.products))throw new Error('Некорректные данные');
      state.data=data;
      state.loaded=true;
      const period=document.getElementById('trackedPeriod');
      if(period)period.textContent='с '+String(data.start||'01.01.2026');
      buildControls();
      renderSummary();
      render();
    }catch(e){
      showError('Не удалось загрузить данные виджета');
    }
  }

  function init(){
    installStyles();
    buildShell();
    if(document.getElementById('trackedProductIndexCard'))load();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
