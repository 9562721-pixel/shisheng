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
  for(const pending of record.outbox||[]){if(pending.paid)continue;const {result}=await transactGame({type:'reward',requestId:pending.id,events:pending.events,completed:pending.completed,kind:record.kind},{now:pending.at||record.finishedAt||record.createdAt});await mutateAnnualProgress(dataset.id,dataset.hash,s=>{const item=s.objective?.quizzes?.find(q=>q.id===quizId)?.outbox.find(x=>x.id===pending.id);if(item&&!item.paid){item.paid=true;item.gold=result.gold||0;item.gifts=(result.gifts||[]).map(x=>x.species);}});}
  notifyGame();record=(await readProgress(dataset.id))?.state?.objective?.quizzes?.find(q=>q.id===quizId);return record;
}
export async function objectiveCommand(dataset,rows,command){
  if(command.action==='start'){
    const {ids,scope,kind,planId,planGroup}=command;if(!['learn','exam'].includes(kind)||kind==='exam'&&ids?.length>5)throw Error('练习类型无效。');
    const built=buildQuestions(rows,ids,scope);const q={id:crypto.randomUUID(),kind,scope,ids:[...ids],planId:planId||'',planGroup:planGroup||0,createdAt:Date.now(),status:'active',...built,outbox:[]};
    await mutateAnnualProgress(dataset.id,dataset.hash,s=>{if(planId){const plan=s.studyPlans?.find(p=>p.id===planId);if(!plan||JSON.stringify(plan.groups[planGroup-1])!==JSON.stringify(ids))throw Error('学习分组已变化，请重新打开学习计划。');}s.objective||={quizzes:[]};s.objective.quizzes.unshift(q);s.objective.quizzes=s.objective.quizzes.slice(0,60);});return publicQuiz(q);
  }
  const quizId=command.quizId;
  if(command.action==='get'){const q=await settle(dataset,quizId);if(!q)throw Error('客观答题记录不存在，请开始新一组。');return publicQuiz(q);}
  if(!['answer','submit'].includes(command.action))throw Error('客观答题操作无效。');
  const saved=(await readProgress(dataset.id))?.state?.objective?.quizzes?.find(q=>q.id===quizId);if(!saved)throw Error('未找到本轮考核，请重新开始。');
  const keys={};for(const q of saved.questions)keys[q.id]=await hash(`official-student-field-v1|${text(q.studentId)}|${q.field}`);
  const practiceKey=await hash('daily-six-person-practice'),mockKey=await hash('daily-five-person-mock');
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
      const events=q.kind==='exam'?q.questions.filter(x=>x.choice===x.correct).map(x=>({kind:'answer',key:keys[x.id]})):[];
      const fullGroup=q.ids.length===(q.kind==='learn'?6:5)&&q.questions.length>0;
      if(fullGroup)events.push({kind:q.kind==='learn'?'practice':'mock',key:q.kind==='learn'?practiceKey:mockKey});
      q.outbox.push({id:`complete:${q.id}`,events,completed:fullGroup,at:q.finishedAt});
      // Objective results are distinct from the historical self-evaluation entries.
      s.progress||={};for(const studentId of q.ids){const tested=q.questions.filter(x=>x.studentId===studentId);if(!tested.length)continue;const p=s.progress[studentId]||={};const previous=p[q.scope];p[q.scope]={attempts:(previous?.attempts||0)+1,last:tested.every(x=>x.choice===x.correct)?'good':'miss',missed:tested.filter(x=>x.choice!==x.correct).map(x=>x.field),at:Date.now()};}
      if(q.kind==='learn'&&q.planId){const i=s.studyPlans?.findIndex(p=>p.id===q.planId);if(i>=0)s.studyPlans[i]=completeStudyGroup(s.studyPlans[i],q.planGroup,q.ids);}
    }
  });
  return publicQuiz(await settle(dataset,quizId));
}
export function cleanObjective(value,validIds){
  if(!value||!Array.isArray(value.quizzes))return {quizzes:[]};const valid=new Set(validIds);
  return {quizzes:value.quizzes.slice(0,60).filter(q=>q&&typeof q.id==='string'&&q.id.length<100&&['learn','exam'].includes(q.kind)&&['full','name','className'].includes(q.scope)&&['active','done'].includes(q.status)&&Array.isArray(q.ids)&&q.ids.length<=6&&q.ids.every(id=>valid.has(id))&&Array.isArray(q.questions)&&q.questions.length<=30&&q.questions.every(x=>q.ids.includes(x.studentId)&&OBJECTIVE_FIELDS.some(([k])=>k===x.field)&&typeof x.id==='string'&&Array.isArray(x.options)&&x.options.length>=2&&x.options.length<=4&&x.options.every(v=>typeof v==='string'&&v.length<2000)&&Number.isInteger(x.correct)&&x.correct>=0&&x.correct<x.options.length&&(x.choice===undefined||Number.isInteger(x.choice)&&x.choice>=0&&x.choice<x.options.length))).map(q=>({...q,outbox:[]}))};
}
