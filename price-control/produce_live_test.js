'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base='https://alex19011901.github.io/price-control-pages/';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PROBE_CHROME?{executablePath:process.env.PROBE_CHROME}:{})});
 try{
  const page=await browser.newPage({viewport:{width:393,height:873},isMobile:true,deviceScaleFactor:2,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(base+'?verify='+process.env.GITHUB_SHA,{waitUntil:'domcontentloaded',timeout:30000});
  assert.equal(response.status(),200);
  const loaded=()=>page.waitForFunction(()=>document.querySelector('#produceRows .produce-entry'),undefined,{timeout:30000});
  await loaded();
  const through=await page.locator('#produceThrough').textContent();
  const match=through.match(/(\d{2})\.(\d{2})\.(\d{4})/);assert.ok(match,through);
  const latest=[match[3],match[2],match[1]].join('-');
  // Run the date-color regression relative to the newest actual receipt.
  // This remains valid as later receipts are loaded or when there are no purchases today.
  await page.clock.setFixedTime(new Date(latest+'T09:00:00Z'));
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});await loaded();
  const inspect=()=>page.evaluate(()=>{
   const root=document.getElementById('produceCard'),rows=[...root.querySelectorAll('#produceRows tr:not(.produce-group)')].filter(r=>r.querySelector('.produce-name'));
   return {filter:document.getElementById('produceRecent').value,through:document.getElementById('produceThrough').textContent,meta:document.getElementById('produceRecentMeta').textContent,visible:rows.length,items:rows.map(r=>{
    const d=r.querySelector('td:nth-child(2) .produce-date'),price=r.querySelector('td:nth-child(2) .produce-price');
    return {name:r.querySelector('.produce-name').textContent,date:d?.textContent,color:d?getComputedStyle(d).backgroundColor:null,price:price?.textContent};
   })};
  });
  const first=await inspect();assert.equal(first.filter,'recent');assert.ok(first.visible>0);
  assert.ok(first.items.some(r=>r.date===match[1]+'.'+match[2]&&r.color==='rgb(43, 214, 115)'));
  if(latest==='2026-11-27'){
   assert.ok(first.visible>=21);
   for(const [name,date,color] of [['Вешенки','27.11','rgb(43, 214, 115)'],['Томаты на ветке','27.11','rgb(43, 214, 115)'],['Мандарины','26.11','rgb(255, 210, 76)'],['Петрушка кудрявая','27.11','rgb(43, 214, 115)']]){
    const item=first.items.find(r=>r.name===name);assert.ok(item,name);assert.equal(item.date,date,name);assert.equal(item.color,color,name);
   }
  }
  await page.locator('#produceCard').scrollIntoViewIfNeeded();
  const geometry=await page.evaluate(()=>{
   const scroll=document.querySelector('#produceCard .produce-scroll'),r=document.querySelector('#produceRows tr:not(.produce-group) td:nth-child(2) .produce-price');
   const a=scroll.getBoundingClientRect(),b=r.getBoundingClientRect();return {left:a.left,right:a.right,priceLeft:b.left,priceRight:b.right,viewport:innerWidth};
  });
  assert.ok(geometry.priceRight<=geometry.right+1&&geometry.priceRight<=geometry.viewport+1,JSON.stringify(geometry));
  await page.selectOption('#produceRecent','yesterday');const yesterday=await inspect();
  assert.ok(yesterday.items.every(r=>r.color==='rgb(255, 210, 76)'));
  if(latest==='2026-11-27')assert.ok(yesterday.items.some(r=>r.name==='Мандарины'));
  await page.selectOption('#produceRecent','');const all=await inspect();assert.ok(all.visible>=first.visible);
  console.log('PRODUCE_LIVE_BROWSER_OK '+JSON.stringify({recent:first.visible,through:first.through,meta:first.meta,examples:first.items.filter(r=>['Вешенки','Томаты на ветке','Мандарины','Петрушка кудрявая'].includes(r.name)),yesterday:yesterday.visible,all:all.visible,geometry,errors}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
