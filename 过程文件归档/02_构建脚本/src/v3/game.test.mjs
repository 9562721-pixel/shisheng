import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {newGame,gameCommand,individual,petStats,battle,STAGES,SPECIES,parseGameBackup,beijingDay} from './game-model.js';
import {transactGame,gameBackup,restoreGame} from './game-storage.js';
import {buildQuestions,publicQuiz,objectiveCommand} from './objective.js';
import {sealDataset,annualRows,matchOfficialPhotos} from './annual.js';
import {appendAnnual,selectAnnual,readProgress,saveAnnualProgress} from './annual-storage.js';
import {reconcilePracticeState} from './model.ts';
globalThis.indexedDB=indexedDB;globalThis.window={dispatchEvent(){}};
const cmd=(p,type,more={},opt={})=>gameCommand(p,{type,requestId:crypto.randomUUID(),...more},opt);
const key=n=>n.toString(16).padStart(64,'0');
const time=Date.parse('2026-10-20T15:59:00Z');
test('100 tickets mint once; idempotent draw keeps distinct duplicates, not gold',()=>{const p=newGame();cmd(p,'starter',{species:'agumon'});const c={type:'draw',currency:'tickets',count:10,requestId:'one-batch'};const a=gameCommand(p,c,{random:()=>.5});gameCommand(p,c);assert.equal(a.pets.length,10);assert.equal(p.tickets,90);assert.equal(p.gold,0);assert.equal(p.pets.length,11);assert.equal(new Set(p.pets.map(x=>x.id)).size,11);assert.equal(parseGameBackup(gameBackup(p)).tickets,90);});
test('daily cap, answer/task dedup, next Beijing day, spending never reset quota',()=>{const p=newGame();cmd(p,'reward',{events:Array.from({length:100},(_,n)=>({kind:'answer',key:key(n)}))},{now:time});assert.equal(p.gold,120);cmd(p,'reward',{events:[{kind:'answer',key:key(0)}]},{now:time});assert.equal(p.gold,120);p.gold-=30;cmd(p,'reward',{events:[{kind:'mock',key:key(888)}]},{now:time});assert.equal(p.gold,90);const next=time+120000;assert.notEqual(beijingDay(time),beijingDay(next));cmd(p,'reward',{events:[{kind:'answer',key:key(0)}]},{now:next});assert.equal(p.gold,92);assert.equal(p.daily[beijingDay(next)].earned,2);});
test('same individual evolves with levels and equipment, starter growth stays moderate',()=>{const p=newGame();cmd(p,'starter',{species:'agumon'});p.gold=1000;const v=p.pets[0],identity=v.id;for(let i=0;i<4;i++)cmd(p,'level',{petId:v.id});cmd(p,'evolve',{petId:v.id});assert.equal(v.form,1);assert.equal(v.id,identity);assert.equal(v.level,5);assert.equal(p.gold,880);assert.ok(petStats(v).attack>30);assert.throws(()=>cmd(p,'evolve',{petId:v.id}));});
test('every SSR can clear all 10 release stages at level 1 without study gates or rewards',()=>{for(const species of Object.keys(SPECIES).filter(k=>SPECIES[k].rarity==='SSR')){const p=newGame(),v=individual(species,'test');p.pets=[v];p.activePet=v.id;for(const stage of STAGES){assert.equal(battle(v,[],stage).won,true,species+' stage '+stage.id);cmd(p,'fight',{stageId:stage.id});}assert.equal(p.cleared.length,10);assert.equal(p.gold,0);assert.throws(()=>cmd(p,'fight',{stageId:11}));assert.deepEqual(parseGameBackup(gameBackup(p)).cleared,p.cleared);}});
test('wrong slots and shared equipment are controlled; backup rejects bad and strips student fields',()=>{const p=newGame();cmd(p,'starter',{species:'gabumon'});p.gold=90;cmd(p,'equipment-draw',{}, {random:()=>.5});const g=p.equipment[0],v=p.pets[0];cmd(p,'equip',{petId:v.id,slot:'armor',gearId:g.id});assert.throws(()=>cmd(p,'equip',{petId:v.id,slot:'weapon',gearId:g.id}));const b=gameBackup(p);b.profile.studentName='not allowed';assert.equal(parseGameBackup(b).studentName,undefined);b.profile.tickets=-1;assert.throws(()=>parseGameBackup(b));});
test('uniform fields are not questions; correct options unique and mock answers hidden',()=>{const rows=Array.from({length:6},(_,i)=>({id:String(i),name:'演示'+i,className:'共同班',photo:'data:image/png;base64,QQ==',assessmentAddress:'共同住址',needyLabel:'无',psychLabel:'无'}));const q=buildQuestions(rows,rows.map(x=>x.id),'full');assert.equal(q.questions.length,6);assert.equal(q.facts.length,24);for(const x of q.questions)assert.equal(x.options.length,new Set(x.options).size);assert.ok(publicQuiz({...q,kind:'exam',status:'active'}).questions.every(x=>x.correct===undefined));});
test('real transactions serialize multi-window mint, debit, restore and independent annual operations',async()=>{
 const minted=await Promise.all(Array.from({length:10},()=>transactGame()));assert.ok(minted.every(x=>x.profile.tickets===100));assert.equal(new Set(minted.map(x=>x.profile.id)).size,1);
 await transactGame({type:'starter',species:'agumon',requestId:'choose'});
 await Promise.all(Array.from({length:20},()=>transactGame({type:'draw',count:10,currency:'tickets',requestId:'same-double-click'})));
 assert.equal((await transactGame()).profile.tickets,90);
 const pulls=await Promise.allSettled(Array.from({length:15},(_,i)=>transactGame({type:'draw',count:10,currency:'tickets',requestId:'window-'+i})));
 assert.equal(pulls.filter(x=>x.status==='fulfilled').length,9);
 let p=(await transactGame()).profile;assert.equal(p.tickets,0);assert.equal(p.pets.length,101);
 const backup=gameBackup(p),before=JSON.stringify(p);
 const data='data:image/png;base64,iVBORw0KGgo=';
 const official=Array.from({length:6},(_,i)=>({id:String(202600001+i),name:'虚构学生'+i,className:i%2?'演示一班':'演示二班',assessmentAddress:'演示省'+i,needyLabel:'无',psychLabel:'无',other:'无'}));
 async function dataset(year){return sealDataset({id:crypto.randomUUID(),year,label:year+' 年考核',photoPackage:{name:'fixture.zip'},table:{name:'fixture.xls',sheet:'Sheet1',data:'data:application/vnd.ms-excel;base64,QUJD',sha256:'fixture'},rows:official,photos:matchOfficialPhotos(official,official.map(r=>({key:r.id,path:r.id+'.png',data})))});}
 const a=await dataset('2026'),b=await dataset('2027');await appendAnnual(a);await appendAnnual(b);await selectAnnual(a.id);await saveAnnualProgress(a.id,a.hash,reconcilePracticeState(null,annualRows(a)));const copy={...a,id:crypto.randomUUID(),restoredAt:new Date().toISOString()};await appendAnnual(copy);assert.equal(JSON.stringify((await transactGame()).profile),before);
 const quiz=await objectiveCommand(a,annualRows(a),{action:'start',kind:'learn',scope:'name',ids:official.map(r=>r.id)});
 for(const question of quiz.questions){const correct=question.options.indexOf(official.find(x=>x.id===question.studentId).name);await Promise.all([objectiveCommand(a,annualRows(a),{action:'answer',quizId:quiz.id,questionId:question.id,choice:correct}),objectiveCommand(a,annualRows(a),{action:'answer',quizId:quiz.id,questionId:question.id,choice:correct})]);}
 await Promise.all([objectiveCommand(a,annualRows(a),{action:'submit',quizId:quiz.id}),objectiveCommand(a,annualRows(a),{action:'submit',quizId:quiz.id})]);
 await saveAnnualProgress(a.id,a.hash,{progress:{},studyPlans:[]});assert.equal((await readProgress(a.id)).state.objective.quizzes[0].status,'done');assert.equal((await readProgress(a.id)).state.progress[official[0].id].name.last,'good');
 p=(await transactGame()).profile;assert.equal(p.gold,22);assert.equal(p.practiceCount,1);assert.equal(p.gifts.length,2);assert.ok(!JSON.stringify(gameBackup(p)).includes('虚构学生'));
 const q2=await objectiveCommand(b,annualRows(b),{action:'start',kind:'exam',scope:'name',ids:official.slice(0,5).map(r=>r.id)});for(const q of q2.questions)await objectiveCommand(b,annualRows(b),{action:'answer',quizId:q2.id,questionId:q.id,choice:q.options.indexOf(official.find(x=>x.id===q.studentId).name)});assert.equal((await transactGame()).profile.gold,22);await objectiveCommand(b,annualRows(b),{action:'submit',quizId:q2.id});assert.equal((await transactGame()).profile.gold,32); // same people, other year: answer keys deduplicated
 const rev=(await transactGame()).profile.revision;await restoreGame(backup,rev);p=(await transactGame()).profile;assert.equal(p.gold,backup.profile.gold);assert.equal(p.tickets,0);assert.equal(p.pets.length,101);await assert.rejects(restoreGame(backup,rev),/变化/);assert.ok((await readProgress(a.id)).state.objective.quizzes.length);
});
