(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.ProduceCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const GROUPS=[['veg','Овощи'],['fruit','Фрукты'],['berry','Ягоды'],['green','Зелень'],['salad','Салаты'],['mushroom','Грибы']].map(([id,label])=>({id,label}));
 const norm=s=>String(s??'').toLowerCase().replace(/ё/g,'е').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
 const iso=s=>{const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:''};
 const round2=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
 const unit=s=>norm(s).replace(/\./g,'');
 function cleanName(s){
  return norm(s).replace(/^[!*+/\s]+/,'').replace(/\s*\([^()]*(?:\d{5,}|[а-яa-z]{2}-\d{5,})[^()]*\)\s*$/i,'')
   .replace(/(?:,\s*(?:кг|шт|штука|упак|упаковка|г|гр)\.?\s*)+$/i,'').replace(/^[~\s]*(?:\d+(?:[.,]\d+)?\s*(?:кг|гр|г)\s*)/,'').trim();
 }
 const blocked=/(?:с\s*\/\s*м\b|с\s*\/\s*м(?=[^а-я]|$)|заморож|морожен|быстрозам|солен|квашен|маринован|консерв|вялен|сушен|сухофрукт|пюре|паста|кетчуп|соус|сироп|душист|молот|(?:^|[^а-я])фри(?=[^а-я]|$)|ж\/б|ст\/б|в собственном соку|в т\/с|в масле|очищ целые|готовый салат|по-корейски|кристаллич|напиток|сок\s+\d|сублимир)/;
 const rules=[
  ['veg','Брокколи',/^(?:капуста\s+)?брокколи/],
  ['veg','Капуста цветная',/^капуста\s+цветн/],
  ['veg','Капуста пекинская',/^(?:капуста\s+(?:пекин|китай)|салат китайск)/],
  ['veg','Капуста краснокочанная',/^капуста\s+краснокоч/],
  ['veg','Капуста белокочанная',/^капуста(?:\s+(?:б\/к|белокоч))?(?:\s|$)/],
  ['veg','Баклажаны',/^баклаж/],['veg','Кабачки',/^кабач/],['veg','Цукини',/^цуккин|^цукин/],
  ['veg','Батат',/^(?:картофель\s+)?батат/],
  ['veg','Картофель',/^картоф/],['veg','Морковь',/^морков/],
  ['veg','Огурцы',/^огурц/],['veg','Перец',/^перец/],
  ['veg','Редис',/^редис/],['veg','Дайкон',/^дайкон/],['veg','Свёкла',/^свекл/],
  ['veg','Тыква',/^тыкв/],['veg','Имбирь',/^(?:корень\s+)?имбир/],
  ['veg','Сельдерей корень',/^корень\s+сельдер|^сельдерей\s+корень/],
  ['veg','Сельдерей стебель',/^стебель\s+сельдер|^сельдерей\s+(?:стебель|черешк)/],
  ['veg','Сельдерей',/^сельдер/],['veg','Спаржа',/^спарж/],['veg','Фенхель',/^фенхел/],
  ['veg','Лук',/^лук/],['veg','Чеснок',/^чеснок/],
  ['veg','Горошек сладкий',/^горошек\s+(?:сладкий|стручковый|свежий)/],
  ['veg','Фасоль стручковая',/^фасоль\s+(?:стручк|свеж)/],
  ['veg','Кукуруза свежая',/^кукуруза\s+(?:свеж|почат|молод|мини)/],
  ['fruit','Абрикосы',/^абрикос/],['fruit','Авокадо',/^авокад/],['fruit','Ананас',/^ананас/],
  ['fruit','Апельсины',/^апельсин/],['fruit','Арбуз',/^арбуз/],['fruit','Виноград',/^виноград/],
  ['fruit','Грейпфрут',/^грейпфрут/],['fruit','Груша',/^груш/],['fruit','Дыня',/^дын/],
  ['fruit','Киви',/^киви/],['fruit','Лайм',/^лайм/],['fruit','Лимоны',/^лимон/],
  ['fruit','Мандарины',/^мандарин/],['fruit','Манго',/^манго/],['fruit','Маракуйя',/^(?:пейшен|пешен|маракуй)/],
  ['fruit','Нектарины',/^нектарин/],['fruit','Персики',/^персик/],['fruit','Хурма',/^хурм/],
  ['fruit','Яблоки',/^яблок/],['fruit','Бананы',/^банан/],['fruit','Слива',/^слив[аы](?:\s|$)/],
  ['fruit','Гранат',/^гранат/],['fruit','Инжир свежий',/^инжир/],['fruit','Папайя',/^папай/],
  ['fruit','Помело',/^помело/],['fruit','Кокос свежий',/^кокос(?:\s|$)/],
  ['berry','Голубика',/^голубик/],['berry','Ежевика',/^ежевик/],['berry','Клубника',/^клубник/],
  ['berry','Малина',/^малин/],['berry','Вишня',/^вишн/],['berry','Черешня',/^черешн/],
  ['berry','Смородина',/^смородин/],['berry','Клюква',/^клюкв/],['berry','Брусника',/^брусник/],
  ['berry','Черника',/^черник/],['berry','Земляника',/^земляник/],['berry','Крыжовник',/^крыжовник/],
  ['green','Базилик',/^базилик/],['green','Кинза',/^кинз/],['green','Мята',/^мят/],
  ['green','Петрушка',/^петруш/],['green','Розмарин',/^розмарин/],['green','Тимьян',/^тимьян/],
  ['green','Укроп',/^укроп/],['green','Щавель',/^щавел/],['green','Эстрагон (тархун)',/^(?:эстрагон|тархун)/],
  ['green','Лемонграсс',/^(?:трава\s+лимон|лемонграсс|лимонная трава)/],['green','Черемша',/^черемш/],
  ['green','Зелень',/^зелень/],['green','Микрозелень',/^микрозелен/],
  ['salad','Айсберг',/^(?:салат\s+)?айсберг/],['salad','Лолло росса',/^(?:салат\s+)?лолло\s+рос/],
  ['salad','Романо',/^(?:салат\s+)?романо/],['salad','Радиччо',/^(?:салат\s+)?радич/],
  ['salad','Руккола',/^(?:салат\s+)?рук[к]?ол/],['salad','Корн',/^(?:салат\s+)?корн(?:\s|$)/],
  ['salad','Месклам',/^(?:салат\s+)?мескл/],['salad','Фризе',/^(?:салат\s+)?фризе/],
  ['salad','Шпинат',/^(?:салат\s+)?шпинат/],['salad','Мангольд',/^(?:салат\s+)?мангольд/],
  ['salad','Салат листовой',/^салат\s+(?:листов|латук|дуболист|батав|фриллис|микс)/],
  ['mushroom','Вешенки',/^(?:грибы?\s+)?вешен/],['mushroom','Шампиньоны',/^(?:грибы?\s+)?шампин/],
  ['mushroom','Лисички',/^(?:грибы?\s+)?лисич/],['mushroom','Белые грибы',/^грибы?\s+бел/],
  ['mushroom','Шиитаке',/^(?:грибы?\s+)?шиитак/],['mushroom','Опята',/^(?:грибы?\s+)?опят/],
 ];
 function title(s){return s?s[0].toUpperCase()+s.slice(1):s}
 function tomato(n){
  if(!/^(?:томаты?|помидоры?)(?:\s|$|\s*[,.(])/.test(n))return null;
  if(/черри/.test(n)){
   if(/банч|на ветк/.test(n))return 'Томаты черри Банч';
   if(/красн/.test(n))return 'Томаты черри красные';
   if(/желт/.test(n))return 'Томаты черри жёлтые';
   if(/розов/.test(n))return 'Томаты черри розовые';
   if(/микс|ассорти/.test(n))return 'Томаты черри микс';
   return 'Томаты черри';
  }
  if(/биф/.test(n)){
   if(/азербайдж/.test(n))return 'Томаты биф Азербайджан';
   if(/узбекистан|узбек/.test(n))return 'Томаты биф Узбекистан';
   return 'Томаты биф';
  }
  if(/плам|сливовид/.test(n))return 'Томаты Плам сливовидные';
  if(/розов/.test(n)){
   if(/дагестан/.test(n))return 'Томаты розовые Дагестан';
   if(/парада[йи]з/.test(n))return 'Томаты розовые Парадайз';
   if(/узбек/.test(n))return 'Томаты розовые Узбекистан';
   return 'Томаты розовые';
  }
  if(/банч/.test(n))return 'Томаты Банч';
  if(/на ветк/.test(n))return 'Томаты на ветке';
  if(/средн/.test(n))return 'Томаты средние';
  if(/красн/.test(n))return 'Томаты красные';
  if(/узбек/.test(n))return 'Томаты Узбекистан';
  if(/азербайдж/.test(n))return 'Томаты Азербайджан';
  const tail=n.replace(/^(?:томаты?|помидоры?)\s*/,'').replace(/\bстандарт\b/g,'').replace(/(?:^|\s)(?:стандарт|свежие|свежий|вес|имп\.?)(?=\s|$)/g,' ').trim();
  return tail&&/^[а-я]/.test(tail)?'Томаты — '+tail:'Томаты (сорт не указан)';
 }
 function variant(base,n){
  switch(base){
   case 'Авокадо':return /х(?:аас|асс|ас)/.test(n)?'Авокадо Хасс':/зелен/.test(n)?'Авокадо зелёное':base;
   case 'Ананас':return /дель монте|del monte/.test(n)?'Ананас Del Monte':/голд|gold/.test(n)?'Ананас Голд':base;
   case 'Апельсины':return /для сока|(?:^|\s)сок(?:\s|$)/.test(n)?'Апельсины для сока':/крупн/.test(n)?'Апельсины крупные':base;
   case 'Виноград':return /ред глоб|red glob/.test(n)?'Виноград Ред Глоб':/кримсон|crimson/.test(n)?'Виноград Кримсон':/розов/.test(n)?'Виноград розовый':/белый|зелен/.test(n)?'Виноград зелёный':/черн/.test(n)?'Виноград чёрный':base;
   case 'Грейпфрут':return /розов/.test(n)?'Грейпфрут розовый':base;
   case 'Груша':return /конференц/.test(n)?'Груша Конференц':base;
   case 'Дыня':return /медов/.test(n)?'Дыня медовая':/торпед/.test(n)?'Дыня Торпеда':base;
   case 'Яблоки':return /гольден|golden/.test(n)?'Яблоки Гольден':/гренни|granny/.test(n)?'Яблоки Гренни Смит':/гала/.test(n)?'Яблоки Гала':base;
   case 'Картофель':return /мини.*элит/.test(n)?'Картофель мини элитный':/мини/.test(n)?'Картофель мини':/белый.*мыт/.test(n)?'Картофель белый мытый':/красн/.test(n)?'Картофель красный':/мыт/.test(n)?'Картофель мытый':base;
   case 'Морковь':return /очищ/.test(n)?'Морковь очищенная':/мыт/.test(n)?'Морковь мытая':base;
   case 'Огурцы':return /кураж/.test(n)?'Огурцы Кураж':/бакин/.test(n)?'Огурцы бакинские':/длинноплод/.test(n)?'Огурцы длинноплодные':/короткоплод/.test(n)?'Огурцы короткоплодные':base;
   case 'Перец':return /чили|остр/.test(n)?'Перец чили'+(/красн/.test(n)?' красный':/зелен/.test(n)?' зелёный':''):/желт/.test(n)?'Перец сладкий жёлтый':/красн/.test(n)?'Перец сладкий красный':/зелен/.test(n)?'Перец сладкий зелёный':base;
   case 'Редис':return /с ботвой/.test(n)?'Редис с ботвой':'Редис красный';
   case 'Тыква':return /баттернат/.test(n)?'Тыква баттернат':/кругл/.test(n)?'Тыква круглая':base;
   case 'Лук':return /зелен/.test(n)?'Лук зелёный':/красн/.test(n)?'Лук красный':/порей/.test(n)?'Лук-порей':/шалот/.test(n)?'Лук-шалот':/белый/.test(n)?'Лук белый':'Лук репчатый';
   case 'Чеснок':return /молод/.test(n)?'Чеснок молодой':base;
   case 'Базилик':return /красн|фиолет/.test(n)?'Базилик красный':/зелен/.test(n)?'Базилик зелёный':base;
   case 'Петрушка':return /кудряв/.test(n)?'Петрушка кудрявая':'Петрушка листовая';
   case 'Спаржа':return /белая|белый/.test(n)?'Спаржа белая':/зелен/.test(n)?'Спаржа зелёная':base;
   case 'Шпинат':return /мини|baby/.test(n)?'Шпинат мини':base;
   default:return base;
  }
 }
 function classify(name){
  let n=cleanName(name).replace(/^(?:овощи|фрукты|ягода|ягоды|зелень)\s+(?=[а-я])/,'');
  if(!n||blocked.test(n))return null;
  let group,label;
  const t=tomato(n);
  if(t){group='veg';label=t}
  else {
   const rule=rules.find(r=>r[2].test(n));
   if(!rule)return null;
   group=rule[0];label=variant(rule[1],n);
   if(label==='Лук зелёный')group='green';
  }
  if(/премиум/.test(n))label+=' — премиум';
  return {id:group+':'+norm(label),group,label};
 }
 function weightPerUnit(name,u){
  u=unit(u);
  if(u==='кг'||u==='kg')return 1;
  if(u==='г'||u==='гр')return .001;
  if(!['шт','штука','штуки','упак','упаковка','уп','пачка','лоток','кор','коробка','пучок'].includes(u))return null;
  const raw=norm(name);
  if(/(?:\d+\s*[xх*]\s*\d+|\d+\s*[-–]\s*\d+)\s*(?:кг|гр|г)(?=$|[^а-яa-z])/.test(raw))return null;
  const found=[...raw.matchAll(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*(кг|гр|г)(?=$|[^а-яa-z])/g)].map(m=>Number(m[1].replace(',','.'))*(m[2]==='кг'?1:.001));
  const unique=[...new Set(found.filter(w=>w>0&&Number.isFinite(w)))];
  if(unique.length===1)return unique[0];
  // Existing approved history alias: Paradis packaged arugula, article 00-00000087, explicitly 125 g.
  if(unique.length===0&&/\(00-00000087\)\s*$/.test(raw)&&/рук[к]?ол/.test(raw)&&/\b125\b/.test(raw))return .125;
  return null;
 }
 function supplierKey(s){
  const n=norm(s);
  if(n.includes('парадис экзотика'))return 'paradis';
  if(n.includes('айш гарден'))return 'aish';
  if(n.includes('интерфуд'))return 'interfood';
  if(n.includes('глобал фудс'))return 'global';
  if(n.includes('метро')&&n.includes('кэш'))return 'metro';
  return n;
 }
 function supplierLabel(s){
  const k=supplierKey(s);
  return ({paradis:'Парадис Экзотика',aish:'Айш Гарден',interfood:'Интерфуд',global:'Глобал Фудс',metro:'МЕТРО'})[k]||String(s||'Не указан').trim().replace(/\s*\*+$/,'');
 }
 function invoiceNumber(s,supplier){
  let n=norm(s).split(/\s+·\s+/)[0];
  if(supplierKey(supplier)==='aish'){const m=n.match(/^(?:утаг)?0*(\d+)$/);if(m)n='утаг'+m[1]}
  return n;
 }
 function invoiceKey(d){return [iso(d.date),supplierKey(d.supplier),invoiceNumber(d.invoice,d.supplier)].join('\0')}
 function buildHistory(history,full,scanned){
  const docs=new Map();
  function put(d,priority){
   if(!iso(d.date)||!d.invoice)return;
   const key=invoiceKey(d),prev=docs.get(key);
   const version=Number(d.version??-1);
   if(!prev||priority>prev.priority||priority===prev.priority&&(version>prev.version||version===prev.version&&d.items.length>prev.items.length)){
    docs.set(key,{...d,priority,version});
   }
  }
  const archived=new Map();
  for(const period of full?.periods||[])for(const r of period.rowsData||[]){
   const d={date:r[1],invoice:r[2],supplier:period.supplier,items:[]};
   const key=invoiceKey(d);
   if(!archived.has(key))archived.set(key,d);
   const qty=Number(r[3]),price=Number(r[6]);
   if(r[6]==null||!Number.isFinite(price)||!(qty>0))continue;
   archived.get(key).items.push({name:r[0],qty,unit:r[4],sum:qty*price,fact:price});
  }
  for(const d of archived.values())put(d,1);
  for(const d of history?.invoices||[])put({...d,supplier:d.supplier||history.supplier},2);
  for(const d of scanned?.invoices||[])put(d,3);
  const products=new Map();
  const stats={docs:0,deliveries:0,unknownWeight:0,suppliers:0,from:null,to:null,scanComplete:scanned?.schemaVersion===1&&scanned?.catalogRevision===1&&scanned?.invoiceErrors===0&&!!scanned.lastSupplyIso,scanThrough:scanned?.lastSupplyIso||null,scanGeneratedAt:scanned?.generatedAt||null,archiveOnly:0};
  const suppliers=new Set(), dates=[];
  for(const d of docs.values()){
   const lines=new Map();
   for(const item of d.items||[]){
    const p=classify(item.name);if(!p)continue;
    const qty=Number(item.qty),sum=Number(item.sum);
    if(!(qty>0)||item.sum==null||!Number.isFinite(sum)||sum<0)continue;
    const u=unit(item.unit),kgPerUnit=weightPerUnit(item.name,u);
    const key=[p.id,norm(item.name),u].join('\0');
    const prev=lines.get(key);
    if(prev){prev.qty+=qty;prev.sum+=sum;prev.count++;prev.kg=kgPerUnit==null||prev.kg==null?null:prev.kg+qty*kgPerUnit}
    else lines.set(key,{p,name:item.name,unit:u,qty,sum,kg:kgPerUnit==null?null:qty*kgPerUnit,count:1,fact:item.fact==null?null:Number(item.fact),kgPerUnit});
   }
   if(!lines.size)continue;
   stats.docs++;if(d.priority<3)stats.archiveOnly++;
   for(const l of lines.values()){
    if(!products.has(l.p.id))products.set(l.p.id,{...l.p,deliveries:[]});
    const price=l.kg!=null&&l.kg>0?(l.count===1&&l.fact!=null&&Number.isFinite(l.fact)?l.fact/l.kgPerUnit:l.sum/l.kg):null;
    const supplier=supplierLabel(d.supplier);
    const row={date:d.date,dateIso:iso(d.date),supplier,invoice:d.invoice,name:l.name,unit:l.unit,qty:l.qty,sum:round2(l.sum),kg:l.kg,price:price==null?null:round2(price),archive:d.priority<3};
    products.get(l.p.id).deliveries.push(row);
    suppliers.add(supplier);dates.push(row.dateIso);stats.deliveries++;if(row.price==null)stats.unknownWeight++;
   }
  }
  const result=[...products.values()].sort((a,b)=>GROUPS.findIndex(g=>g.id===a.group)-GROUPS.findIndex(g=>g.id===b.group)||a.label.localeCompare(b.label,'ru'));
  for(const p of result)p.deliveries.sort((a,b)=>b.dateIso.localeCompare(a.dateIso)||a.supplier.localeCompare(b.supplier,'ru')||b.invoice.localeCompare(a.invoice,'ru')||a.name.localeCompare(b.name,'ru'));
  dates.sort();stats.from=dates[0]||null;stats.to=dates.at(-1)||null;stats.suppliers=suppliers.size;stats.products=result.length;
  return {groups:GROUPS,products:result,suppliers:[...suppliers].sort((a,b)=>a.localeCompare(b,'ru')),stats};
 }
 return {GROUPS,PRODUCTS:rules,classify,weightPerUnit,buildHistory,norm,iso,round2};
});
