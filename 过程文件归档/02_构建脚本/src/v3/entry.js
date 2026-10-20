import {reconcilePracticeState} from './model.ts';
import {readAssessmentWorkbook} from './assessment.js';
import {annualRows,matchOfficialPhotos,sealDataset,verifyDataset,digest} from './annual.js';
import {readAnnual,selectAnnual,appendAnnual,readProgress,saveAnnualProgress} from './annual-storage.js';
import {readPhotoZip,toDataURL} from './annual-files.js';
import pluginHtml from './plugin.html?raw';
import overviewModelSource from './overview-model.js?raw';
import overviewUISource from './overview-ui.js?raw';
import studyPlanSource from './study-plan.js?raw';
import studyUISource from './study-ui.js?raw';
import objectiveUISource from './objective-ui.js?raw';
import {objectiveCommand} from './objective.js';
import './game-element.js';
const MAX=2*1024*1024;
const esc=value=>String(value??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const button=(action,label,primary=false)=>`<button type="button" data-action="${action}" class="bp-button${primary?' bp-primary':''}">${label}</button>`;
const style = `<style>
beizhaopian-entry{display:block;margin:0 0 20px;color:var(--color-ink,#263f35)}
.bp-card{padding:20px;border:1px solid var(--color-school-line,#c6d6cd);border-radius:10px;background:var(--color-school-mist,#eef4ef)}
.bp-top,.bp-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.bp-actions{justify-content:flex-start;gap:8px;margin-top:14px}
.bp-title{font-size:20px;line-height:1.4;font-weight:600;margin:0 0 6px}.bp-copy{font-size:14px;line-height:1.8;margin:0;color:var(--color-muted,#5e7067)}
.bp-button{cursor:pointer;min-height:44px;padding:8px 16px;border:1px solid #b5c7ba;border-radius:7px;background:var(--color-card,#fff);font:inherit;font-size:14px;color:inherit}.bp-primary{background:#245342;border-color:#245342;color:#fff}.bp-button:focus-visible,.bp-input:focus-visible{outline:3px solid #699981;outline-offset:3px}.bp-button:disabled{opacity:.55;cursor:wait}
.bp-panel{margin-top:16px;border:1px solid #c6d6cd;border-radius:10px;overflow:hidden;background:var(--color-card,#fff)}.bp-panel header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px 16px;border-bottom:1px solid #d8e0d9}.bp-panel iframe{display:block;width:100%;height:740px;height:max(600px,calc(100dvh - 220px));border:0;background:#f8f7f3}
.bp-note{margin-top:12px;font-size:12px;line-height:1.8;color:var(--color-muted,#5e7067)}.bp-error{color:#9d3434}.bp-editor{margin-top:16px;border-top:1px solid #c6d6cd;padding-top:16px}.bp-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:12px 0}.bp-label{font-size:14px}.bp-input{display:block;width:100%;min-height:44px;margin-top:6px;padding:8px 10px;border:1px solid #b5c7ba;border-radius:6px;background:var(--color-card,#fff);color:inherit;font:inherit}.bp-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.bp-list .bp-button{text-align:left}.bp-details{margin-top:14px;font-size:14px;line-height:1.8}.bp-details summary{cursor:pointer;min-height:44px;padding-top:10px}.bp-editor h3{margin:0;font-size:16px;font-weight:600}
@media(max-width:600px){.bp-card{padding:16px}.bp-fields{grid-template-columns:1fr}.bp-top{gap:8px}.bp-actions .bp-button{flex:1}.bp-panel iframe{height:max(600px,calc(100dvh - 160px))}.bp-panel header{padding:12px}.bp-title{font-size:19px}}
.bp-panel header .bp-button{white-space:nowrap;flex:none}.bp-panel.bp-expanded{position:fixed;inset:0;z-index:1000;border-radius:0;display:flex;flex-direction:column;height:100dvh;margin:0}.bp-panel.bp-expanded header{flex:none}.bp-panel.bp-expanded iframe{flex:1;min-height:0;height:0}
</style>`;

class RecognitionEntry extends HTMLElement{
  connectedCallback(){
    this.active=true;this.loaded=false;this.sets=[];this.current=null;this.state=null;this.queue=Promise.resolve();this.message='';this.busy=false;
    this.addEventListener('click',this.click);this.addEventListener('change',this.change);this.studyRequest=()=>{if(this.current)void this.openFrame();else this.showError('请先上传照片压缩包和考核信息表，再开始照片学习。');};this.addEventListener('recognition-study-request',this.studyRequest);


    try{this.channel=new BroadcastChannel('shisheng-annual-v3');this.channel.onmessage=()=>void this.load();}catch{this.channel={postMessage(){},close(){}};}
    void this.load();
  }
  disconnectedCallback(){this.active=false;this.epoch=(this.epoch||0)+1;this.closeFrame();this.unsubscribe?.();this.channel?.close();this.removeEventListener('click',this.click);this.removeEventListener('change',this.change);this.removeEventListener('recognition-study-request',this.studyRequest);}
  async load(){
    const epoch=this.epoch=(this.epoch||0)+1;
    try{await this.queue.catch(()=>{});const catalog=await readAnnual();const selected=catalog.sets.find(d=>d.id===catalog.active)||catalog.sets.at(-1)||null;const saved=selected?await readProgress(selected.id):null;
      if(!this.active||this.epoch!==epoch)return;
      const changed=this.current?.id!==selected?.id;if(changed)this.closeFrame();
      this.sets=catalog.sets;this.current=selected;this.state=selected&&saved?.hash===selected.hash?saved.state:null;this.loaded=true;
      if(!this.frameCleanup)this.render();
    }catch(e){this.message='考核库读取失败，请重试；原资料保留。';this.render();}
  }
  rows(){return this.current?annualRows(this.current):[];}
  async saveState(dataset,state){
    const pending=this.queue.catch(()=>{}).then(()=>saveAnnualProgress(dataset.id,dataset.hash,state));this.queue=pending;await pending;
    if(this.current?.id===dataset.id)this.state=state;
  }
  enableControls(){
    for(const el of this.querySelectorAll('button,select,input'))el.disabled=!this.loaded||this.busy;
    const u=this.upload,seal=this.querySelector('[data-seal]');if(seal&&u){const parsed=u.sheets[u.sheetIndex];seal.disabled=this.busy||!!(parsed.duplicates.length+parsed.invalid.length)||u.photos.some(p=>!p.ignored&&!p.studentId)||!annualRows(u).some(r=>r.sure);}
  }
  render(){
    if(!this.active)return;
    const d=this.current,rows=this.rows(),count=rows.filter(x=>x.sure).length;
    this.innerHTML=style+`<section class="bp-card" aria-label="识生独立考核库"><div class="bp-top"><div><h2 class="bp-title">识生</h2><p class="bp-copy">上传年度照片包与信息表，核对后开始学习。</p></div>${d?button('open','打开识生',true):''}</div>${this.sets.length?`<label class="bp-label">考核年度与材料<select class="bp-input" aria-label="考核年度与材料">${this.sets.map(x=>`<option value="${esc(x.id)}" ${x.id===d?.id?'selected':''}>${esc(x.year)} 年 · ${esc(x.table.name)} · ${esc(new Date(x.restoredAt||x.lockedAt).toLocaleString('zh-CN'))}${x.restoredAt?' · 恢复副本':''}</option>`).join('')}</select></label><p class="bp-note">材料已锁定 · 考核 ${rows.length} 人 · 可练习 ${count} 人${count<rows.length?` · 缺照片 ${rows.length-count} 人`:''}。原表、照片与答案已锁定，学习记录独立保存。</p>`:''}<details class="bp-details bp-materials" ${!d?'open':''}><summary>${d?'导入年度考核材料':'上传考核材料'}</summary><form class="bp-upload"><label class="bp-label">考核年度<input class="bp-input" type="number" min="2000" max="2100" value="${new Date().getFullYear()}" aria-label="考核年度" required></label><div class="bp-fields" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))"><label class="bp-label">① 照片压缩包<input class="bp-input" type="file" accept=".zip" aria-label="照片压缩包" required></label><label class="bp-label">② 考核信息表<input class="bp-input" type="file" accept=".xls,.xlsx" aria-label="考核信息表" required></label></div><p class="bp-note">只需一个 ZIP 和一张 XLS / XLSX。考核答案只取自信息表，空白按“无”。导入后保存独立年度版本，已有材料保留。</p><div class="bp-actions"><button class="bp-button bp-primary" type="submit">匹配并预览</button></div></form><div class="bp-preview"></div></details>${d?`<details class="bp-details"><summary>查看考核资料与备份</summary><p class="bp-note">${esc(d.year)} 年 · 原始信息表：${esc(d.table.name)} · 工作表：${esc(d.table.sheet)} · 原始照片包：${esc(d.photoPackage?.name||'备份内照片')}<br>本考核库的原表、照片、匹配结果和进度均保存在本机，可同时保存学习计划与进度。上级更正材料请重新导入，原版本保留。</p><input class="bp-input" type="search" aria-label="检索考核资料" placeholder="姓名、学号、班级"><div class="bp-list"></div><div class="bp-readonly"></div><div class="bp-actions">${button('export','导出当前考核完整备份')}${button('restore','恢复考核备份')}</div></details>`:`<div class="bp-actions">${button('restore','恢复考核备份')}</div>`}<details class="bp-details"><summary>旧版资料与备份</summary><p class="bp-note">旧版识生资料保持原位。可查看旧版名册、导出原有备份，或下载2.0兼容程序。旧文件名资料不自动转换为本年度考核答案。</p>${button('legacy','打开旧版资料')}</details><input type="file" accept=".json" aria-label="选择年度考核备份" hidden><p class="bp-copy bp-error" role="alert">${esc(this.message)}</p></section><div class="bp-frame-slot"></div>`;
    this.insertAdjacentHTML('afterbegin','<recognition-game></recognition-game>');
    for(const b of this.querySelectorAll('button'))b.disabled=!this.loaded;
    this.querySelector('.bp-upload').onsubmit=e=>{e.preventDefault();void this.previewUpload();};
    this.querySelector('[aria-label="选择年度考核备份"]').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)void this.previewBackup(f);};
    this.querySelector('[aria-label="检索考核资料"]')?.addEventListener('input',e=>this.drawList(e.target.value));this.drawList('');
  }
  showError(message){this.message=message;const el=this.querySelector('[role="alert"]');if(el)el.textContent=message;}
  drawList(q){const slot=this.querySelector('.bp-list');if(!slot)return;const rows=this.rows().filter(r=>`${r.name} ${r.id} ${r.className}`.includes(q.trim()));slot.innerHTML=rows.slice(0,20).map(r=>`<button class="bp-button" data-view="${esc(r.id)}">${esc(r.name)} · ${esc(r.className)} · ${r.sure?'可练习':'待补照片'}</button>`).join('')||'<p>没有匹配的考核学生。</p>';}
  viewRow(id){const r=this.rows().find(x=>x.id===id);if(!r)return;this.querySelector('.bp-readonly').innerHTML=`<div class="bp-editor"><h3>${esc(r.name)} 的考核资料（只读）</h3>${r.photo?`<img src="${esc(r.photo)}" alt="考核照片" style="width:96px;max-height:140px;object-fit:contain">`:''}<div class="bp-fields">${[['className','班级'],['assessmentAddress','家庭住址'],['needyLabel','是否贫困生'],['psychLabel','心理情况']].map(([k,v])=>`<div><strong>${v}</strong><p class="bp-copy">${esc(r[k])}</p></div>`).join('')}</div></div>`;}
  click=async e=>{const b=e.target.closest('button');if(!b||!this.contains(b)||this.busy)return;try{
    if(b.dataset.view){this.viewRow(b.dataset.view);return;}
    if(b.dataset.action==='open')await this.openFrame();
    if(b.dataset.action==='close')this.closeFrame();
    if(b.dataset.action==='expand'){const panel=this.querySelector('.bp-panel');panel?.classList.toggle('bp-expanded');b.textContent=panel?.classList.contains('bp-expanded')?'收起练习区':'放大练习区';}
    if(b.dataset.action==='restore')this.querySelector('[aria-label="选择年度考核备份"]').click();
    if(b.dataset.action==='export')await this.exportBackup();

    if(b.dataset.action==='legacy')await this.exportLegacy();
  }catch(error){this.showError(error.message||'操作未完成，请重试。');}};
  change=async e=>{if(e.target.closest('.bp-upload')){this.upload=null;this.querySelector('.bp-preview')?.replaceChildren();}if(e.target.getAttribute('aria-label')==='考核年度与材料'&&!this.busy){try{this.closeFrame();await selectAnnual(e.target.value);this.message='';await this.load();this.channel.postMessage('changed');}catch{this.showError('切换失败，请重试。');}}};
  closeFrame(){this.frameCleanup?.();this.frameCleanup=null;this.querySelector('.bp-frame-slot')?.replaceChildren();}
  async openFrame() {
    if(!this.loaded || !this.current || this.frameCleanup) return;
    await this.queue.catch(()=>{});
    if(!this.active) return;
    const dataset=this.current;
    const rows=this.rows();
    const state=reconcilePracticeState(this.state,rows);
    const slot=this.querySelector('.bp-frame-slot');
    slot.innerHTML=`<section class="bp-panel bp-expanded" aria-label="识生练习面板"><header><p role="status" class="bp-copy">正在打开识生…</p><div class="bp-actions" style="margin-top:0">${button('expand','收起练习区')}${button('close','返回考核材料')}</div></header><iframe title="识生练习" sandbox="allow-scripts"></iframe></section>`;
    const frame=slot.querySelector('iframe'),status=slot.querySelector('[role="status"]');
    let port,active=true;
    const timeout=setTimeout(()=>{if(active) status.textContent='识生未能启动，请返回后重试。';},8000);
    const receive=event=>{
      if(event.source!==frame.contentWindow || event.data?.type!=='shisheng:ready' || port) return;
      clearTimeout(timeout);
      const channel=new MessageChannel();port=channel.port1;
      port.onmessage=async event=>{
        const data=event.data;
        if(!active || !this.active) return;
        if(data?.type==='return') { this.closeFrame(); this.querySelector('.bp-materials')?.scrollIntoView({block:'start'}); return; }
        if(data?.type==='objective'){
          try{await this.queue;const quiz=await objectiveCommand(dataset,rows,data.command);const saved=await readProgress(dataset.id);if(this.current?.id===dataset.id)this.state=saved?.state;port.postMessage({type:'objective-result',requestId:data.requestId,ok:true,quiz,progress:saved?.state?.progress||{},studyPlans:saved?.state?.studyPlans||[]});}
          catch(error){port.postMessage({type:'objective-result',requestId:data.requestId,ok:false,error:error.message});}return;
        }
        if(data?.type!=='save')return;
        try {
          if(typeof data.requestId!=='string' || JSON.stringify(data.state).length>MAX)throw Error('无效进度');
          const latest=await readProgress(dataset.id);
          const sanitized=reconcilePracticeState({...data.state,signatures:state.signatures,objective:latest?.state?.objective},rows);
          sanitized.objective=latest?.state?.objective||{quizzes:[]};
          await this.saveState(dataset,sanitized);
          if(active){status.textContent='练习进度已保存在本机';port.postMessage({type:'saved',requestId:data.requestId,ok:true});}
        }catch{if(active){status.textContent='保存失败，请重试或导出练习备份';port.postMessage({type:'saved',requestId:data.requestId,ok:false});}}
      };
      frame.contentWindow.postMessage({type:'shisheng:init',rows,state,label:`${dataset.year} 年考核`},'*',[channel.port2]);
      status.textContent=`${dataset.year} 年考核 · 材料已锁定 · 本机练习`;
    };
    window.addEventListener('message',receive);
    this.frameCleanup=()=>{active=false;clearTimeout(timeout);port?.close();window.removeEventListener('message',receive);};
    frame.srcdoc=pluginHtml.replace('/* OVERVIEW_MODEL */',()=>overviewModelSource.replace(/^export /gm,'')).replace('/* OVERVIEW_UI */',()=>overviewUISource).replace('/* STUDY_PLAN */',()=>studyPlanSource.replace(/^import .*;$/gm,'').replace(/^export /gm,'')).replace('/* STUDY_UI */',()=>studyUISource).replace('/* OBJECTIVE_UI */',()=>objectiveUISource).replace(/<head>/i,`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`);
    slot.scrollIntoView({block:'start'});
    slot.querySelector('[data-action="close"]').focus({preventScroll:true});
  }
  async previewUpload(){
    if(!this.loaded||this.busy)return;this.closeFrame();this.showError('');
    const form=this.querySelector('.bp-upload'),zip=form.querySelector('[aria-label="照片压缩包"]').files[0],table=form.querySelector('[aria-label="考核信息表"]').files[0],year=form.querySelector('[aria-label="考核年度"]').value;
    if(!zip||!table||!/^20\d{2}$/.test(year)){this.showError('请选择照片压缩包、考核信息表和正确年度。');return;}
    this.busy=true;for(const b of this.querySelectorAll('button,select,input'))b.disabled=true;
    try{
      if(table.size>30*1024*1024)throw Error('信息表超过 30 MB，请核对文件。');
      const bytes=await table.arrayBuffer(),sheets=readAssessmentWorkbook(bytes),photos=await readPhotoZip(zip,(i,n)=>this.showError(`正在本机整理照片 ${i} / ${n}…`));
      if(!this.active)return;
      this.upload={id:crypto.randomUUID(),year,label:`${year} 年考核`,table:{name:table.name,data:await toDataURL(table),sha256:await digest(bytes),sheet:''},photoPackage:{name:zip.name,sha256:await digest(await zip.arrayBuffer())},sheets,sheetIndex:0,photos};
      this.showError('');this.drawPreview();
    }catch(error){this.showError(error.message||'材料读取失败。');}
    finally{this.busy=false;this.enableControls();}
  }
  drawPreview(){
    const u=this.upload;if(!u)return;const parsed=u.sheets[u.sheetIndex];u.rows=parsed.records;u.photos=matchOfficialPhotos(u.rows,u.photos);u.table.sheet=parsed.sheetName;
    const ready=annualRows(u).filter(r=>r.sure).length,pending=u.photos.filter(p=>!p.ignored&&!p.studentId),invalid=parsed.duplicates.length+parsed.invalid.length;
    const slot=this.querySelector('.bp-preview');slot.innerHTML=`<section class="bp-editor" aria-label="年度考核材料预览"><h3>${esc(u.year)} 年考核材料预览</h3>${u.sheets.length>1?`<label>信息表工作表<select class="bp-input" aria-label="信息表工作表">${u.sheets.map((s,i)=>`<option value="${i}" ${i===u.sheetIndex?'selected':''}>${esc(s.sheetName)}</option>`).join('')}</select></label>`:''}<p class="bp-copy">信息表 ${u.rows.length} 人 · 已匹配照片 ${ready} 人 · 缺照片 ${u.rows.length-ready} 人 · 待核对照片 ${pending.length} 张 · 已忽略 ${u.photos.filter(p=>p.ignored).length} 张</p>${invalid?`<p class="bp-error">信息表有 ${invalid} 条重复或无效行，请修正原表后重新上传。</p>`:''}<p class="bp-note">确认后，原表、照片及匹配结果将锁定为独立考核版本。练习答案只来自上级信息表。${ready<u.rows.length?'缺照片的学生会保留在考核库中，暂不参加练习。':''}</p><details class="bp-details"><summary>查看答案样例</summary>${u.rows.slice(0,3).map(r=>`<p class="bp-copy">${esc(r.name)} · ${esc(r.className)}<br>家庭住址：${esc(r.assessmentAddress)} · 是否贫困生：${esc(r.needyLabel)} · 心理情况：${esc(r.psychLabel)}</p>`).join('')}</details>${pending.length?`<details class="bp-details" open><summary>仅有 ${pending.length} 张照片需要核对</summary>${pending.slice(0,30).map(p=>`<div class="bp-editor"><img src="${esc(p.data)}" alt="待核对考核照片" style="width:70px;max-height:100px;object-fit:contain"><p class="bp-copy">${esc(p.path)}<br>${esc(p.issue)}</p><label>考核学生<select class="bp-input" data-photo-target="${esc(p.key)}"><option value="">选择学生</option>${u.rows.map(r=>`<option value="${esc(r.id)}">${esc(r.id)} · ${esc(r.name)}</option>`).join('')}</select></label><div class="bp-actions"><button class="bp-button" data-match="${esc(p.key)}">确认关联</button><button class="bp-button" data-ignore="${esc(p.key)}">忽略此照片</button></div></div>`).join('')}<p class="bp-note">一次展示前 30 张，处理后继续显示。只关联照片，不从文件名提取考核答案。</p><button class="bp-button" data-ignore-all>忽略全部待核对照片（${pending.length} 张）</button></details>`:''}<div class="bp-actions"><button class="bp-button bp-primary" data-seal ${pending.length||invalid||!ready?'disabled':''}>确认材料，开始背诵</button><button class="bp-button" data-cancel-upload>取消</button></div><p class="bp-copy" role="status"></p></section>`;
    slot.querySelector('[aria-label="信息表工作表"]')?.addEventListener('change',e=>{u.sheetIndex=Number(e.target.value);for(const p of u.photos)delete p.manualId;this.drawPreview();});
    for(const b of slot.querySelectorAll('[data-match]'))b.onclick=()=>{const key=b.dataset.match,id=[...slot.querySelectorAll('[data-photo-target]')].find(x=>x.dataset.photoTarget===key).value;if(!id){slot.querySelector('[role="status"]').textContent='请先选择考核表中的学生。';return;}u.photos=u.photos.map(p=>p.key===key?{...p,manualId:id}:p);this.drawPreview();};
    for(const b of slot.querySelectorAll('[data-ignore]'))b.onclick=()=>{u.photos=u.photos.map(p=>p.key===b.dataset.ignore?{...p,ignored:true}:p);this.drawPreview();};
    slot.querySelector('[data-ignore-all]')?.addEventListener('click',()=>{const keys=new Set(pending.map(p=>p.key));u.photos=u.photos.map(p=>keys.has(p.key)?{...p,ignored:true}:p);this.drawPreview();});
    slot.querySelector('[data-cancel-upload]').onclick=()=>{this.upload=null;slot.replaceChildren();};
    slot.querySelector('[data-seal]').onclick=()=>void this.finishUpload();slot.scrollIntoView({block:'nearest'});
  }
  async finishUpload(){
    if(this.busy||!this.upload)return;this.busy=true;const u=this.upload;for(const el of this.querySelectorAll('button,select,input'))el.disabled=true;
    try{
      if(u.sheets[u.sheetIndex].duplicates.length||u.sheets[u.sheetIndex].invalid.length)throw Error('信息表有无效或重复行，请修正后重新上传。');
      const dataset=await sealDataset({id:u.id,year:u.year,label:u.label,table:u.table,photoPackage:u.photoPackage,rows:u.rows,photos:u.photos});
      await appendAnnual(dataset);this.upload=null;this.message='考核材料已独立保存并锁定。';await this.load();this.channel.postMessage('changed');if(this.active)await this.openFrame();
    }catch(error){this.showError(error.message||'考核材料保存失败，请重试。');}
    finally{this.busy=false;this.enableControls();}
  }
  download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async exportBackup(){if(!this.current)return;const d=this.current;await this.queue;const p=await readProgress(d.id);this.download({format:'counselor-annual-assessment',version:1,dataset:d,state:p?.hash===d.hash?p.state:null},`识生_${d.year}年_考核完整备份.json`);}
  async previewBackup(file){
    if(this.busy)return;this.closeFrame();this.busy=true;
    try{if(file.size>600*1024*1024)throw Error('备份超过 600 MB。');const data=JSON.parse(await file.text());if(data.format!=='counselor-annual-assessment'||data.version!==1)throw Error('请选择年度考核完整备份；旧版练习存档不能作为上级材料导入。');await verifyDataset(data.dataset);if(!this.active)return;const slot=this.querySelector('.bp-preview');this.querySelector('.bp-materials').open=true;slot.innerHTML=`<section class="bp-editor"><h3>确认恢复年度考核备份</h3><p class="bp-copy">${esc(data.dataset.year)} 年 · ${data.dataset.rows.length} 人 · 包含原表、照片、匹配与进度。以独立副本恢复，当前资料全部保留。</p><div class="bp-actions"><button class="bp-button bp-primary" data-restore-confirm>确认恢复考核备份</button><button class="bp-button" data-restore-cancel>取消</button></div></section>`;
      slot.querySelector('[data-restore-cancel]').onclick=()=>slot.replaceChildren();slot.querySelector('[data-restore-confirm]').onclick=async e=>{if(this.busy)return;this.busy=true;e.target.disabled=true;try{const d={...data.dataset,id:crypto.randomUUID(),restoredAt:new Date().toISOString()};await appendAnnual(d,reconcilePracticeState(data.state,annualRows(d)));this.message='考核备份已恢复，原有年度材料保留。';await this.load();this.channel.postMessage('changed');}catch(error){this.showError(error.message);}finally{this.busy=false;e.target.disabled=false;}};slot.scrollIntoView({block:'nearest'});
    }catch(error){this.showError(error.message||'备份读取失败。');}finally{this.busy=false;}
  }
  async exportLegacy(){window.dispatchEvent(new Event('shisheng:legacy'));}
}
customElements.define('beizhaopian-entry',RecognitionEntry);
