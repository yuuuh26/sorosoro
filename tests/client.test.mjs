import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
await build({entryPoints:['js/cloud.mjs'],bundle:true,format:'iife',outfile:'.test-build/cloud.js'});
const html=await readFile('index.html','utf8'),app=await readFile('js/app-v130.js','utf8'),cloud=await readFile('.test-build/cloud.js','utf8');
const now=new Date().toISOString();
const item={id:'item-test',name:'掃除',icon:'✓',category:'',intervalValue:7,intervalUnit:'day',lastCompletedDate:'2026-10-03',plannedDate:null,nextDueDate:'2026-10-10',tab:'short',pinHome:false,riseEnabled:true,riseDays:3,note:'',private:false,active:true,createdAt:now,updatedAt:now};
async function settle(fn,ms=7000){const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');}
function network(){const rows=new Map(),puts=[];return {rows,puts,fail:false,online:true,hold:null,unauthorized:false,async fetch(url,init){
  if(url==='/v1/session')return new Response(JSON.stringify({connected:true,deviceName:'テスト端末'}));
  if(url==='/v1/backups')return new Response(JSON.stringify({backups:[...rows.values()]}));
  if(init.method==='PUT'){const b=JSON.parse(init.body);puts.push(b);if(this.unauthorized)return new Response('{"error":"再接続してください"}',{status:401});if(this.fail)return new Response('{"error":"失敗"}',{status:503});rows.set(b.backup_id,b);if(this.hold)await this.hold;return new Response('{}');}
  return new Response(JSON.stringify(rows.get(url.split('/').at(-1))));
}};}
async function harness(factory,n,fn){
  const dom=new JSDOM(html,{url:'https://sorosoro-backups.dengana-10011212.workers.dev/',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
  Object.defineProperty(w,'crypto',{value:webcrypto});Object.assign(w,{indexedDB:factory,IDBKeyRange,TextEncoder,TextDecoder,AbortSignal});w.fetch=(...args)=>n.fetch(...args);w.scrollTo=()=>{};w.navigator.locks={request:async(name,options,cb)=>cb({})};Object.defineProperty(w.navigator,'onLine',{get:()=>n.online});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  try{w.eval(app+"\nwindow.TestApp={saveItemWithHistory,putOne};");w.eval(cloud);await settle(()=>w.__SOROSORO_CLOUD_READY__);await fn(w);}finally{(await w.SoroSoro.openDatabase()).close();dom.window.close();}
}
test('追加・実施・少量編集を自動保存し、参照では新規保存なし、送信中の編集も保持',async()=>{
  const f=new IDBFactory(),n=network();await harness(f,n,async w=>{
    await new Promise(r=>setTimeout(r,1600));assert.equal(n.puts.length,0);
    await w.TestApp.saveItemWithHistory(item);await settle(()=>n.puts.length===1&&w.document.getElementById('cloudPending').textContent==='なし');
    await w.SoroSoro.refreshData();assert.equal(n.puts.length,1);
    let release;n.hold=new Promise(r=>release=r);await w.TestApp.putOne('items',{...item,note:'あ'});await settle(()=>n.puts.length===2);
    await w.TestApp.saveItemWithHistory({...item,note:'送信中の編集'},{id:'history-test',itemId:item.id,performedDate:'2026-10-03',source:'complete',createdAt:now});n.hold=null;release();
    await settle(()=>n.puts.length===3&&w.document.getElementById('cloudPending').textContent==='なし');
    assert.equal(JSON.parse(n.puts[2].backup_json).items[0].note,'送信中の編集');assert.equal(JSON.parse(n.puts[2].backup_json).history.length,1);
  });
});
test('オフライン・失敗・再起動後も同じ処理IDで再送し、認証取消で再試行を止める',async()=>{
  const f=new IDBFactory(),n=network();n.online=false;
  await harness(f,n,async w=>{await w.TestApp.saveItemWithHistory(item);await new Promise(r=>setTimeout(r,1600));assert.equal(n.puts.length,0);n.fail=true;n.online=true;w.dispatchEvent(new w.Event('online'));await settle(()=>n.puts.length===1);});
  n.fail=false;await harness(f,n,async w=>{
    await settle(()=>n.puts.length===2&&w.document.getElementById('cloudPending').textContent==='なし');assert.equal(n.puts[1].backup_id,n.puts[0].backup_id);
    n.unauthorized=true;await w.TestApp.putOne('items',{...item,note:'取消後'});await settle(()=>n.puts.length===3&&w.document.getElementById('cloudStatus').textContent.includes('再接続'));await new Promise(r=>setTimeout(r,1700));assert.equal(n.puts.length,3);
  });
});
test('全データの復元・退避と、確認中の編集による競合を検出',async()=>{
  const f=new IDBFactory(),n=network();n.online=false;
  await harness(f,n,async w=>{
    await w.TestApp.saveItemWithHistory({...item,private:true,active:false},{id:'history-test',itemId:item.id,performedDate:'2026-10-03',source:'initial',createdAt:now});
    const code=await build({entryPoints:['js/cloud-store.mjs'],bundle:true,format:'iife',globalName:'TestStore',write:false});w.eval(code.outputFiles[0].text);
    const original=await w.TestStore.capture();assert.equal(original.items[0].private,true);assert.equal(original.history.length,1);
    await w.TestApp.putOne('items',{...item,note:'他の編集'});
    await assert.rejects(w.TestStore.replaceData(original,original.revision),/確認中に編集/);
    const current=await w.TestStore.capture();await w.TestStore.replaceData(original,current.revision);
    assert.equal((await w.TestStore.capture()).items[0].private,true);assert.equal((await w.TestStore.readRecord('safety')).data.items[0].note,'他の編集');
  });
});
