'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('./produce-core');
const root=__dirname;
const positive=[
 ['Томаты Биф Азербайджан Стандарт,кг (00-00013955)','Томаты биф Азербайджан'],
 ['Томаты Биф Узбекистан Премиум сахар 9+ калибр 5,кг (00-00015169)','Томаты биф Узбекистан — премиум'],
 ['Томаты черри (красные) 250 гр.,шт. (00000002689)','Томаты черри красные'],
 ['Помидоры Банч,кг (ЦБ-00001723)','Томаты Банч'],
 ['Томаты на ветке,кг. (00000002681)','Томаты на ветке'],
 ['Брокколи свежие,кг. (00000002433)','Брокколи'],
 ['Вешенки,кг. (00000002437)','Вешенки'],
 ['Лук зеленый,кг','Лук зелёный'],
 ['Салат Месклам 125г,шт','Месклам'],
 ['Авокадо хасс, кг,кг. (00000002414)','Авокадо Хасс']
];
for(const [name,label] of positive)assert.equal(C.classify(name)?.label,label,name);
for(const n of ['Клубника с/м,кг','Брокколи с/м,кг.','Горошек зеленый с/м,кг.','Томатная паста Зарина 700г ж/б','Томаты Солёные Зелёные','Картофель фри 9Х9 с панировкой','Капуста квашеная','Помидоры черри вяленые','Грибы Белые целые 1 Сорт с/м вес','Масло подсолнечное','Горошек зеленый Бондюэль 400г ж/б','Черемша маринованная','Чеснок солёный','Крупа гречневая','Соус томатный'])assert.equal(C.classify(n),null,n);
assert.equal(C.weightPerUnit('Томаты черри (красные) 250 гр.,шт. (00000002689)','шт.'),.25);
assert.equal(C.weightPerUnit('Руккола 125,шт (00-00000087)','шт'),.125);
assert.equal(C.weightPerUnit('Руккола 125,шт (12345)','шт'),null);
assert.equal(C.weightPerUnit('Голубика 125г/шт,кг (00-00000360)','кг'),1);
const h=JSON.parse(fs.readFileSync(path.join(root,'purchase_history.json'),'utf8'));
const f=JSON.parse(fs.readFileSync(path.join(root,'full.json'),'utf8'));
const rawPath=path.join(root,'produce_receipts.json');
const raw=fs.existsSync(rawPath)?JSON.parse(fs.readFileSync(rawPath,'utf8')):null;
if(raw){
 assert.equal(raw.schemaVersion,1);
 assert.equal(raw.catalogRevision,1);
 assert.equal(raw.invoiceErrors,0);
 assert.ok(raw.lastSupplyIso);
 assert.ok(raw.invoices.length>0);
 for(const d of raw.invoices)for(const r of d.items){
  assert.ok(C.classify(r.name),r.name);
  assert.ok(r.qty>0&&r.sum>=0,r.name);
 }
}
const v=C.buildHistory(h,f,raw);
assert.ok(v.products.length>=100);
assert.ok(v.stats.deliveries>=1500);
assert.ok(v.suppliers.includes('Парадис Экзотика')&&v.suppliers.includes('Айш Гарден'));
const t=v.products.find(p=>p.label==='Томаты черри красные');
assert.ok(t.deliveries.some(r=>r.date==='19.11.2026'&&r.supplier==='Айш Гарден'&&r.price===635&&r.kg===1));
assert.ok(v.products.find(p=>p.label==='Томаты на ветке').deliveries.some(r=>r.date==='19.11.2026'&&r.price===190.5));
for(const p of v.products)for(const r of p.deliveries)assert.ok(C.classify(r.name),r.name);
console.log('PRODUCE_HISTORY_OK',JSON.stringify(v.stats));
