import assert from 'node:assert/strict';
import {CombatWorld,MONSTERS} from '../dist/combat.js';
import {EXTRA_MONSTERS} from '../dist/extra-monsters.js';
import {applyColdness} from '../dist/deerclops.js';
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
const frames=(w,n)=>{for(let i=0;i<n;i++)w.step();};
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const make=(type,x=2)=>new CombatWorld({spawns:[{type,count:1,x,z:0}]});
const hpAndFrame={pigman:[250,13],pigguard:[600,13],bunnyman:[200,13],merm:[500,13],mermguard:[200,13],
 beefalo:[1000,15],koalefant_summer:[1000,15],koalefant_winter:[1000,15],spider_warrior:[400,25],
 spider_hider:[225,25],spider_dropper:[400,25],bat:[50,10],frog:[100,25],bee:[100,15],mosquito:[100,15],
 penguin:[150,15],catcoon:[150,16],krampus:[300,18],lightninggoat:[700,12],slurtle:[1200,9]};

test('Catalog adds exactly 20 ordinary creatures and Deerclops without replacing old eight',()=>{
 assert.equal(Object.keys(EXTRA_MONSTERS).length,20);assert.equal(Object.keys(MONSTERS).length,29);
 assert.equal(MONSTERS.deerclops.hp,4000);assert.equal(MONSTERS.hound.hitFrames[0],16);
});
for(const [type,[health,frame]] of Object.entries(hpAndFrame))test(`${type}: source HP and first damage frame ${frame}`,()=>{
 const w=make(type,type==='bee'?1:type==='bat'?1.8:2);assert.equal(w.monsters[0].hp,health);
 frames(w,frame-1);assert.equal(w.stats.hitsTaken,0);w.step();assert.equal(w.stats.hitsTaken,1);
});

test('Pig/guard and merm/guard retreat during their distinct combat cooldowns',()=>{
 for(const type of ['pigman','pigguard','merm','mermguard']){
  const w=make(type,2),m=w.monsters[0];frames(w,40);assert.equal(m._intent,'retreat',type);assert(m.x>2,type);
 }
 assert.equal(MONSTERS.pigguard.cooldown,1.5);assert.equal(MONSTERS.pigman.cooldown,3);
});

test('Warrior and dropper choose ranged leap: f8 motor, f19 hit, then taunt; cooldown per entity is 4–6s',()=>{
 for(const type of ['spider_warrior','spider_dropper']){
  const w=make(type,6),m=w.monsters[0];frames(w,8);assert.equal(m.animation,'warrior_atk');near(m.x,6);
  assert(m._cooldown>=4&&m._cooldown<6);w.step();assert(m.x<6);frames(w,9);assert.equal(w.stats.hitsTaken,0);
  w.step();assert.equal(w.stats.hitsTaken,1);frames(w,10);assert.equal(m.state,'taunt');
 }
});

test('Cave spider shields only above 50 damage, absorbs 75%, and needs 3 seconds without hits',()=>{
 const w=make('spider_hider',12),m=w.monsters[0];w._damage(m,50,w.player);w.step();assert.notEqual(m.state,'shield');
 w._damage(m,1,w.player);frames(w,4);assert.equal(m.state,'shield');const hp=m.hp;
 w._damage(m,40,w.player);near(m.hp,hp-10);assert.equal(m.animation,'hit_shield');frames(w,89);assert.equal(m.state,'shield');
 frames(w,6);assert.equal(m.state,'shield_end');frames(w,18);assert.notEqual(m.state,'shield');
});

test('Slurtle uses 150 threshold and 95% shell absorption; electric stun breaks hiding',()=>{
 const w=make('slurtle',12),m=w.monsters[0];w._damage(m,151,w.player);w.step();assert.equal(m.state,'shield');
 const hp=m.hp;w._damage(m,100,w.player);near(m.hp,hp-5);
 w._damage(m,20,w.player,{electric:true});assert.equal(m.state,'electrocute');
 const after=m.hp;w._damage(m,100,w.player);near(m.hp,after-100);
});

test('Bunnyman retreats below 33.3% health and regenerates at native 5-second ticks',()=>{
 const w=make('bunnyman',7),m=w.monsters[0];m.hp=60;w.step();assert.equal(m._intent,'flee');
 frames(w,149);assert(m.x>7);near(m.hp,60+200/120*5);
});

test('Living merms are inherently wet and receive the spear wet multiplier',()=>{
 for(const type of ['merm','mermguard']){
  const w=make(type,2),m=w.monsters[0];m.nextBrainAt=1e9;w.setWeapon('spear_wathgrithr_lightning');
  w.requestAttack(m.id);frames(w,8);near(m.maxHp-m.hp,59.5*1.25*1.5);assert.equal(m.state,'electrocute');
 }
});

test('Worker bee retreat radius differs from killer bee',()=>{
 assert.equal(MONSTERS.bee.dodgeStart,6);assert.equal(MONSTERS.bee.dodgeStop,10);
 assert.equal(MONSTERS.killerbee.dodgeStart,3);assert.equal(MONSTERS.killerbee.dodgeStop,6);
});

test('Penguin sliding attack hits on frame 1; stationary peck hits on frame 15',()=>{
 const w=make('penguin',6),m=w.monsters[0];
 for(let i=0;i<90&&w.stats.hitsTaken===0;i++)w.step();
 assert.equal(w.stats.hitsTaken,1);assert.equal(m._attackMotion,'penguin');
 const events=w.consumeEvents(),attack=events.find(e=>e.type==='attack'&&e.id===m.id),hit=events.find(e=>e.type==='hit'&&e.id==='player');
 near(hit.time-attack.time,1/30);
});

test('Catcoon uses 16f swipe nearby and moving 19f pounce beyond 3 units',()=>{
 const w=make('catcoon',4.2),m=w.monsters[0];frames(w,6);assert.equal(m.animation,'jump_atk');near(m.x,4.2);
 w.step();assert(m.x<4.2);frames(w,11);assert.equal(w.stats.hitsTaken,0);w.step();assert.equal(w.stats.hitsTaken,1);
});

test('Frog movement advances only in hopping frames 5–20',()=>{
 const w=make('frog',12),m=w.monsters[0];frames(w,5);near(m.x,12);w.step();assert(m.x<12);
});

test('Mosquito fourth drink bursts at f11 with native 34 damage in radius 3.5',()=>{
 const w=make('mosquito',1.5),m=w.monsters[0];
 for(let count=0;count<4;count++){
  m.x=1.5;m.z=0;m.nextAttackAt=w.time;m.nextBrainAt=w.time;w._idle(m);frames(w,15);
  if(count<3)assert.equal(m.renderVariant,`drink${count+2}`);
 }
 assert.equal(m.drinks,5);assert.equal(m.dead,true);assert.equal(m.animation,'explode');assert.equal(w.status,'running');
 const hp=w.player.hp;frames(w,10);near(w.player.hp,hp);w.step();near(w.player.hp,hp-34*0.75);assert.equal(w.status,'won');
});

test('Electric hit charges goat, later melee is reflected, and player shock blocks inputs',()=>{
 const w=make('lightninggoat',2),m=w.monsters[0];m.nextBrainAt=1e9;
 w._damage(m,20,w.player,{electric:true});assert.equal(m.charged,true);assert.equal(m.renderVariant,'charged');assert.equal(m.state,'shocked');near(w.player.hp,200);
 w._damage(m,20,w.player);near(w.player.hp,200-25*1.5*0.75);assert.equal(w.player.state,'electrocute');
 assert.equal(w.useSlot(1),false);assert.equal(w.requestDash(5,0),false);frames(w,20);assert.equal(w.useSlot(1),true);
});

test('Deerclops integration schedules ice at 31f and first damage at 34f, one hit per swing',()=>{
 const w=make('deerclops',6);frames(w,30);assert.equal(w.hazards.length,0);w.step();assert(w.hazards.length>=20);
 frames(w,2);assert.equal(w.stats.hitsTaken,0);w.step();assert.equal(w.stats.hitsTaken,1);near(w.player.hp,200-75*0.75);
 frames(w,15);assert.equal(w.stats.hitsTaken,1);assert.equal(w.player.coldness,2);
});

test('Frozen player cannot move, swap, dash or pick up; damage breaks freeze using native recovery',()=>{
 const w=make('deerclops',15),m=w.monsters[0];m.nextBrainAt=1e9;
 w.clickSlot(1);const dropped=w.dropActiveItem(8,0);w.requestPickup(dropped.id);w.step();
 applyColdness(w,w.player,4,m);assert.equal(w.player.state,'frozen');assert.equal(w._pickupId,null);
 const frozenX=w.player.x;
 assert.equal(w.useSlot(1),false);assert.equal(w.clickHand(),false);assert.equal(w.requestPickup(),false);assert.equal(w.requestDash(6,0),false);
 w.setMove(1,0);frames(w,10);near(w.player.x,frozenX);w._damage(w.player,1,m);assert.equal(w.player.state,'hit');near(w.player._stateDuration,10/30);
});

let failed=0;for(const[name,run]of tests){try{run();console.log(`PASS ${name}`);}catch(e){failed++;console.error(`FAIL ${name}\n${e.stack}`);}}
console.log(`${tests.length-failed}/${tests.length} expanded creature checks passed`);if(failed)process.exitCode=1;
