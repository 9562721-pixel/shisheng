import JSZip from 'jszip';
import {digest} from './annual.js';
export const toDataURL=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
function decodeName(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030').decode(bytes);}}
export async function readPhotoZip(file,onProgress=()=>{}){
  if(file.size>200*1024*1024)throw Error('照片压缩包超过 200 MB，请压缩照片体积后重试。');
  const zip=await JSZip.loadAsync(file,{decodeFileName:decodeName});
  const files=Object.values(zip.files).filter(f=>!f.dir&&!f.name.startsWith('__MACOSX/')&&!f.name.split('/').some(s=>s.startsWith('.'))&&/\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
  if(!files.length||files.length>20000)throw Error('压缩包需包含 1 至 20000 张 JPG、PNG 等照片。');
  let total=0;const photos=[];
  for(const [i,f] of files.entries()){
    if(f._data?.uncompressedSize>10*1024*1024)throw Error('单张照片超过 10 MB：'+f.name);
    const bytes=await f.async('uint8array');total+=bytes.length;
    if(bytes.length>10*1024*1024||total>400*1024*1024)throw Error('照片解压体积超过限制（单张 10 MB、总计 400 MB）。');
    const ext=f.name.split('.').pop().toLowerCase(),mime=ext==='jpg'||ext==='jpeg'?'image/jpeg':'image/'+ext;
    const blob=new Blob([bytes],{type:mime});
    try{const image=await createImageBitmap(blob);image.close();}catch{throw Error('图片无法读取，请核对：'+f.name);}
    photos.push({key:crypto.randomUUID(),path:f.name,data:await toDataURL(blob),sha256:await digest(bytes),studentId:null,ignored:false});onProgress(i+1,files.length);
  }
  return photos;
}
