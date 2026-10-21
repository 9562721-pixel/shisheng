import { z } from "zod";
import {cleanOverviewFilters} from "./overview-model.js";
import {cleanStudyPlans,restoreRecallSession} from "./study-plan.js";
import {cleanObjective} from "./objective.js";
import type { Student, PhotoRecord } from "./types.ts";

export const PRACTICE_FIELDS = [["assessmentAddress","家庭住址"],["needyLabel","是否贫困生"],["psychLabel","心理情况"]] as const;
const valid = (value:string|undefined) => value && !["未填写","待核实","—"].includes(value) ? value : "";
export function recognitionCandidate(student: Student, records: PhotoRecord[]) {
  const linked=records.filter(r=>r.studentId===student.id && r.manualStudentId!=="");
  const record=linked.length===1 ? linked[0] : undefined;
  const f=record?.fields;
  const hometown=valid(f?.["籍贯"]) || valid(student.ledgerFields?.["籍贯"]) || valid(student.ledgerFields?.["生源地"]) || "";
  const needyLabel=f && Object.hasOwn(f,"贫困") ? f["贫困"] || "无" : valid([...student.aid].reverse().find(a=>valid(a.hardship))?.hardship) || "";
  const psychLabel=f && Object.hasOwn(f,"心理") ? f["心理"] || "无" : valid(student.psych) || "";
  return {hometown,assessmentAddress:valid(student.ledgerFields?.["家庭住址"])||valid(student.address)||"",other:"",needyLabel,psychLabel,sourceStamp:JSON.stringify([hometown,needyLabel,psychLabel]),source:record?"照片文件名词条（保留原文）":"当前台账候选（需核对适用时期）"};
}
export function recognitionRow(s: Student, records: PhotoRecord[]) {
  const candidate=recognitionCandidate(s,records);
  const confirmed=s.recognition?.definition==="assessment-v1" && s.recognition?.identityStamp===JSON.stringify([s.id,s.name,s.className]);
  const values=s.recognition ?? candidate;
  const readyScopes:string[]=[];
  const photo=s.photo && /^data:image\/(?:png|jpeg|webp|gif|bmp|svg\+xml);/i.test(s.photo) ? s.photo : "";
  if(photo && s.name.trim()) readyScopes.push("name");
  if(photo && valid(s.className) && s.className!=="未分班") readyScopes.push("className");
  if(confirmed && readyScopes.length===2 && PRACTICE_FIELDS.every(([k])=>valid(values[k]))) readyScopes.push("full");
  const issues=[...(!readyScopes.includes("className")?["待补班级或照片"]:[]),...(!photo?["待补照片"]:[]),...(!confirmed?["练习词条待确认"]:[]),...PRACTICE_FIELDS.filter(([k])=>!valid(values[k])).map(([,label])=>`待补${label}`)];
  return {id:s.id,name:s.name,className:s.className,studentNo:s.id,photo,hometown:values.hometown,assessmentAddress:values.assessmentAddress||"",other:values.other||"",needyLabel:values.needyLabel,psychLabel:values.psychLabel,readyScopes,sure:readyScopes.includes("full"),issues,rel:s.name};
}

const scopes=z.enum(["full","name","className"]);
const fields=z.enum(["name","className","studentNo","hometown","assessmentAddress","needyLabel","psychLabel","other"]);
const answer=z.object({id:z.string(),missed:z.array(fields).max(8),skip:z.boolean().optional()});
const result=z.object({last:z.enum(["good","miss"]),attempts:z.number().finite().nonnegative(),at:z.number().finite(),missed:z.array(fields).max(8)});
const record=z.object({viewed:z.boolean().optional(),rounds:z.number().finite().nonnegative().optional(),viewedScopes:z.array(scopes).max(3).optional(),full:result.optional(),name:result.optional(),className:result.optional()});
const sessionSchema=z.object({kind:z.enum(["learn","exam"]),scope:scopes,stage:z.enum(["study","recall","done"]),ids:z.array(z.string()).max(6),queue:z.array(z.string()).max(12),index:z.number().int().nonnegative(),revealed:z.boolean(),missed:z.array(fields).max(8),results:z.array(answer).max(12),retries:z.record(z.string(),z.number().finite()).default({}),reviewOnly:z.boolean().optional(),planId:z.string().max(100).optional(),planGroup:z.number().int().min(1).max(3334).optional(),objectiveMode:z.boolean().optional(),objectiveId:z.string().max(100).optional(),continuousId:z.string().max(100).optional()});
function photoStamp(photo:string) {
  let a=2166136261,b=5381;
  for(let i=0;i<photo.length;i++){a=Math.imul(a^photo.charCodeAt(i),16777619);b=Math.imul(b,33)^photo.charCodeAt(i);}
  return `${photo.length}:${a>>>0}:${b>>>0}`;
}
export function reconcilePracticeState(saved: unknown, rows: ReturnType<typeof recognitionRow>[]) {
  const state=saved && typeof saved==="object" && !Array.isArray(saved) ? saved as Record<string,unknown> : {};
  const progress:Record<string,z.infer<typeof record>>={};
  const rawProgress=state.progress && typeof state.progress==="object" ? state.progress as Record<string,unknown> : {};
  const oldSignatures=state.signatures && typeof state.signatures==="object" ? state.signatures as Record<string,string> : {};
  const signatures:Record<string,string>={};
  let changed=false;
  for(const row of rows) {
    const signature=JSON.stringify([row.name,row.className,row.assessmentAddress,row.needyLabel,row.psychLabel,photoStamp(row.photo),row.sure,"","","five-fields-v1"]);
    signatures[row.id]=signature;
    const parsed=record.safeParse(rawProgress[row.id]);
    if(!parsed.success)continue;
    progress[row.id]=parsed.data;
    if(oldSignatures[row.id]!==signature) {
      let old:unknown[]=[];try{const value=JSON.parse(oldSignatures[row.id]??"[]");if(Array.isArray(value))old=value;}catch{/* incompatible signature */}
      if(old[5]!==photoStamp(row.photo) || ![7,10].includes(old.length))delete progress[row.id];
      else {delete progress[row.id].full;delete progress[row.id].viewed;delete progress[row.id].rounds;delete progress[row.id].viewedScopes;
        if(old[0]!==row.name)delete progress[row.id].name;
        if(old[1]!==row.className)delete progress[row.id].className;
      }
      changed=true;
    }
  }
  if(Object.keys(rawProgress).some(id=>!Object.hasOwn(signatures,id)))changed=true;
  const run=sessionSchema.safeParse(state.session);
  let session=run.success?run.data:null;
  const oldRule=Object.values(oldSignatures).some(value=>{try{return JSON.parse(value)[9]!=="five-fields-v1";}catch{return true;}});
  if(session && ((session.scope==="full"&&oldRule) || changed || session.ids.some(id=>!rows.some(r=>r.id===id && r.readyScopes.includes(session!.scope))) || session.queue.some(id=>!session!.ids.includes(id)) || (session.stage!=="done" && session.index>=(session.stage==="study"?session.ids.length:session.queue.length)))) session=null;
  const history=z.array(z.object({at:z.number().finite(),scope:scopes,results:z.array(answer).max(5)})).max(100).safeParse(state.exams??[]);
  const settings=z.object({className:z.string(),order:z.enum(["random","sequence"]),scope:scopes,density:z.enum(["compact","comfortable"]).default("compact"),orderChosen:z.boolean().default(false),filters:z.unknown().optional()}).safeParse(state.settings);
  const cleanSettings=settings.success?{...settings.data,filters:cleanOverviewFilters(settings.data.filters||{classes:settings.data.className?[settings.data.className]:[]})}:{className:"",order:"sequence" as const,scope:"full" as const,density:"compact" as const,orderChosen:false,filters:cleanOverviewFilters()};
  if(cleanSettings.orderChosen!==true)cleanSettings.order="sequence";
  const studyPlans=cleanStudyPlans(state.studyPlans,rows.map(r=>r.id));
  const activePlanId=typeof state.activePlanId==="string"&&studyPlans.some(p=>p.id===state.activePlanId)?state.activePlanId:"";
  if(session?.planId&&!studyPlans.some(p=>p.id===session!.planId&&JSON.stringify(p.groups[session!.planGroup!-1])===JSON.stringify(session!.ids)))session=null;
  return {studyPlans,activePlanId,progress,signatures,session:restoreRecallSession(session),exams:history.success?history.data:[],settings:cleanSettings,objective:cleanObjective(state.objective,rows.map(r=>r.id))};
}
