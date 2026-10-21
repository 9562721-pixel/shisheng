// Annual assessment facts are projected exclusively from the official table and photos.
import {parsePhotoName} from './management/photos.ts';
export const normalize=value=>String(value??'').replace(/\s/g,'');
export const imageOK=value=>typeof value==='string'&&/^data:image\/(png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/=\s]+$/.test(value);
export function matchOfficialPhotos(rows,photos){
  const result=photos.map(p=>{
    if(p.ignored)return {...p,studentId:null,issue:'已忽略，原文件保留'};
    const f=parsePhotoName(p.path).fields;
    let hits=[];
    if(p.manualId){hits=rows.filter(r=>r.id===p.manualId);}
    else if(f['学号']){
      hits=rows.filter(r=>r.id===f['学号']);
      if(hits.length===1&&Object.hasOwn(f,'姓名')&&normalize(f['姓名'])!==normalize(hits[0].name))return {...p,studentId:null,issue:'学号与姓名冲突，请核对原材料'};
    }else{
      const stem=(p.path.split(/[/\\]/).pop()||'').replace(/\.[^.]+$/,'').trim();
      hits=rows.filter(r=>r.id===stem||normalize(r.name)===normalize(stem));
    }
    return {...p,studentId:hits.length===1?hits[0].id:null,issue:hits.length===1?'':'未唯一匹配考核表，请指定学生或忽略'};
  });
  const counts=new Map();for(const p of result)if(p.studentId)counts.set(p.studentId,(counts.get(p.studentId)||0)+1);
  return result.map(p=>p.studentId&&counts.get(p.studentId)>1?{...p,studentId:null,issue:'同一学生有多张照片，请忽略多余来源'}:p);
}
export function annualRows(dataset){
  const byId=new Map(dataset.photos.filter(p=>p.studentId&&!p.ignored).map(p=>[p.studentId,p]));
  return dataset.rows.map(r=>{const p=byId.get(r.id),photo=p&&imageOK(p.data)?p.data:'';return {id:r.id,name:r.name,className:r.className,assessmentAddress:r.assessmentAddress,needyLabel:r.needyLabel,psychLabel:r.psychLabel,hometown:'',photo,rel:p?.path||r.name,sure:!!photo,readyScopes:photo?['name','className','full']:[],issues:photo?[]:['上级材料中待补照片']};});
}
export function ledgerPhotoPatch(students,dataset){
  const rows=annualRows(dataset),byId=new Map(rows.map(r=>[r.id,r]));
  // Both identifiers must agree. Daily fields and existing portraits are never overwritten.
  return students.map(s=>{const r=byId.get(s.id);return !s.photo&&r?.photo&&normalize(s.name)===normalize(r.name)?{...s,photo:r.photo}:s;});
}
export function payload(d){return {year:d.year,label:d.label,table:d.table,photoPackage:d.photoPackage,rows:d.rows,photos:d.photos};}
export async function digest(value){const b=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function sealDataset(d){
  validateDataset(d,false);
  if(!d.rows.length||!annualRows(d).some(r=>r.sure))throw Error('至少需要一位考核学生及其匹配照片。');
  if(d.photos.some(p=>!p.ignored&&!p.studentId))throw Error('请先处理未匹配或重复的照片。');
  const data={...d,lockedAt:new Date().toISOString()};return {...data,hash:await digest(JSON.stringify(payload(data)))};
}
export function validateDataset(d,locked=true){
  if(!d||typeof d.id!=='string'||d.id.length>100||!/^\d{4}$/.test(d.year)||typeof d.label!=='string'||d.label.length>200||!Array.isArray(d.rows)||d.rows.length>20000||!Array.isArray(d.photos)||d.photos.length>20000)throw Error('考核资料格式无效。');
  if(!d.table||typeof d.table.name!=='string'||!/^data:.*;base64,[A-Za-z0-9+/=\s]+$/.test(d.table.data)||typeof d.table.sha256!=='string')throw Error('缺少原始考核信息表。');
  const ids=new Set();for(const r of d.rows){if(!/^\d{8,12}$/.test(r.id)||ids.has(r.id)||!['name','className','assessmentAddress','needyLabel','psychLabel','other'].every(k=>typeof r[k]==='string'&&r[k].length>0&&r[k].length<=2000))throw Error('考核表有无效或重复学生。');ids.add(r.id);}
  const keys=new Set(),targets=new Set();for(const p of d.photos){if(typeof p.key!=='string'||keys.has(p.key)||typeof p.path!=='string'||p.path.length>2000||!imageOK(p.data))throw Error('照片备份无效。');keys.add(p.key);if(p.studentId&&!p.ignored){if(!ids.has(p.studentId)||targets.has(p.studentId))throw Error('照片关联无效或重复。');targets.add(p.studentId);}if(locked&&!p.ignored&&!p.studentId)throw Error('锁定考核资料存在未核对照片。');}
  if(locked&&(!d.lockedAt||!/^[a-f0-9]{64}$/.test(d.hash)))throw Error('缺少考核锁定记录。');
  return d;
}
export async function verifyDataset(d){validateDataset(d);if(await digest(JSON.stringify(payload(d)))!==d.hash)throw Error('考核备份内容与锁定校验不一致，原资料未修改。');return d;}
