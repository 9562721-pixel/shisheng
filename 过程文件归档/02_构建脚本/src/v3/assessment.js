import * as XLSX from 'xlsx';
export const HEADERS=['学号','姓名','班级','家庭住址','是否贫困生','心理情况','其他'];
const clean=value=>String(value??'').trim();
export const identityStamp=s=>JSON.stringify([s.id,s.name,s.className]);
export function parseAssessmentRows(rows,sheetName=''){
  const index=rows.findIndex(r=>HEADERS.every(h=>r.some(c=>clean(c).replace(/\s/g,'')===h)));
  if(index<0)throw Error('未找到完整表头：'+HEADERS.join('、'));
  const columns=HEADERS.map(h=>rows[index].findIndex(c=>clean(c).replace(/\s/g,'')===h));
  const records=[],invalid=[];
  rows.slice(index+1).forEach((r,i)=>{
    if(!r.some(v=>clean(v)))return;
    const values=columns.map(c=>clean(r[c]));
    const [id,name,classValue,address,poverty,psych,other]=values;
    if(!/^\d{8,12}$/.test(id)||!name){invalid.push({line:index+i+2,reason:'学号或姓名缺失／格式无效'});return;}
    if(values.some(v=>v.length>2000)){invalid.push({line:index+i+2,reason:'单个项目超过 2000 字，请核对后重试'});return;}
    records.push({id,name,className:classValue||'无',assessmentAddress:address||'无',needyLabel:poverty||'无',psychLabel:psych||'无',other:other||'无',line:index+i+2,sheetName});
  });
  const counts=new Map();for(const r of records)counts.set(r.id,(counts.get(r.id)||0)+1);
  const duplicates=records.filter(r=>counts.get(r.id)>1);
  const usable=records.filter(r=>counts.get(r.id)===1);
  if(records.length>20000)throw Error('单次最多导入 20000 条，请按老师负责范围拆分。');
  return {records:usable,duplicates,invalid,total:records.length+invalid.length,sheetName};
}
export function readAssessmentWorkbook(bytes){
  const workbook=XLSX.read(bytes,{type:'array'});const sheets=[];
  for(const name of workbook.SheetNames){const sheet=workbook.Sheets[name];if(!sheet['!ref'])continue;const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false});try{sheets.push(parseAssessmentRows(rows,name));}catch(e){if(String(e.message).startsWith('单次最多'))throw e;}}
  if(!sheets.length)throw Error('请选择含“学号、姓名、班级、家庭住址、是否贫困生、心理情况、其他”七列表头的考核信息表。');
  return sheets;
}
export function assessMatches(parsed,students,isDemo=false){
  const master=isDemo?[]:students;const matched=[],missing=[],conflicts=[];
  for(const row of parsed.records){const s=master.find(s=>s.id===row.id);if(!s){missing.push(row);continue;}if(s.name.replace(/\s/g,'')!==row.name.replace(/\s/g,'')||s.className.trim()&&s.className!=='未分班'&&s.className.trim()!==row.className.trim()){conflicts.push({...row,reason:'同学号的姓名或班级与当前名册不一致'});continue;}matched.push(row);}
  return {matched,missing,conflicts};
}
export function minimalStudent(row){
  const keys=['ethnicity','college','major','statusChange','phone1','phone2','familyPhone','emergencyRelation','emergencyName','emergencyPhone','counselor','building','room','bed','birthday','politics','idNumber','psych','loan','address','bank','bankCard'];
  return {...Object.fromEntries(keys.map(k=>[k,''])),id:row.id,name:row.name,className:row.className,enrollYear:0,status:'待核实',gender:'未填写',roles:[],aid:[],ledgerFields:{姓名:row.name,学号:row.id,班级:row.className}};
}
export function assessmentTerms(row,student,source){
  return {hometown:'',assessmentAddress:row.assessmentAddress,needyLabel:row.needyLabel,psychLabel:row.psychLabel,other:row.other,definition:'assessment-v1',identityStamp:identityStamp(student),sourceStamp:'assessment-v1',source,importedAt:new Date().toISOString()};
}
