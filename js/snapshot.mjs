export const APP_ID = 'sorosoro';
export const MAX_BYTES = 8 * 1024 * 1024;
const integer = v => Number.isSafeInteger(v) && v >= 0;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(v);
const text = (v,max) => typeof v === 'string' && v.length <= max;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function digest(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function validateData(s) {
  if(s?.format!=='sorosoro.snapshot'||s.schema_version!==1||!integer(s.revision)||!iso(s.created_at)||!Array.isArray(s.items)||!Array.isArray(s.history)||!Array.isArray(s.settings)) throw Error('Soro Soroのバックアップを選んでください');
  const itemIds=new Set();
  for(const i of s.items){
    if(!id(i.id)||itemIds.has(i.id)||!text(i.name,40)||!i.name.trim()||!text(i.icon,40)||!text(i.note,300)||!Number.isInteger(i.intervalValue)||i.intervalValue<1||i.intervalValue>999||!['day','week','month'].includes(i.intervalUnit)||!(i.lastCompletedDate===null||date(i.lastCompletedDate))||!date(i.nextDueDate)||!(i.plannedDate==null||date(i.plannedDate))||!iso(i.createdAt)||!iso(i.updatedAt)||!['active','private','riseEnabled'].every(k=>i[k]===undefined||typeof i[k]==='boolean')||!integer(i.riseDays)||i.riseDays>365) throw Error('項目の形式を確認してください');
    itemIds.add(i.id);
  }
  const histories=new Set();
  for(const h of s.history){if(!id(h.id)||histories.has(h.id)||!itemIds.has(h.itemId)||!date(h.performedDate)||!['initial','complete'].includes(h.source)||!iso(h.createdAt)||(h.updatedAt!==undefined&&!iso(h.updatedAt)))throw Error('実施履歴の形式を確認してください');histories.add(h.id);}
  const settings=new Set();
  for(const v of s.settings){if(!v||typeof v.key!=='string'||!['schemaVersion'].includes(v.key)||settings.has(v.key)||!Number.isSafeInteger(v.value))throw Error('設定の形式を確認してください');settings.add(v.key);}
  if(new TextEncoder().encode(JSON.stringify(s)).length>MAX_BYTES)throw Error('バックアップは8MBまでです');
  return s;
}
export function parseSnapshot(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)throw Error('バックアップは8MBまでです');return validateData(JSON.parse(text));}
export async function createBackup(snapshot,deviceId=null){
  validateData(snapshot);const backup_json=JSON.stringify(snapshot);
  return {backup_id:crypto.randomUUID(),app_id:APP_ID,schema_version:1,created_at:new Date().toISOString(),device_id:deviceId,record_count:snapshot.items.length,source_revision:snapshot.revision,backup_json,sha256:await digest(backup_json),byte_length:new TextEncoder().encode(backup_json).length};
}
export async function validateBackup(v){
  if(!v||!uuid.test(v.backup_id)||v.app_id!==APP_ID||v.schema_version!==1||!iso(v.created_at)||(v.device_id!==null&&!uuid.test(v.device_id))||!integer(v.record_count)||!integer(v.source_revision)||!integer(v.byte_length)||!/^[0-9a-f]{64}$/.test(v.sha256))throw Error('バックアップ情報が不正です');
  const s=parseSnapshot(v.backup_json);
  if(s.items.length!==v.record_count||s.revision!==v.source_revision||new TextEncoder().encode(v.backup_json).length!==v.byte_length||await digest(v.backup_json)!==v.sha256)throw Error('バックアップの照合に失敗しました');
  return s;
}
