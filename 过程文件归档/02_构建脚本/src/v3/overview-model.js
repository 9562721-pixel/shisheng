// Derived filters only: never write derived geography into the locked source dataset.
export const PROVINCE_NAMES=['北京市','天津市','河北省','山西省','内蒙古自治区','辽宁省','吉林省','黑龙江省','上海市','江苏省','浙江省','安徽省','福建省','江西省','山东省','河南省','湖北省','湖南省','广东省','广西壮族自治区','海南省','重庆市','四川省','贵州省','云南省','西藏自治区','陕西省','甘肃省','青海省','宁夏回族自治区','新疆维吾尔自治区','台湾省','香港特别行政区','澳门特别行政区'];
export const UNKNOWN_PROVINCE='省份未识别';
export const STUDY_FIELDS=[['name','姓名'],['className','班级'],['assessmentAddress','家庭住址'],['needyLabel','是否贫困生'],['psychLabel','心理情况']];
export function provinceOf(address){
  const value=String(address??'').replace(/\s/g,'').replace(/^(中华人民共和国|中国)/,'');
  for(const p of PROVINCE_NAMES)if(value.startsWith(p))return p;
  for(const p of PROVINCE_NAMES){const short=p.replace(/特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市$/g,'');if(value.startsWith(short)){const rest=value.slice(short.length);if(!/^(区|县|路|街|州|镇|乡|藏族|蒙古族)/.test(rest))return p;}}
  return UNKNOWN_PROVINCE;
}
export function cleanOverviewFilters(input={}){
  const list=k=>Array.isArray(input[k])?[...new Set(input[k].filter(v=>typeof v==='string'&&v.length<=200))].slice(0,100):[];
  return {classes:list('classes'),provinces:list('provinces'),provinceMode:input.provinceMode==='exclude'?'exclude':'include',needyLabels:list('needyLabels'),psychLabels:list('psychLabels'),photo:['all','available','missing'].includes(input.photo)?input.photo:'all',query:typeof input.query==='string'?input.query.slice(0,200):''};
}
export function filterOverview(rows,input={},omit=''){
  const f=cleanOverviewFilters(input);
  return rows.filter(r=>{
    if(omit!=='classes'&&f.classes.length&&!f.classes.includes(r.className))return false;
    if(omit!=='provinces'&&f.provinces.length){const has=f.provinces.includes(provinceOf(r.assessmentAddress));if(f.provinceMode==='exclude'?has:!has)return false;}
    if(omit!=='needyLabels'&&f.needyLabels.length&&!f.needyLabels.includes(r.needyLabel))return false;
    if(omit!=='psychLabels'&&f.psychLabels.length&&!f.psychLabels.includes(r.psychLabel))return false;
    if(f.photo==='available'&&!r.photo||f.photo==='missing'&&r.photo)return false;
    if(f.query.trim()&&!`${r.name} ${r.className} ${r.assessmentAddress}`.toLowerCase().includes(f.query.trim().toLowerCase()))return false;
    return true;
  });
}
export function facetOptions(rows,input,key){
  const value=r=>key==='classes'?r.className:key==='provinces'?provinceOf(r.assessmentAddress):key==='needyLabels'?r.needyLabel:r.psychLabel;
  const counts=new Map();for(const r of filterOverview(rows,input,key)){const v=value(r);counts.set(v,(counts.get(v)||0)+1);}
  const total=new Map();for(const r of rows){const v=value(r);total.set(v,(total.get(v)||0)+1);}
  return [...total.keys()].sort((a,b)=>(total.get(b)||0)-(total.get(a)||0)||a.localeCompare(b,'zh')).map(v=>({value:v,count:counts.get(v)||0}));
}
export function filterDescription(input){
  const f=cleanOverviewFilters(input),parts=[];
  if(f.classes.length)parts.push('班级：'+f.classes.join('、'));
  if(f.provinces.length)parts.push((f.provinceMode==='exclude'?'排除省份：':'只看省份：')+f.provinces.join('、'));
  if(f.needyLabels.length)parts.push('贫困情况：'+f.needyLabels.join('、'));
  if(f.psychLabels.length)parts.push('心理情况：'+f.psychLabels.join('、'));
  if(f.photo!=='all')parts.push(f.photo==='available'?'有照片':'缺照片');
  if(f.query.trim())parts.push('检索：'+f.query.trim());
  return parts.join('；')||'全部考核学生';
}
