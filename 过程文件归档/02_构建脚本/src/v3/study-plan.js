import {cleanOverviewFilters} from './overview-model.js';
export const GROUP_SIZE=6;
export function canonicalFilters(value){const f=cleanOverviewFilters(value&&typeof value==='object'?value:{});for(const k of ['classes','provinces','needyLabels','psychLabels'])f[k].sort();f.query=f.query.trim();return f;}
export function planKey(rows,scope,filters,order,mode='study'){return JSON.stringify(['groups-v1',scope,canonicalFilters(filters),order,mode,rows.map(r=>r.id)]);}
export function createStudyPlan(rows,{id,name,scope='full',filters={},order='sequence',mode='study'},random=Math.random){
  if(!rows.length)throw Error('当前筛选范围没有可学习学生。');
  const ids=rows.map(r=>r.id);if(new Set(ids).size!==ids.length)throw Error('考核学生编号重复，无法生成分组。');
  if(order==='random')for(let i=ids.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
  return {id,name,scope,filters:canonicalFilters(filters),order,mode,key:planKey(rows,scope,filters,order,mode),groups:Array.from({length:Math.ceil(ids.length/GROUP_SIZE)},(_,i)=>ids.slice(i*GROUP_SIZE,(i+1)*GROUP_SIZE)),completed:[],manualCompleted:[],started:[],cursor:1,dailyGoal:1,notes:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
export function cleanStudyPlans(value,validIds){
  if(!Array.isArray(value))return [];
  const allowed=new Set(validIds),seen=new Set();
  return value.slice(0,100).flatMap(p=>{
    if(!p||typeof p.id!=='string'||p.id.length>100||seen.has(p.id)||typeof p.name!=='string'||p.name.length>200||!['full','name','className'].includes(p.scope)||!['sequence','random'].includes(p.order)||!['study','review'].includes(p.mode)||typeof p.key!=='string'||p.key.length>400000||!Array.isArray(p.groups)||!p.groups.length||p.groups.length>3334)return [];
    const ids=p.groups.flat();if(ids.length>20000||new Set(ids).size!==ids.length||p.groups.some((g,i)=>!Array.isArray(g)||!g.length||g.length>GROUP_SIZE||(i<p.groups.length-1&&g.length!==GROUP_SIZE))||ids.some(id=>!allowed.has(id)))return [];
    const list=k=>Array.isArray(p[k])?[...new Set(p[k].filter(n=>Number.isInteger(n)&&n>=1&&n<=p.groups.length))].sort((a,b)=>a-b):[];
    seen.add(p.id);return [{...p,filters:canonicalFilters(p.filters),completed:list('completed'),manualCompleted:list('manualCompleted'),started:list('started'),cursor:Number.isInteger(p.cursor)?Math.max(1,Math.min(p.groups.length,p.cursor)):1,dailyGoal:Number.isInteger(p.dailyGoal)?Math.max(1,Math.min(p.groups.length,p.dailyGoal)):1,notes:typeof p.notes==='string'?p.notes.slice(0,1000):''}];
  });
}
export function completedGroups(plan){return [...new Set([...plan.completed,...plan.manualCompleted])].sort((a,b)=>a-b);}
export function nextStudyGroup(plan){const done=new Set(completedGroups(plan));return plan.groups.findIndex((_,i)=>!done.has(i+1))+1;}
export function completeStudyGroup(plan,number,ids){
  if(!plan.groups[number-1]||JSON.stringify(plan.groups[number-1])!==JSON.stringify(ids))throw Error('分组记录不一致，未更新学习进度。');
  const next={...plan,completed:[...new Set([...plan.completed,number])].sort((a,b)=>a-b),updatedAt:new Date().toISOString()};next.cursor=nextStudyGroup(next)||number;return next;
}
export function manualStudyProgress(plan,through){
  if(!Number.isInteger(through)||through<0||through>plan.groups.length)throw Error('已学习组数超出本计划范围。');
  return {...plan,completed:plan.completed.filter(n=>n<=through),manualCompleted:Array.from({length:through},(_,i)=>i+1).filter(n=>!plan.completed.includes(n)),cursor:Math.min(through+1,plan.groups.length),updatedAt:new Date().toISOString()};
}
export function practiceKeyAction({key,code,repeat,isComposing,modified,blocked,control,missedControl,buttonAction},run){
  if(!run||run.stage==='done'||repeat||isComposing||modified||blocked)return null;
  if(key==='Enter'&&run.stage==='recall'&&run.revealed){if(control==='text'||control==='select'||control==='link'||(control==='checkbox'&&!missedControl)||(control==='button'&&buttonAction!=='grade'))return null;return 'grade';}
  if(code==='Space'&&control==='none'){if(run.stage==='study')return 'study-next';if(run.stage==='recall'&&!run.revealed)return 'reveal';}
  return null;
}

// Resume unfinished pre-update group/mock choices as oral recall; preserve continuous quizzes.
export function restoreRecallSession(run){
  if(!run||run.continuousId||(!run.objectiveMode&&!run.objectiveId))return run;
  if(run.stage==='done')return null;
  const {objectiveId,objectiveMode,...rest}=run;
  return {...rest,objectiveMode:false,queue:run.stage==='study'?[]:[...run.ids],index:run.stage==='study'?run.index:0,revealed:false,missed:[],results:[],retries:{}};
}
