import './entry.js';
import {inspectLegacy,legacyBackup,readLegacyPhotos} from './legacy.js';
import legacyHtml from './legacy-v2.html?raw';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let legacy=null;
function download(value,name,type='application/json'){const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value)],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function view(name){
 document.querySelector('beizhaopian-entry')?.closeFrame();
 for(const section of document.querySelectorAll('[data-panel]'))section.hidden=section.dataset.panel!==name;
 for(const button of document.querySelectorAll('[data-tab]')){const selected=button.dataset.tab===name;button.setAttribute('aria-current',selected?'page':'false');}
 document.querySelector('main').scrollTop=0;
 if(name!=='legacy')return;
 const output=document.querySelector('#legacy-list');output.innerHTML='<p>正在检查本机旧版资料…</p>';
 try{legacy=await inspectLegacy();output.innerHTML=legacy.libraries.length?legacy.libraries.map((l,i)=>`<article class="legacy-row"><div><h3>${esc(l.name||'旧版名册')}</h3><p>${l.rows?.length||0} 人 · 旧版资料及学习记录</p></div><button type="button" data-export-legacy="${i}">导出此名册旧版备份</button></article>`).join(''):`<p>${legacy.hasV1?'检测到早期版本资料，可使用2.0兼容程序读取并备份。':'当前地址未检测到2.0版名册。请在原先使用识生的地址或文件中导出旧版备份。'}</p>`;}catch(e){output.textContent=e.message;}
}
window.addEventListener('shisheng:legacy',()=>void view('legacy'));
document.addEventListener('click',async event=>{
 const tab=event.target.closest('[data-tab]');if(tab){await view(tab.dataset.tab);return;}
 if(event.target.closest('[data-download-legacy]')){download(legacyHtml,'识生2.0兼容版.html','text/html;charset=utf-8');return;}
 const button=event.target.closest('[data-export-legacy]');if(button){button.disabled=true;try{const l=legacy.libraries[Number(button.dataset.exportLegacy)];download(await legacyBackup(l,await readLegacyPhotos(l)),(l.name||'旧版名册')+'-识生备份.json');document.querySelector('#legacy-status').textContent='旧版备份已导出，包含原照片、词条与学习记录。';}catch(e){document.querySelector('#legacy-status').textContent=e.message;}finally{button.disabled=false;}}
});
