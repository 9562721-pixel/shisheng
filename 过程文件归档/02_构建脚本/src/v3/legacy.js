import {toDataURL} from './annual-files.js';
async function openLegacy(){
  return new Promise((resolve,reject)=>{const r=indexedDB.open('shisheng-v2');r.onupgradeneeded=()=>r.transaction.abort();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
export async function inspectLegacy(){
  if(typeof indexedDB.databases!=='function')throw Error('当前浏览器不支持检查旧数据库，请在原版识生中导出备份。');
  const names=new Set((await indexedDB.databases()).map(d=>d.name));
  if(!names.has('shisheng-v2'))return {libraries:[],hasV1:names.has('shisheng-folder')};
  const db=await openLegacy();
  try{
    if(!db.objectStoreNames.contains('app')||!db.objectStoreNames.contains('photos'))throw Error('旧数据库结构不完整，请在原版识生中导出备份。');
    const state=await new Promise((resolve,reject)=>{const tx=db.transaction('app'),r=tx.objectStore('app').get('current');let value;r.onsuccess=()=>value=r.result;tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error||Error('旧资料读取失败。'));});
    return {libraries:Array.isArray(state?.libraries)?state.libraries:[],hasV1:names.has('shisheng-folder')};
  }finally{db.close();}
}
export async function readLegacyPhotos(library){
  if(!library||typeof library.id!=='string'||!Array.isArray(library.rows))throw Error('旧版名册格式无效。');
  const db=await openLegacy();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('photos'),photos=new Map();for(const row of library.rows){const key=library.id+':'+row.id,r=tx.objectStore('photos').get(key);r.onsuccess=()=>{if(r.result)photos.set(key,r.result);};}tx.oncomplete=()=>resolve(photos);tx.onabort=tx.onerror=()=>reject(tx.error||Error('旧版照片读取失败。'));});}finally{db.close();}
}
export async function legacyBackup(library,photos,encode=toDataURL){
  if(!library||typeof library.id!=='string'||!Array.isArray(library.rows))throw Error('旧版名册格式无效。');
  const copy=structuredClone(library);
  for(const row of copy.rows){const blob=photos.get(library.id+':'+row.id);if(blob instanceof Blob)row.image=await encode(blob);else if(!row.image)throw Error('旧版照片缺失，请在原版程序中核对后备份：'+(row.rel||row.name||row.id));}
  return {format:'shisheng-backup',version:2,library:copy};
}
