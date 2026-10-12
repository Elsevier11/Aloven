// Integration evidence: real application, isolated database, approved desktop/touch profiles.
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH?pathToFileURL(process.env.PLAYWRIGHT_PATH).href:'playwright');
const temp=mkdtempSync(path.join(tmpdir(),'aloven-design-'));
const out=path.resolve('.artifacts/mes-excellence/final');mkdirSync(out,{recursive:true});
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
const report={startedAt:new Date().toISOString(),browser:'Microsoft Edge',zoom:100,isolatedData:true,views:[],errors:[]};
let browser;
try{
 const base=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'Server timeout')),15000);server.stdout.on('data',b=>{log+=b;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.stderr.on('data',b=>log+=b);server.on('exit',()=>{clearTimeout(timer);reject(new Error(log));});});
 browser=await chromium.launch({channel:'msedge',headless:process.env.HEADFUL!=='1'});
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(base);await page.getByLabel('Nome e cognome').fill('Verifica MES');await page.getByLabel('Nome utente',{exact:true}).fill('design-test');await page.getByLabel('Password',{exact:true}).fill('DesignCheck123!');await page.getByRole('button',{name:'Crea amministratore'}).click();await page.locator('.timeline-scroll').waitFor();
 const post=async(url,data)=>{const r=await page.request.post(base+'/api/'+url,{headers:{'X-Aloven-Request':'1'},data});const body=await r.json();assert.ok(r.ok(),body.error);return body;};
 const read=async()=>{const r=await page.request.get(base+'/api/state');assert.ok(r.ok());return r.json();};
 const mutate=async action=>{const s=await read(),p=await post('preview',{revision:s.revision,action});await post('commit',{token:p.token});};
 // Existing seed belongs to the test database only; reference HTML never supplies data.
 const seed=spawn(process.execPath,['seed-history.mjs'],{env:{...process.env,DATA_DIR:temp},stdio:['ignore','ignore','pipe']});assert.equal((await once(seed,'exit'))[0],0);
 let s=await read();const planned=[];
 for(const m of s.machines){const candidates=s.tasks.filter(t=>t.status==='unplanned'&&t.machineId===m.id).slice(0,2);for(const t of candidates){await mutate({kind:'plan',id:t.id});planned.push(t.id);}}
 s=await read();const first=s.tasks.find(t=>t.id===planned[0]);
 await mutate({kind:'task',id:first.id,values:{...first,orderReference:'VERIFICA-ORD-01',dueDate:first.start.slice(0,10),outputLot:'VERIFICA-LOT-01'}});
 s=await read();await post('planning/release',{revision:s.revision});s=await read();
 const day=s.tasks.find(t=>t.id===planned[0]).start.slice(0,10);
 await page.locator('#refresh').click();await page.waitForFunction(revision=>document.querySelector('.shell')?.dataset.revision===String(revision),s.revision);
 await page.locator('#date-start').fill(day);await page.locator('#date-start').dispatchEvent('change');
 const groups={machines:'catalogues',articles:'catalogues',types:'catalogues',setupRules:'catalogues',scrapReasons:'catalogues',machineStopReasons:'catalogues',calendar:'settings',users:'settings',audit:'settings',backups:'settings'};
 const navigate=async view=>{if(page.url().includes('/bordo-macchina')){await page.getByRole('link',{name:'Pianificazione',exact:true}).click();await page.locator('.shell').waitFor();}if(view==='shopfloor'){await page.locator('[data-nav="shopfloor"]').click();await page.locator('.shop-shell').waitFor();return;}if(groups[view])await page.locator(`[data-nav-group="${groups[view]}"]`).click();if(['quality','traceability'].includes(view)){await page.locator('[data-nav="tasks"]').click();await page.locator(`[data-mes-nav="${view}"]`).click();}else await page.locator(`[data-nav="${view}"]`).click();if(view==='statistics')await page.locator('.statistics-chart-grid').waitFor();if(view==='audit')await page.locator('.mes-results').waitFor();if(view==='backups')await page.locator('.mes-status').waitFor();};
 const measure=async view=>page.evaluate(view=>{const rect=el=>el?{top:el.getBoundingClientRect().top,height:el.clientHeight,width:el.clientWidth,bottom:el.getBoundingClientRect().bottom}:null,q=s=>document.querySelector(s);return {view,viewport:{width:innerWidth,height:innerHeight},outerScroll:{width:document.documentElement.scrollWidth,height:document.scrollingElement.scrollHeight},sidebar:rect(q('.sidebar')),topbar:rect(q('.topbar')),work:rect(q('.timeline-scroll')||q('.console-content')||q('.shop-current')||q('.current')),title:q('h1')?getComputedStyle(q('h1')).fontSize:null,row:q('tbody tr')?q('tbody tr').getBoundingClientRect().height:null,background:getComputedStyle(document.body).backgroundColor,navy:q('.sidebar')?getComputedStyle(q('.sidebar')).backgroundColor:null,blue:getComputedStyle(document.documentElement).getPropertyValue('--mes-blue').trim()};},view);
 const views=['planning','tasks','traceability','quality','statistics','machines','articles','types','setupRules','scrapReasons','machineStopReasons','calendar','users','audit','backups','shopfloor'];
 for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){
  await page.setViewportSize(viewport);
  for(const view of views){await navigate(view);if(view==='planning'){await page.locator('#date-start').fill(day);await page.locator('#date-start').dispatchEvent('change');await page.locator('.time-block.run').first().waitFor();}await page.evaluate(()=>{const c=document.querySelector('.console-content');if(c)c.scrollTop=0;});const m=await measure(view);assert.ok(m.outerScroll.width<=viewport.width+1,view+' horizontal overflow');if(view!=='shopfloor')assert.ok(m.outerScroll.height<=viewport.height+1,view+' page scroll');if(view==='planning'){assert.ok(m.work.top<=280,'Timeline begins in first280px');assert.ok(m.work.height>=viewport.height/2,'Timeline occupies >=half viewport');assert.equal(m.sidebar.width,224);assert.equal(m.navy,'rgb(16, 27, 45)');assert.ok(await page.locator('.time-block.run').count()>=4,'Multiple resources have actual planned bars');}const file=`${view}-${viewport.width}x${viewport.height}.png`;await page.screenshot({path:path.join(out,file)});report.views.push({...m,file});}
 }
 await navigate('planning');await page.setViewportSize({width:1366,height:768});await page.locator('.planning-priorities>summary').click();const priorities=page.locator('.planning-priorities');assert.match(await priorities.innerText(),/VERIFICA-ORD-01/);await priorities.locator('[data-detail]').click();await page.locator('#modal').waitFor({state:'visible'});assert.match(await page.locator('#modal').innerText(),/VERIFICA-ORD-01|VERIFICA-LOT-01/);await page.getByRole('button',{name:'Chiudi',exact:true}).click();
 await navigate('statistics');await page.locator('[data-statistics-dashboard="machines"]').click();assert.match(await page.locator('#oee-readiness').innerText(),/OEE non disponibile/);await page.screenshot({path:path.join(out,'statistics-machines-1366x768.png')});
 await page.locator('[data-statistics-dashboard="quality"]').click();await page.screenshot({path:path.join(out,'statistics-quality-1366x768.png')});
 await page.locator('[data-statistics-dashboard="production"]').click();await page.screenshot({path:path.join(out,'statistics-production-1366x768.png')});
 await page.setViewportSize({width:1280,height:800});await page.goto(base+'/operatore?machine='+encodeURIComponent(s.machines[0].id));await page.locator('.current').waitFor();
 const touch=await measure('operatore');assert.ok(touch.outerScroll.width<=1281);assert.ok(touch.outerScroll.height<=801,'Touch first screen fits1280x800');
 const primary=page.locator('.action-dock .primary-action');assert.ok(await primary.count());const b=await primary.boundingBox();assert.ok(b.height>=90,'Primary touch90px');assert.ok(b.y+b.height<=800,'Touch action visible');
 await page.screenshot({path:path.join(out,'operatore-1280x800.png')});report.views.push({...touch,file:'operatore-1280x800.png',primary:b});
 assert.deepEqual(report.errors,[]);
 report.status='passed';console.log('PASS design MES: 32 desktop views,3 statistic tabs,priorities drill-down,touch1280x800.');
}catch(error){report.status='failed';report.errors.push(error.stack);throw error;}
finally{report.completedAt=new Date().toISOString();writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();if(server.exitCode===null){const done=once(server,'exit');server.kill();await done;}assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep+'aloven-design-'));rmSync(temp,{recursive:true,force:true});}
