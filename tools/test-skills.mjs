import assert from 'node:assert/strict';
import { CombatWorld, DASH } from '../dist/combat.js';
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);
const frames=(w,n)=>{for(let i=0;i<n;i++)w.step();};
const freeze=m=>{m.nextBrainAt=1e9;m.nextAttackAt=1e9;if(m.type==='tentacle')m._retargetAt=1e9;};
function make(type='leif',x=20,options={}) {
  const w=new CombatWorld({spawns:[{type,count:1,x,z:0}],...options});
  return w;
}
function readyDash(spawns=[{type:'leif',count:1,x:20,z:0}],damage=59.5) {
  const w=new CombatWorld({weapon:'spear_wathgrithr_lightning',damage,spawns});
  w.monsters.forEach(freeze);frames(w,90);return w;
}
function tentacleLoop() {
  const w=make('tentacle',3);w.monsters[0]._retargetAt=0;frames(w,48);return w;
}

test('Spear cannot dash; lightning equip waits 3 seconds and aim is fixed 6.5 units',()=>{
  const ordinary=make();assert.equal(ordinary.requestDash(10,0),false);
  const w=make('leif',20,{weapon:'spear_wathgrithr_lightning'});freeze(w.monsters[0]);
  assert.equal(w.dashRemaining,3);assert.equal(w.requestDash(10,0),false);
  frames(w,90);assert.equal(w.dashReady,true);
  assert.deepEqual(w.getDashTarget(0.1,0),{x:6.5,z:0,valid:true});
  assert.equal(w.requestDash(0,0),false);
  assert.equal(w.requestDash(0.1,0),true);assert.equal(w.requestDash(10,0),false);
  frames(w,11);assert.equal(w.player.x,0);assert.equal(w.player.state,'dash_pre');
  w.step();assert.equal(w.player.x,6.5);assert.equal(w.player.state,'dash_recover');
  assert.equal(w.dashRemaining,3);
  frames(w,16);assert.equal(w.player.state,'dash_recover');w.step();assert.equal(w.player.state,'idle');
  assert.equal(w.dashReady,false);frames(w,73);assert.equal(w.dashReady,true);
});

test('Dash damages the swept segment and rounded endpoint exactly once with fixed 68 base',()=>{
  const w=readyDash([{type:'leif',count:1,x:2,z:0},{type:'leif',count:1,x:5,z:1.49},
    {type:'leif',count:1,x:7.9,z:0},{type:'leif',count:1,x:4,z:1.51}],1);
  w.requestDash(10,0);frames(w,12);
  assert.deepEqual(w.monsters.map(m=>m.maxHp-m.hp),[85,85,85,0]);
  assert.equal(w.stats.hits,3);assert.equal(w.stats.damageDealt,255);
  const hits=w.consumeEvents().filter(e=>e.type==='hit');
  assert.equal(new Set(hits.map(e=>e.targetId)).size,3);
  assert(hits.every(e=>e.skill==='dash'&&e.electric));
});

test('Wet dash damage, shared electric resistance, and underground immunity to shock',()=>{
  const w=readyDash([{type:'tentacle',count:1,x:3,z:0}]);const m=w.monsters[0];
  w.requestDash(10,0);frames(w,12);
  assert.equal(m.hp,500-68*1.25*1.5);assert.equal(m.state,'hit'); // Underground is noelectrocute.
  const other=readyDash([{type:'hound',count:1,x:3,z:0}]);
  other.requestDash(10,0);frames(other,12);
  assert.equal(other.monsters[0].state,'electrocute');
  frames(other,24);assert.equal(other.monsters[0].state,'electrocute_pst');
  frames(other,9);assert.equal(other.monsters[0].state,'idle');
  const until=other.monsters[0]._electrocuteUntil;
  other._damage(other.monsters[0],1,other.player,{electric:true});
  assert.equal(other.monsters[0]._electrocuteUntil,until);
  assert.notEqual(other.monsters[0].state,'electrocute');
});

test('Dash windup resists interruption but still takes damage; recovery is interruptible',()=>{
  const w=readyDash();w.requestDash(10,0);
  w._damage(w.player,20,w.monsters[0]);assert.equal(w.player.hp,185);assert.equal(w.player.state,'dash_pre');
  frames(w,12);w._damage(w.player,20,w.monsters[0]);
  assert.equal(w.player.hp,170);assert.equal(w.player.state,'hit');assert.equal(w.player.x,6.5);
  assert(w.consumeEvents().some(e=>e.type==='dashend'&&e.interrupted));
});

test('Pause and round reset preserve intended dash clock semantics',()=>{
  const w=readyDash();w.requestDash(10,0);w.paused=true;frames(w,40);assert.equal(w.player.x,0);
  w.paused=false;frames(w,12);assert.equal(w.player.x,6.5);
  w.reset({weapon:'spear_wathgrithr_lightning',spawns:[{type:'leif',x:20}]});assert.equal(w.dashRemaining,3);
  w.setWeapon('spear');assert.equal(w.dashReady,false);
});

test('Tentacle can retain a target at 5 units while warning, without attacking out of range',()=>{
  const w=make('tentacle',3),m=w.monsters[0];m._retargetAt=0;w.step();assert.equal(m.state,'emerge');
  w.player.x=-2;frames(w,90);assert.equal(m.state,'emerge');assert.equal(w.stats.hitsTaken,0);
  w.player.x=0;w.step();assert.equal(m.state,'attack_pre');assert.equal(m.healthVisible,true);
});

test('Tentacle frame 18 ends attack protection; a hit causes direct counterattack',()=>{
  const w=tentacleLoop(),m=w.monsters[0];frames(w,17);
  w._damage(m,1,w.player);assert.equal(m.state,'attack');
  w.step();assert.equal(m.attackActive,false);
  w._damage(m,1,w.player);assert.equal(m.state,'hit');
  frames(w,17);assert.equal(m.state,'attack');assert.equal(m.stateTime,0);
  const count=w.stats.hitsTaken;frames(w,7);assert.equal(w.stats.hitsTaken,count+1);
});

test('Tentacle loses distant target at keep-target check and retracts after queued attack',()=>{
  const w=tentacleLoop(),m=w.monsters[0];w.player.x=-10;
  frames(w,52);assert.equal(m.targetId,null);assert.equal(m.state,'retract');
  frames(w,43);assert.equal(m.state,'idle');assert.equal(m.healthVisible,false);
});

test('Hitting an unacquired tentacle does not fabricate a combat target',()=>{
  const w=make('tentacle',3),m=w.monsters[0];m._retargetAt=1000;
  w._damage(m,1,w.player);assert.equal(m.targetId,null);assert.equal(m.state,'hit');
  frames(w,17);assert.equal(m.state,'attack');assert.equal(m.targetId,null);
  frames(w,17);assert.equal(w.stats.hitsTaken,0);
  assert(w.consumeEvents().some(e=>e.type==='miss'&&e.targetId===null));
});

test('Dry ordinary lightning attacks have no shock; all eight exposed creature graphs support electric reaction',()=>{
  const dry=make('hound',2,{weapon:'spear_wathgrithr_lightning'});freeze(dry.monsters[0]);
  dry.requestAttack(dry.monsters[0].id);frames(dry,8);assert.equal(dry.monsters[0].state,'hit');
  assert.equal(dry.consumeEvents().find(e=>e.type==='hit').electric,false);
  for(const type of ['spider','hound','tallbird','leif','tentacle','killerbee','knight','werepig']) {
    const w=make(type,3),m=w.monsters[0];
    if(type==='tentacle'){m.targetId='player';w._startTentacleLoop(m);}
    w._damage(m,1,w.player,{electric:true,skill:'dash'});assert.equal(m.state,'electrocute',type);
  }
});

test('Tentacle acquisition has seeded periodic delay and idle rumble ground animations',()=>{
  const w=make('tentacle',12),m=w.monsters[0];
  assert(m._retargetPeriod>=1.5&&m._retargetPeriod<=2.5);
  m._groundTimeout=0;w.step();assert.equal(m.state,'rumble');assert.equal(m.animation,'ground_pre');
  frames(w,13);assert.equal(m.animation,'ground_loop');assert.equal(m.healthVisible,false);
});

test('Killer bee has short 0.6 range, hits at 15f, then retreats on cooldown',()=>{
  const w=make('killerbee',1.05),m=w.monsters[0];frames(w,14);assert.equal(w.stats.hitsTaken,0);
  w.step();assert.equal(w.stats.hitsTaken,1);assert.equal(w.player.hp,192.5);
  frames(w,20);assert.equal(m.state,'move');assert.equal(m._intent,'retreat');assert(m.x>1.05);
});

test('Knight uses 2.5 start / 2.75 hit ranges and 14f hit; hops only on walk frames 7–19',()=>{
  const w=make('knight',2.9),m=w.monsters[0];frames(w,13);assert.equal(w.stats.hitsTaken,0);
  w.step();assert.equal(w.stats.hitsTaken,1);frames(w,18);assert.equal(m._intent,'retreat');
  const x=m.x;frames(w,7);assert.equal(m.x,x);frames(w,10);assert(m.x>x);
});

test('Werepig lunge moves before frame-16 hit and has a late interruptible recovery',()=>{
  const w=make('werepig',3.4),m=w.monsters[0];m._newTarget=false;
  frames(w,15);assert.equal(w.stats.hitsTaken,0);assert(m.x<2);
  w.step();assert.equal(w.stats.hitsTaken,1);
  w._damage(m,1,w.player);assert.equal(m.state,'attack');
  frames(w,10);w._damage(m,1,w.player);assert.equal(m.state,'hit');
});

test('Knight electrocution enters its dedicated toppled recovery rather than ordinary idle',()=>{
  const w=readyDash([{type:'knight',count:1,x:3,z:0}]),m=w.monsters[0];
  w.requestDash(10,0);frames(w,12);assert.equal(m.state,'electrocute');
  frames(w,24);assert.equal(m.state,'shock_to_stun');frames(w,15);assert.equal(m.state,'stun_loop');
  frames(w,28);assert.equal(m.state,'stun_pst');frames(w,38);assert.equal(m.state,'idle');
});

let failed=0;
for(const [name,run] of tests){try{run();console.log(`PASS ${name}`);}catch(e){failed++;console.error(`FAIL ${name}\n${e.stack}`);}}
console.log(`${tests.length-failed}/${tests.length} skill and creature checks passed`);
if(failed)process.exitCode=1;
