// Presentation reads settled results only. It never issues game commands or rewards.
export function summarizePulls(pulls=[]){
  const grouped=new Map();
  for(const pull of pulls){const key=pull.pet.species;let group=grouped.get(key);if(!group){group={species:key,count:0,first:pull,last:pull,isNew:pull.isNew};grouped.set(key,group);}group.count++;group.last=pull;group.isNew||=pull.isNew;}
  return [...grouped.values()].map(g=>({...g,starsBefore:g.first.starsBefore,starsAfter:g.last.starsAfter,starUp:g.last.starsAfter>Math.max(1,g.first.starsBefore)}));
}
export function battleFrame(report,stage,count){
  let hp=report.stats.hp,enemyHP=stage.hp;
  const shown=Math.max(0,Math.min(report.log.length,count));
  for(const event of report.log.slice(0,shown)){if(event.side==='pet')enemyHP=event.hp;else hp=event.hp;}
  return {hp,enemyHP,shown,event:report.log[shown-1]||null,petRatio:Math.max(0,Math.min(1,hp/report.stats.hp)),enemyRatio:Math.max(0,Math.min(1,enemyHP/stage.hp))};
}
export function battleSteps(report,maxFrames=24){
  const stride=Math.max(1,Math.ceil(report.log.length/maxFrames)),steps=[];
  for(let count=1;count<=report.log.length;count+=stride)steps.push(count);
  if(steps.at(-1)!==report.log.length)steps.push(report.log.length);
  return steps;
}
// Cancellable and dependency-free: closing, skipping or detaching cannot leave timers running.
export class PresentationClock{
  constructor(schedule=(callback,delay)=>setTimeout(callback,delay),cancel=timer=>clearTimeout(timer)){this.schedule=schedule;this.cancelTimer=cancel;this.token=0;this.running=false;}
  stop(){this.token++;this.running=false;if(this.timer!==undefined)this.cancelTimer(this.timer);this.timer=undefined;}
  play(steps,onStep,onDone,delay=420){this.stop();const token=this.token;let index=0;this.running=true;const tick=()=>{if(token!==this.token)return;if(index>=steps.length){this.running=false;onDone();return;}onStep(steps[index++]);if(token!==this.token)return;this.timer=this.schedule(tick,typeof delay==='function'?delay():delay);};this.timer=this.schedule(tick,100);}
}
