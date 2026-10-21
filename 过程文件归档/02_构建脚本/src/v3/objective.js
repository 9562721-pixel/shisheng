import {mutateAnnualProgress,readProgress} from './annual-storage.js';
import {transactGame,notifyGame} from './game-storage.js';
import {completeStudyGroup} from './study-plan.js';
export const OBJECTIVE_FIELDS=[['name','姓名'],['className','班级'],['assessmentAddress','家庭住址'],['needyLabel','是否贫困生'],['psychLabel','心理情况']];
const shuffle=(a,random=Math.random)=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const text=v=>String(v??'无').trim()||'无';
export function buildQuestions(rows,ids,scope,random=Math.random){
  if(!['name','className','full'].includes(scope)||!Array.isArray(ids)||ids.length<1||ids.length>6||new Set(ids).size!==ids.length)throw Error('考核范围无效。');
  const fields=scope==='full'?OBJECTIVE_FIELDS:OBJECTIVE_FIELDS.filter(([k])=>k===scope),questions=[],facts=[];
  for(const studentId of ids){const r=rows.find(r=>r.id===studentId);if(!r?.photo)throw Error('学生考核照片缺失，请先核对材料。');for(const [field,label]of fields){const answer=text(r[field]),pool=[...new Set(rows.map(r=>text(r[field])))].filter(v=>v!==answer);if(!pool.length){facts.push({studentId,field,label,value:answer});continue;}const options=shuffle([answer,...shuffle(pool,random).slice(0,3)],random);questions.push({id:crypto.randomUUID(),studentId,field,label,options,correct:options.indexOf(answer)});}}
  return {questions,facts};
}
export function publicQuiz(q){const show=q.status==='done';return {...q,outbox:(q.outbox||[]).map(x=>({gold:x.gold||0,gifts:x.gifts||[]})),questions:q.questions.map(x=>({...x,correct:show||q.kind==='learn'&&x.choice!==undefined?x.correct:undefined}))};}
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function settle(dataset,quizId){
  let record=(await readProgress(dataset.id))?.state?.objective?.quizzes?.find(q=>q.id===quizId);if(!record)return;
  for(const pending of record.outbox||[]){
    if(pending.paid)continue;
    let result={gold:0,gifts:[]};
    if(record.continuousId&&record.kind==='learn')({result}=await transactGame({type:'reward',requestId:pending.id,events:pending.events,completed:pending.completed,kind:'learn',mode:'continuous'},{now:pending.at||record.finishedAt||record.createdAt}));
    await mutateAnnualProgress(dataset.id,dataset.hash,s=>{const item=s.objective?.quizzes?.find(q=>q.id===quizId)?.outbox.find(x=>x.id===pending.id);if(item&&!item.paid){const run=s.objective?.continuousRuns?.find(r=>r.id===record.continuousId);if(run)run.gold+=(result.gold||0);item.paid=true;item.gold=result.gold||0;item.gifts=(result.gifts||[]).map(x=>x.species);}});
  }
  notifyGame();record=(await readProgress(dataset.id))?.state?.objective?.quizzes?.find(q=>q.id===quizId);return record;
}
async function present(dataset,q){if(!q)throw Error('答题记录不存在，请重新开始。');const result=publicQuiz(q);if(q.continuousId){const run=(await readProgress(dataset.id))?.state?.objective?.continuousRuns?.find(r=>r.id===q.continuousId);if(run){const {ids,...summary}=run;result.continuous={...summary,total:ids.length};}}return result;}
export async function objectiveCommand(dataset,rows,command){
  if(['continuous-start','continuous-next'].includes(command.action)){
    let runId=command.runId,quizId;
    if(command.action==='continuous-start'){
      const ids=command.ids,scope=command.scope;
      if(!['name','className','full'].includes(scope)||!Array.isArray(ids)||!ids.length||ids.length>20000||new Set(ids).size!==ids.length||ids.some(id=>!rows.some(r=>r.id===id&&r.photo)))throw Error('当前筛选中没有有效考核照片。');
      if(!buildQuestions(rows,[ids[0]],scope).questions.length)throw Error('当前考核表在此范围均为相同信息，无法生成有效单选题。请调整练习内容。');
      runId=crypto.randomUUID();const run={id:runId,ids:[...ids],scope,index:0,status:'active',correct:0,questionsTotal:0,gold:0,effectiveCompleted:0,createdAt:Date.now()};
      await mutateAnnualProgress(dataset.id,dataset.hash,s=>{s.objective||={quizzes:[]};s.objective.continuousRuns||=[];s.objective.continuousRuns.unshift(run);s.objective.continuousRuns=s.objective.continuousRuns.slice(0,10);});
    }
    await mutateAnnualProgress(dataset.id,dataset.hash,s=>{
      const run=s.objective?.continuousRuns?.find(r=>r.id===runId);if(!run)throw Error('连续练习记录不存在，请重新开始。');
      const existing=s.objective.quizzes.find(q=>q.continuousId===runId&&q.position===run.index);if(existing){quizId=existing.id;return;}
      if(run.status==='done')throw Error('当前筛选已全部完成，请开始新一轮。');
      const ids=[run.ids[run.index]],built=buildQuestions(rows,ids,run.scope);
      const q={id:crypto.randomUUID(),kind:'learn',scope:run.scope,ids,continuousId:run.id,position:run.index,createdAt:Date.now(),status:'active',...built,outbox:[]};quizId=q.id;s.objective.quizzes.unshift(q);s.objective.quizzes=s.objective.quizzes.slice(0,60);
    });
    return present(dataset,await settle(dataset,quizId));
  }
  if(command.action==='start')throw Error('分组背诵与五人模考已恢复口述自评；请选择无限刷题进行单选练习。');
  const quizId=command.quizId;
  if(command.action==='get'){const q=await settle(dataset,quizId);if(!q)throw Error('客观答题记录不存在，请开始新一组。');return present(dataset,q);}
  if(!['answer','submit'].includes(command.action))throw Error('客观答题操作无效。');
  const saved=(await readProgress(dataset.id))?.state?.objective?.quizzes?.find(q=>q.id===quizId);if(!saved)throw Error('未找到本轮考核，请重新开始。');if(!saved.continuousId||saved.kind!=='learn')throw Error('此单选记录已转为历史，请使用口述背诵、模考或无限刷题入口。');
  const keys={};for(const q of saved.questions)keys[q.id]=await hash(`official-student-field-v1|${text(q.studentId)}|${q.field}`);
  const practiceKey=await hash('daily-six-person-practice');
  await mutateAnnualProgress(dataset.id,dataset.hash,s=>{
    const q=s.objective?.quizzes?.find(q=>q.id===quizId);if(!q)throw Error('本轮答题记录已变化。');
    for(const item of q.questions){const row=rows.find(r=>r.id===item.studentId);const correct=row&&item.options.indexOf(text(row[item.field]));if(!row||correct<0)throw Error('题目与锁定信息表不一致，请重新开始本轮。');item.correct=correct;}
    if(command.action==='answer'){
      const question=q.questions.find(x=>x.id===command.questionId);if(!question||!Number.isInteger(command.choice)||command.choice<0||command.choice>=question.options.length)throw Error('请选择有效答案。');
      if(q.status==='done'||q.kind==='learn'&&question.choice!==undefined)return;
      question.choice=command.choice;question.at=Date.now();
      if(q.kind==='learn'&&question.choice===question.correct)q.outbox.push({id:`answer:${q.id}:${question.id}`,events:[{kind:'answer',key:keys[question.id]}],completed:false,at:question.at});
    }else{
      if(q.status==='done')return;
      if(q.questions.some(x=>x.choice===undefined))throw Error('请完成所有单选题后再提交。');
      q.status='done';q.finishedAt=Date.now();
      const events=[];
      let fullGroup=q.ids.length===(q.kind==='learn'?6:5)&&q.questions.length>0;
      if(q.continuousId){const run=s.objective.continuousRuns?.find(r=>r.id===q.continuousId);if(!run||run.index!==q.position)throw Error('连续练习进度已变化，请重新读取。');run.index++;run.correct+=q.questions.filter(x=>x.choice===x.correct).length;run.questionsTotal+=q.questions.length;if(q.questions.length)run.effectiveCompleted++;fullGroup=q.questions.length>0&&run.effectiveCompleted%6===0;if(run.index>=run.ids.length){run.status='done';run.finishedAt=q.finishedAt;}}

      if(fullGroup)events.push({kind:'practice',key:practiceKey});
      q.outbox.push({id:`complete:${q.id}`,events,completed:fullGroup,at:q.finishedAt});
      // Objective results are distinct from the historical self-evaluation entries.
      s.progress||={};for(const studentId of q.ids){const tested=q.questions.filter(x=>x.studentId===studentId);if(!tested.length)continue;const p=s.progress[studentId]||={};const previous=p[q.scope];p[q.scope]={attempts:(previous?.attempts||0)+1,last:tested.every(x=>x.choice===x.correct)?'good':'miss',missed:tested.filter(x=>x.choice!==x.correct).map(x=>x.field),at:Date.now()};}
      if(q.kind==='learn'&&q.planId){const i=s.studyPlans?.findIndex(p=>p.id===q.planId);if(i>=0)s.studyPlans[i]=completeStudyGroup(s.studyPlans[i],q.planGroup,q.ids);}
    }
  });
  return present(dataset,await settle(dataset,quizId));
}
export function cleanObjective(value,validIds){
  if(!value||!Array.isArray(value.quizzes))return {quizzes:[]};const valid=new Set(validIds);
  const continuousRuns=(value.continuousRuns||[]).slice(0,10).filter(r=>r&&typeof r.id==='string'&&r.id.length<100&&Array.isArray(r.ids)&&r.ids.length<=20000&&r.ids.every(id=>valid.has(id))&&Number.isInteger(r.index)&&r.index>=0&&r.index<=r.ids.length&&['name','className','full'].includes(r.scope)&&['active','done'].includes(r.status)).map(r=>({id:r.id,ids:[...r.ids],scope:r.scope,index:r.index,status:r.status,correct:Number(r.correct)||0,questionsTotal:Number(r.questionsTotal)||0,gold:Number(r.gold)||0,effectiveCompleted:Number(r.effectiveCompleted)||0,createdAt:Number(r.createdAt)||0}));
  return {continuousRuns,quizzes:value.quizzes.slice(0,60).filter(q=>q&&typeof q.id==='string'&&q.id.length<100&&['learn','exam'].includes(q.kind)&&['full','name','className'].includes(q.scope)&&['active','done'].includes(q.status)&&Array.isArray(q.ids)&&q.ids.length<=6&&q.ids.every(id=>valid.has(id))&&Array.isArray(q.questions)&&q.questions.length<=30&&q.questions.every(x=>q.ids.includes(x.studentId)&&OBJECTIVE_FIELDS.some(([k])=>k===x.field)&&typeof x.id==='string'&&Array.isArray(x.options)&&x.options.length>=2&&x.options.length<=4&&x.options.every(v=>typeof v==='string'&&v.length<2000)&&Number.isInteger(x.correct)&&x.correct>=0&&x.correct<x.options.length&&(x.choice===undefined||Number.isInteger(x.choice)&&x.choice>=0&&x.choice<x.options.length))).map(q=>({...q,outbox:[]}))};
}
