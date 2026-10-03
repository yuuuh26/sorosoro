import {validateData} from './snapshot.mjs';
const stores=['items','history','settings','cloud_meta'];
const defaults={key:'state',revision:0,sentRevision:0,lastSaved:null,pending:null};
export async function meta(){return (await readRecord('state'))||{...defaults};}
export async function readRecord(key){const db=await window.SoroSoro.openDatabase();return window.SoroSoro.requestResult(db.transaction('cloud_meta').objectStore('cloud_meta').get(key));}
export async function updateMeta(fn){
  const db=await window.SoroSoro.openDatabase(),tx=db.transaction('cloud_meta','readwrite'),s=tx.objectStore('cloud_meta');
  const req=s.get('state');req.onsuccess=()=>s.put({...fn(req.result||{...defaults}),key:'state'});
  await window.SoroSoro.transactionDone(tx);window.dispatchEvent(new Event('sorosoro-cloud-state'));
}
export async function capture(){
  const db=await window.SoroSoro.openDatabase(),tx=db.transaction(stores,'readonly');
  const done=window.SoroSoro.transactionDone(tx);
  const [items,history,settings,m]=await Promise.all(['items','history','settings'].map(s=>window.SoroSoro.requestResult(tx.objectStore(s).getAll())).concat(window.SoroSoro.requestResult(tx.objectStore('cloud_meta').get('state'))));
  await done;return validateData({format:'sorosoro.snapshot',schema_version:1,created_at:new Date().toISOString(),revision:m?.revision||0,items,history,settings:settings.filter(s=>s.key==='schemaVersion')});
}
export async function replaceData(snapshot,expectedRevision){
  validateData(snapshot);
  const db=await window.SoroSoro.openDatabase(),tx=db.transaction(stores,'readwrite'),cm=tx.objectStore('cloud_meta');
  const req=cm.get('state');let message='';
  req.onsuccess=()=>{
    const m=req.result||{...defaults};if(m.revision!==expectedRevision){message='確認中に編集されたため中止しました。もう一度読み込んでください';tx.abort();return;}
    const values={};let count=0;
    for(const name of ['items','history','settings']){
      const r=tx.objectStore(name).getAll();r.onsuccess=()=>{values[name]=r.result;if(++count!==3)return;
        cm.put({key:'safety',createdAt:new Date().toISOString(),data:{format:'sorosoro.snapshot',schema_version:1,created_at:new Date().toISOString(),revision:m.revision,...values}});
        for(const name of ['items','history','settings']){const s=tx.objectStore(name);s.clear();for(const v of snapshot[name])s.put(v);}
        cm.put({...m,revision:m.revision+1,pending:null});
      };
    }
  };
  try{await window.SoroSoro.transactionDone(tx);}catch(e){throw Error(message||e.message);}
  await window.SoroSoro.refreshData();window.dispatchEvent(new Event('sorosoro-change'));
}
