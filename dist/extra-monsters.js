/** DST build 762172: engaged, unarmoured combat variants. See tools/COMBAT_CATALOG.md. */
const DT=1/30, EPS=1e-8;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const define=(id,name,hp,damage,speed,hitFrame,cooldown,options={})=>Object.freeze({
  id,name,hp,damage,speed,radius:0.5,mass:50,attackRange:3,hitRange:3,
  hitFrames:[hitFrame],cooldown,attackClips:['atk'],movePre:'run_pre',moveClip:'run_loop',
  idleClip:'idle_loop',hitClip:'hit',hitRecovery:0.75,healthOffset:160,extra:true,...options,
});
export const EXTRA_MONSTERS=Object.freeze({
  pigman:define('pigman','猪人',250,33,5,13,3,{dodgeStart:5,dodgeStop:8,releaseFrame:13,maxStunLocks:2}),
  pigguard:define('pigguard','猪人守卫',600,33,5,13,1.5,{dodgeStart:5,dodgeStop:8,releaseFrame:13,maxStunLocks:2}),
  bunnyman:define('bunnyman','兔人',200,40,6,13,2,{releaseFrame:13,maxStunLocks:2,fleeThreshold:0.333,fleeStop:30,moveMode:'bunny',regenPeriod:5,regenAmount:200/120*5}),
  merm:define('merm','鱼人',500,30,8,13,3,{wet:true,regenPeriod:10,regenAmount:5000/960,dodgeStart:5,dodgeStop:8,maxStunLocks:2,attackFromHit:true}),
  mermguard:define('mermguard','鱼人守卫',200,20,8,13,3,{wet:true,regenPeriod:10,regenAmount:5000/960,dodgeStart:5,dodgeStop:8,maxStunLocks:2,attackFromHit:true,royal:false}),
  beefalo:define('beefalo','皮弗娄牛',1000,34,7,15,4,{regenPeriod:10,regenAmount:1000/1440*10,mass:100,attackClips:['atk_pre','atk'],hitPolicy:'outsideAttack',attackFromHit:true}),
  koalefant_summer:define('koalefant_summer','夏象',1000,50,7,15,4,{mass:100,radius:0.75,attackClips:['atk_pre','atk'],hitPolicy:'outsideAttack',attackFromHit:true}),
  koalefant_winter:define('koalefant_winter','冬象',1000,50,7,15,4,{mass:100,radius:0.75,attackClips:['atk_pre','atk'],hitPolicy:'outsideAttack',attackFromHit:true}),
  spider_warrior:define('spider_warrior','蜘蛛战士',400,20,5,25,4,{mass:10,attackRange:6,hitRange:3,movePre:'walk_pre',moveClip:'walk_loop',idleClip:'idle',moveMode:'spider',warrior:true,hitPolicy:'warrior',attackFromHit:true,healthOffset:110}),
  spider_hider:define('spider_hider','洞穴蜘蛛',225,20,5,25,3,{mass:10,movePre:'walk_pre',moveClip:'walk_loop',idleClip:'idle',moveMode:'spider',hitPolicy:'always',shieldThreshold:50,shieldAbsorb:0.75,shieldTime:3,shieldExit:'unhide',healthOffset:110}),
  spider_dropper:define('spider_dropper','垂悬蜘蛛',400,20,5,25,4,{mass:10,attackRange:6,hitRange:3,movePre:'walk_pre',moveClip:'walk_loop',idleClip:'idle',moveMode:'spider',warrior:true,hitPolicy:'warrior',attackFromHit:true,healthOffset:110}),
  bat:define('bat','蝙蝠',50,20,8,10,1,{mass:1,flying:true,collisionless:true,attackRange:1.5,hitRange:1,hitArc:120,movePre:'fly_loop',moveClip:'fly_loop',idleClip:'fly_loop',attackMotion:'bat',releaseFrame:15,attackFromHit:10,hitRelease:9,healthOffset:110}),
  frog:define('frog','青蛙',100,10,8,25,1,{mass:1,radius:0.3,attackClips:['atk_pre','atk'],movePre:null,moveClip:'jump',moveMode:'frog',idleClip:'idle',hitPolicy:'outsideAttackCooldown',healthOffset:75}),
  bee:define('bee','蜜蜂',100,10,4,15,2,{mass:1,flying:true,attackRange:0.6,hitRange:0.6,movePre:'walk_pre',moveClip:'walk_loop',idleClip:'idle_angry',hitPolicy:'always',dodgeStart:6,dodgeStop:10,healthOffset:90}),
  mosquito:define('mosquito','蚊子',100,3,8,15,7,{mass:1,flying:true,attackRange:1.75,hitRange:1.75,movePre:null,moveClip:'walk_loop',idleClip:'walk_loop',hitPolicy:'always',dodgeStart:4,dodgeStop:8,healthOffset:110}),
  penguin:define('penguin','企鸥',150,33,6,15,3,{attackRange:2.5,hitRange:2.5,attackClips:['atk_pre','atk'],movePre:'slide_bounce',moveClip:'slide_loop',idleClip:'idle_loop',attackFromHit:true,interruptAttack:true,moveMode:'penguin',healthOffset:115}),
  catcoon:define('catcoon','浣猫',150,25,3,16,2,{mass:1,attackRange:4,hitRange:4,movePre:'walk_pre',moveClip:'walk_loop',moveMode:'cat',pounce:true,attackFromHit:true,healthOffset:115}),
  krampus:define('krampus','坎普斯',300,50,7,18,1.2,{mass:10,attackClips:['atk_pre','atk'],idleClip:'idle',interruptAttack:true,attackFromHit:true,healthOffset:170}),
  lightninggoat:define('lightninggoat','伏特羊',700,25,4,12,2,{mass:100,movePre:'walk_pre',moveClip:'walk',moveMode:'goat',attackFromHit:true,attackTagEnd:15,healthOffset:180}),
  slurtle:define('slurtle','蜗牛',1200,25,3,9,4,{attackRange:2.5,hitRange:2.5,movePre:'walk_pre',moveClip:'walk_loop',moveMode:'slurtle',idleClip:'idle',hitClip:'hit_out',attackFromHit:true,shieldThreshold:150,shieldAbsorb:0.95,shieldTime:2,shieldExit:'emerge',healthOffset:115}),
});
// Populated from the same extracted animation metadata as the viewer. External
// duration injection remains authoritative; these are offline-test fallbacks.
export const EXTRA_ANIMATION_FRAMES={"pigman":{"ta":3,"idle_loop":16,"idle_creepy":55,"idle_happy":33,"idle_angry":48,"idle_scared":41,"walk_pre":6,"walk_loop":20,"walk_pst":5,"run_pre":6,"run_loop":16,"run_pst":6,"frozen":4,"frozen_loop_pst":6,"shock_loop":6,"shock_pst":8,"pig_pickup":25,"pig_take":26,"pig_reject":35,"eat":47,"hit":14,"sleep_pre":20,"sleep_loop":61,"sleep_pst":32,"transform_pig_were":116,"hungry":64,"abandon":42,"death":31,"corpse":2,"corpse_hit":11,"atk":32,"TA_1":3,"TA_object_1":4,"idle_object_loop":17,"run_object_pre":6,"run_object_loop":16,"run_object_pst":7,"atk_object":21,"pick":22,"slide":29,"smacked":39,"sit":19,"sit_idle":45,"getup":18,"transform_to_king_pre":63,"buff":44,"debuff":49},"pigguard":{"ta":3,"idle_loop":16,"idle_creepy":55,"idle_happy":33,"idle_angry":48,"idle_scared":41,"walk_pre":6,"walk_loop":20,"walk_pst":5,"run_pre":6,"run_loop":16,"run_pst":6,"frozen":4,"frozen_loop_pst":6,"shock_loop":6,"shock_pst":8,"pig_pickup":25,"pig_take":26,"pig_reject":35,"eat":47,"hit":14,"sleep_pre":20,"sleep_loop":61,"sleep_pst":32,"transform_pig_were":116,"hungry":64,"abandon":42,"death":31,"corpse":2,"corpse_hit":11,"atk":32,"TA_1":3,"TA_object_1":4,"idle_object_loop":17,"run_object_pre":6,"run_object_loop":16,"run_object_pst":7,"atk_object":21,"pick":22,"slide":29,"smacked":39,"sit":19,"sit_idle":45,"getup":18,"transform_to_king_pre":63,"buff":44,"debuff":49},"bunnyman":{"idle_loop":16,"idle_angry":49,"frozen":4,"frozen_loop_pst":6,"walk_pre":4,"walk_loop":15,"walk_pst":4,"run_pre":3,"run_loop":10,"run_pst":3,"alert_pre":5,"alert_loop":44,"alert_pst":5,"idle_happy":59,"idle_creepy":54,"idle_earrub":45,"shock_loop":6,"shock_pst":8,"pig_pickup":26,"pig_take":27,"pig_reject":35,"eat":48,"hit":10,"sleep_pre":20,"sleep_loop":61,"sleep_pst":32,"hungry":64,"abandon":42,"death":31,"corpse":2,"corpse_hit":12,"trans_beard_pre":9,"trans_rabbit_pst":17,"dance":67,"disgust":35,"hit_big":16,"spawn_pre":9,"spawn_loop":17,"spawn_pst":57,"despawn":54,"knockback":39,"atk":34,"atk_object":20,"atk_object_pre":8,"idle_loop_overhead":11,"walk_overhead_pre":4,"walk_overhead_loop":15,"walk_overhead_pst":5},"merm":{"ta":3,"idle_loop":16,"idle_creepy":55,"idle_happy":33,"idle_angry":48,"idle_scared":41,"walk_pre":6,"walk_loop":20,"walk_pst":5,"run_pre":6,"run_loop":16,"run_pst":6,"frozen":4,"frozen_loop_pst":6,"shock_loop":6,"shock_pst":8,"pig_pickup":25,"pig_take":26,"pig_reject":35,"eat":47,"hit":14,"sleep_pre":20,"sleep_loop":61,"sleep_pst":32,"transform_pig_were":116,"hungry":64,"abandon":42,"death":31,"corpse":2,"corpse_hit":11,"atk":32,"TA_1":3,"TA_object_1":4,"idle_object_loop":17,"run_object_pre":6,"run_object_loop":16,"run_object_pst":7,"atk_object":21,"pick":22,"slide":29,"smacked":39,"sit":19,"sit_idle":45,"getup":18,"transform_to_king_pre":63,"buff":44,"debuff":49,"atk_triplepunch":51,"disappear":13,"appear":12,"transform":69,"flame":24,"eat_lunar":47,"work":24,"alternateeyes":30},"mermguard":{"ta":3,"idle_loop":16,"idle_creepy":55,"idle_happy":33,"idle_angry":48,"idle_scared":41,"walk_pre":6,"walk_loop":20,"walk_pst":5,"run_pre":6,"run_loop":16,"run_pst":6,"frozen":4,"frozen_loop_pst":6,"shock_loop":6,"shock_pst":8,"pig_pickup":25,"pig_take":26,"pig_reject":35,"eat":47,"hit":14,"sleep_pre":20,"sleep_loop":61,"sleep_pst":32,"transform_pig_were":116,"hungry":64,"abandon":42,"death":31,"corpse":2,"corpse_hit":11,"atk":32,"TA_1":3,"TA_object_1":4,"idle_object_loop":17,"run_object_pre":6,"run_object_loop":16,"run_object_pst":7,"atk_object":21,"pick":22,"slide":29,"smacked":39,"sit":19,"sit_idle":45,"getup":18,"transform_to_king_pre":63,"buff":44,"debuff":49,"atk_triplepunch":51,"disappear":13,"appear":12,"transform":69,"flame":24,"eat_lunar":47,"work":24,"alternateeyes":30,"transform_pre":63},"beefalo":{"beefalo":2,"idle_loop":72,"switch":36,"turn_back":24,"turn_fwd":25,"walk_graze_pre":12,"walk_graze_loop":56,"walk_graze_pst":9,"walk_pre":12,"walk_loop":56,"walk_pst":9,"shake":24,"graze_loop":28,"alert_pre":3,"alert_idle":44,"alert_pst":6,"run_pre":3,"run_loop":12,"run_pst":21,"atk_pre":5,"atk":21,"bellow":51,"sleep_pre":34,"sleep_loop":72,"sleep_pst":33,"hit":15,"hair_growth_pre":23,"hair_growth":17,"mating_taunt1":53,"mating_taunt2":71,"shave":37,"death":34,"saddle_equip":22,"frozen":4,"frozen_loop_pst":6,"shock_loop":6,"shock_pst":9,"corpse":2,"corpse_hit":11,"walk_graze2_pre":12,"walk_graze2_loop":56,"walk_graze2_pst":10,"graze2_pre":13,"graze2_loop":28,"graze2_pst":9,"whipped_negative":29,"transform":16,"shakesaddle_off":32,"vomit":22,"intestinal_cramp":82,"MISC":7,"brush":51,"run2_pre":3,"run2_loop":12,"run2_pst":21,"fart":30,"beg_pre":6,"beg_loop":17,"beg_pst":7},"koalefant_summer":{"idle_loop":72,"walk_graze_pre":12,"walk_graze_loop":56,"walk_graze_pst":9,"walk_pre":12,"walk_loop":56,"walk_pst":9,"hide_pre":9,"hide_idle_1":38,"hide_idle_2":56,"peek_out":32,"peek_loop":21,"hide_post":15,"koalefant":2,"shake":24,"graze_loop":28,"alert_pre":17,"alert_idle":44,"alert_pst":8,"run_pre":3,"run_loop":12,"run_pst":21,"atk_pre":5,"atk":21,"bellow":51,"sleep_pre":34,"sleep_loop":72,"sleep_pst":33,"hit":15,"surprise":30,"death":34,"corpse":1,"frozen":4,"frozen_loop_pst":6,"carcass1":1,"carcass1_shake":11,"carcass2":1,"carcass2_shake":11,"carcass3":1,"carcass3_shake":11,"carcass4":1,"carcass4_shake":11,"carcass_fake":33,"shock_loop":6,"shock_pst":9},"koalefant_winter":{"idle_loop":72,"walk_graze_pre":12,"walk_graze_loop":56,"walk_graze_pst":9,"walk_pre":12,"walk_loop":56,"walk_pst":9,"hide_pre":9,"hide_idle_1":38,"hide_idle_2":56,"peek_out":32,"peek_loop":21,"hide_post":15,"koalefant":2,"shake":24,"graze_loop":28,"alert_pre":17,"alert_idle":44,"alert_pst":8,"run_pre":3,"run_loop":12,"run_pst":21,"atk_pre":5,"atk":21,"bellow":51,"sleep_pre":34,"sleep_loop":72,"sleep_pst":33,"hit":15,"surprise":30,"death":34,"corpse":1,"frozen":4,"frozen_loop_pst":6,"carcass1":1,"carcass1_shake":11,"carcass2":1,"carcass2_shake":11,"carcass3":1,"carcass3_shake":11,"carcass4":1,"carcass4_shake":11,"carcass_fake":33,"shock_loop":6,"shock_pst":9},"spider_warrior":{"idle":2,"walk_pre":6,"walk_loop":17,"walk_pst":7,"evade":16,"enter":79,"taunt":31,"atk":43,"death":27,"corpse":1,"cower":3,"cower_loop":30,"cower_pst":7,"hit":16,"eat":12,"eat_loop":12,"eat_pst":8,"sleep_pre":34,"sleep_loop":57,"sleep_pst":25,"frozen":4,"frozen_loop_pst":6,"crap":23,"mutate_pre":18,"mutate_pst":25,"shock_loop":6,"shock_pst":9,"knockback":39,"warrior_pounce_bk":16,"warrior_pounce_fwd":14,"warrior_atk":29},"spider_hider":{"idle":2,"walk_pre":6,"walk_loop":17,"walk_pst":7,"evade":16,"enter_loop":24,"land":15,"taunt":31,"atk":43,"death":36,"corpse":2,"corpse_hit":11,"cower":3,"cower_loop":30,"cower_pst":7,"hit":16,"eat":12,"eat_loop":12,"eat_pst":8,"sleep_pre":34,"sleep_loop":57,"sleep_pst":25,"frozen":4,"frozen_loop_pst":6,"crap":23,"hide":18,"hit_shield":10,"hide_loop":1,"unhide":18,"mutate_pre":18,"mutate_pst":25,"shock_loop":6,"shock_pst":9,"mutated_spider_reviving":184,"knockback":39},"spider_dropper":{"idle":2,"walk_pre":6,"walk_loop":17,"walk_pst":7,"evade":16,"enter":79,"taunt":31,"atk":43,"death":27,"corpse":1,"cower":3,"cower_loop":30,"cower_pst":7,"hit":16,"eat":12,"eat_loop":12,"eat_pst":8,"sleep_pre":34,"sleep_loop":57,"sleep_pst":25,"frozen":4,"frozen_loop_pst":6,"crap":23,"mutate_pre":18,"mutate_pst":25,"shock_loop":6,"shock_pst":9,"knockback":39,"warrior_pounce_bk":16,"warrior_pounce_fwd":14,"warrior_atk":29},"bat":{"fly_loop_nofaced":20,"fly_loop":20,"atk":21,"hit":12,"death":37,"sleep_pre":30,"sleep_loop":40,"sleep_pst":20,"taunt":48,"eat":22,"eat_loop":20,"frozen":2,"frozen_loop_pst":6,"misc":6,"fly_away_pre":9,"fly_away_loop":20,"fly_back_loop":19,"fly_back_pst":8,"chew_pre":8,"chew_loop":10,"chew_pst":14,"shock_loop":6,"shock_pst":8,"corpse":2,"corpse_hit":11,"knockback":39},"frog":{"idle":89,"jump_pre":4,"jump":17,"jump_pst":6,"sleep_pre":16,"sleep_loop":30,"sleep_pst":15,"atk_pre":17,"atk":28,"eat_pre":18,"eat_loop":16,"eat_pst":7,"steal":18,"swallow":19,"death":27,"frozen":4,"frozen_loop_pst":6,"fall_idle":22,"hit":11,"shock_loop":6,"shock_pst":9,"corpse":2,"corpse_hit":11,"knockback":39},"bee":{"idle":3,"walk_pre":6,"walk_loop":30,"walk_pst":7,"evade":20,"atk":27,"sleep_pre":34,"sleep_loop":54,"sleep_pst":37,"land":31,"land_idle":23,"take_off":24,"hit":24,"death":26,"idle_angry":4,"frozen":4,"frozen_loop_pst":6,"shock_loop":6,"shock_pst":9,"corpse":2,"corpse_hit":11,"knockback":39},"mosquito":{"idle":3,"explode_pre":7,"explode":20,"walk_pre":6,"walk_loop":30,"walk_pst":7,"evade":20,"atk":27,"sleep_pre":34,"sleep_loop":54,"sleep_pst":37,"land":31,"land_idle":23,"take_off":24,"hit":24,"death":26,"idle_angry":4,"frozen":4,"frozen_loop_pst":6,"shock_loop":6,"shock_pst":9,"corpse":2,"corpse_hit":11,"knockback":39},"penguin":{"walk":31,"idle_loop":35,"taunt":39,"atk_pre":7,"atk":18,"sleep_pre":37,"sleep_loop":46,"sleep_pst":30,"hit":12,"death":27,"slide_pre":22,"slide_bounce":12,"slide_loop":13,"slide_post":15,"frozen":4,"frozen_loop_pst":6,"eat":43,"shock_loop":6,"shock_pst":9,"knockback":39},"catcoon":{"catcoon":2,"idle_loop":54,"walk_pre":13,"walk_loop":24,"walk_pst":10,"frozen":2,"frozen_loop_pst":6,"frames":6,"taunt_pre":22,"taunt":29,"taunt_pst":15,"furball_pre":6,"furball_pre_loop":27,"furball":61,"atk":36,"sleep_pre":77,"sleep_loop":64,"sleep_pst":37,"death":28,"hit":11,"action":50,"jump_grab":51,"jump_atk":38,"shock_loop":6,"shock_pst":9,"corpse":2,"corpse_hit":11,"knockback":40},"krampus":{"idle":19,"run_pre":4,"run_loop":16,"run_pst":11,"atk_pre":15,"atk":14,"hit":13,"sleep_pre":25,"sleep_loop":45,"sleep_pst":22,"taunt":47,"steal_pre":14,"steal":24,"exit":72,"death":39,"corpse":2,"corpse_hit":11,"frozen":4,"frozen_loop_pst":6,"poses":14,"shock_loop":6,"shock_pst":9},"lightninggoat":{"lightning_goat":2,"idle_loop":44,"walk_pre":7,"walk":18,"walk_pst":15,"frozen":3,"frozen_loop_pst":6,"reference":6,"taunt_pre":12,"taunt":78,"taunt_pst":12,"shock":18,"shock_pst":14,"atk":30,"sleep_pre":79,"sleep_loop":56,"sleep_pst":56,"bleet":40,"death":43,"trans":44,"hit":17,"death_2":43,"corpse":2,"corpse_hit":11},"slurtle":{"idle":59,"death":33,"walk_pre":1,"walk_loop":21,"walk_pst":5,"hide":10,"hide_loop":6,"hit_shield":10,"emerge":23,"atk":25,"atk_hide":14,"sleep_pre":10,"sleep_loop":41,"sleep_pst":23,"frozen":4,"frozen_loop_pst":9,"eat_pre":18,"eat_loop":27,"eat_pst":7,"taunt":47,"hit_out":12,"shock_loop":6,"shock_pst":8,"death_2":21,"corpse":2,"corpse_hit":11,"salt_death_pre":11,"salt_death_loop":20,"salt_death_pst":42,"knockback":39}};
export function initExtraMonster(w,m) {
  const d=m._definition;
  if(!d.extra)return;
  m._cooldown=d.cooldown+(d.warrior?w._random()*2:0);
  m._shieldDamage=0;m._lastDamaged=-Infinity;m._regenAt=d.regenPeriod??Infinity;
  if(m.type==='mosquito'){m.drinks=1;m.renderVariant=null;}
  if(m.type==='lightninggoat'){m.charged=false;m.renderVariant=null;}
}
function attack(w,m) {
  const d=m._definition,dist=distance(m,w.player),wasMoving=m.state==='move';
  let clips=d.attackClips,frames=d.hitFrames,motion=d.attackMotion,post=null;
  if(d.warrior&&dist>3){clips=['warrior_atk'];frames=[19];motion='spider';post='taunt';}
  if(d.pounce&&dist>3){clips=['jump_atk'];frames=[19];motion='cat';}
  if(m.type==='penguin'&&wasMoving&&m._intent!=='waddle'){clips=['slide_bounce'];frames=[1];motion='penguin';}
  w._face(m,w.player);w._state(m,'attack',clips,{attack:true});
  m._attackFrames=frames;m._attackMotion=motion;m._attackPost=post;m._queuedAttack=false;
  m.nextAttackAt=w.time+m._cooldown;m.attackTargetId='player';
  w._emit('attack',{id:m.id,targetId:'player',monster:m.type,attackVariant:motion??'melee'});
}
function move(w,m,intent) {
  const d=m._definition;
  if(m.state!=='move'||m._intent==='waddle') {
    const clips=d.moveMode==='frog'?['jump_pre','jump','jump_pst']:[d.movePre,d.moveClip].filter(Boolean);
    w._state(m,'move',clips,{loop:d.moveMode!=='frog'});
  }
  m._intent=intent;
}
export function extraMonsterDecision(w,m) {
  if(!m._definition.extra)return false;
  const d=m._definition;
  if(w.time+EPS<m.nextBrainAt)return true;
  do{m.nextBrainAt+=0.125;}while(m.nextBrainAt<=w.time+EPS);
  if(['electrocute','electrocute_pst','shocked','frozen','thaw','splat','dead'].includes(m.state))return true;
  if(d.shieldThreshold&&m.state!=='shield_end'){
    if(m.state==='shield'){
      if(w.time-m._lastDamaged>d.shieldTime+EPS)w._state(m,'shield_end',d.shieldExit);
      return true;
    }
    if(m._shieldDamage>d.shieldThreshold){m._shieldDamage=0;w._state(m,'shield',['hide','hide_loop'],{loop:true});return true;}
  }
  if(['shield_end','taunt'].includes(m.state))return true;
  const dist=distance(m,w.player),ready=w.time+EPS>=m.nextAttackAt,range=d.attackRange+w.player.radius;
  if(m.state==='attack'){
    if(m.stateTime+EPS<(d.releaseFrame??Infinity)*DT)return true;
    w._idle(m);
  }
  if(m.state==='hit'){
    if(!d.attackFromHit)return true;
    if(typeof d.attackFromHit==='number'&&m.stateTime+EPS<d.attackFromHit*DT){
      if(ready&&dist<=range)m._queuedAttack=true;
      return true;
    }
    if(!ready||dist>range)return true;
  }
  if(d.fleeThreshold&&m.hp/m.maxHp<d.fleeThreshold){
    if(dist<d.fleeStop)move(w,m,'flee');else w._idle(m);return true;
  }
  if(d.dodgeStart&&!ready){
    const retreat=m._intent==='retreat'?dist<d.dodgeStop:dist<d.dodgeStart;
    if(retreat)move(w,m,'retreat');else w._idle(m);return true;
  }
  if(ready&&dist<=range){attack(w,m);return true;}
  if(m.state==='move'&&d.moveMode==='frog'&&m.stateTime+EPS<m._stateDuration)return true;
  const stop=m.state==='move'?m.radius+w.player.radius+0.1:range;
  if(dist>stop)move(w,m,'chase');else if(m.state==='move')w._idle(m);
  return true;
}
function canHit(w,m) {
  const d=m._definition,p=w.player;
  if(p.dead||distance(m,p)>d.hitRange+p.radius+EPS)return false;
  if(d.hitArc){const angle=Math.atan2(p.z-m.z,p.x-m.x);const delta=Math.atan2(Math.sin(angle-m.facing),Math.cos(angle-m.facing));if(Math.abs(delta)>d.hitArc*Math.PI/360)return false;}
  return true;
}
export function extraMonsterTimeline(w,m) {
  if(!m._definition.extra)return false;
  const d=m._definition;
  if(m.state==='attack'){
    const frames=m._attackFrames??d.hitFrames;
    while(m.hitIndex<frames.length&&m.stateTime+EPS>=frames[m.hitIndex]*DT){
      m.hitIndex++;
      if(canHit(w,m))w._damage(w.player,d.damage*(m.charged?1.5:1),m,{electric:!!m.charged});
      else w._emit('miss',{id:m.id,targetId:'player'});
      if(m.dead)return true;
    }
    if(m.stateTime+EPS>=(d.releaseFrame??d.attackTagEnd??Infinity)*DT)m.attackActive=false;
    if(m.stateTime+EPS>=m._stateDuration){
      if(m._attackPost==='taunt')w._state(m,'taunt','taunt');
      else if(m.type==='penguin'){w._state(m,'move','walk',{loop:true});m._intent='waddle';}
      else w._idle(m);
    }
  } else if(m.state==='move'&&d.moveMode==='frog'&&m.stateTime+EPS>=m._stateDuration)w._idle(m);
  else if(m.state==='hit'&&m._queuedAttack&&m.stateTime+EPS>=d.attackFromHit*DT)attack(w,m);
  else if(['hit','taunt','shield_end','shocked'].includes(m.state)&&m.stateTime+EPS>=m._stateDuration)w._idle(m);
  return true;
}
function motorSpeed(m) {
  const f=Math.round(m.stateTime/DT);
  if(m._attackMotion==='spider')return f>=8&&f<20?20:0;
  if(m._attackMotion==='cat')return f>=6&&f<20?12:0;
  if(m._attackMotion==='bat')return f<5?1.5:f<10?6:f<11?2:f<12?1:f<13?0.5:0;
  if(m._attackMotion==='penguin')return 6;
  return 0;
}
export function extraMonsterMovement(w,m) {
  if(!m._definition.extra)return false;
  const d=m._definition;
  if(m.state==='attack'){
    const speed=motorSpeed(m);m.moving=speed>0;
    m.x+=Math.cos(m.facing)*speed*DT;m.z+=Math.sin(m.facing)*speed*DT;w._bound(m);return true;
  }
  if(m.state!=='move')return true;
  const retreat=['retreat','flee'].includes(m._intent),p=w.player;
  let dx=p.x-m.x,dz=p.z-m.z,dist=Math.hypot(dx,dz),speed=d.speed;
  if(dist<EPS)return true;
  const pre=d.movePre?w.duration(m.type,d.movePre):0;
  const cycle=w.duration(m.type,d.moveClip)/DT;
  const loopFrame=((m.stateTime-pre)/DT%cycle+cycle)%cycle;
  if(d.moveMode==='spider'&&m.stateTime<pre)speed=d.warrior?4:3;
  if(d.moveMode==='bunny'&&m.stateTime>=pre)speed=loopFrame<8-EPS?d.speed:0;
  if(d.moveMode==='slurtle')speed=m.stateTime>=pre&&loopFrame>=13-EPS&&loopFrame<21-EPS?d.speed:0;
  if(d.moveMode==='goat')speed=m.stateTime<pre?0:loopFrame>=2-EPS&&loopFrame<14-EPS?8:4;
  if(d.moveMode==='cat'&&m.stateTime<pre)speed=0;
  if(d.moveMode==='frog'){const f=m.stateTime/DT;speed=f>=5-EPS&&f<20-EPS?8:0;}
  if(d.moveMode==='penguin'&&m._intent==='waddle')speed=0.75;
  const stop=retreat?(m._intent==='flee'?d.fleeStop:d.dodgeStop):m.radius+p.radius+0.05;
  const amount=Math.min(speed*DT,Math.max(0,retreat?stop-dist:dist-stop))*(retreat?-1:1);
  m.x+=dx/dist*amount;m.z+=dz/dist*amount;
  if(amount!==0)m.facing=Math.atan2(dz,dx)+(retreat?Math.PI:0);
  w._bound(m);return true;
}
export function extraDamageMultiplier(m) {
  return m._definition.extra&&m.state==='shield'?1-m._definition.shieldAbsorb:1;
}
export function extraOnDamaged(w,m,amount,source,meta) {
  if(!m._definition.extra)return;
  const d=m._definition;
  if(d.shieldThreshold){m._lastDamaged=w.time;if(m.state!=='shield')m._shieldDamage+=amount;}
  if(m.type==='lightninggoat'&&m.charged&&source!==m&&!source.dead){
    // Charged goats retaliate against melee, including a spear lunge. The
    // first electric hit only charges an uncharged goat and does not reflect.
    w._damage(source,25*1.5,m,{electric:true,reflected:true});
  }
}
export function extraOnHitOther(w,m,target,meta={}) {
  if(!m._definition.extra||meta.burst)return;
  // User-requested training rule: frog hits create free grass, never steal gear.
  if(m.type==='frog'&&target===w.player)w.dropStolenItem(m);
  if(m.type==='mosquito'){
    m.drinks++;
    if(m.drinks>4){m.hp=0;m.dead=true;m.rangeVisible=false;m._burstAt=w.time+11*DT;w._state(m,'dead','explode');w._emit('death',{id:m.id,sourceId:m.id,monster:m.type,cause:'overfed'});}
    else m.renderVariant=`drink${m.drinks}`;
  }
}
export function extraMonsterHitReaction(w,m,meta={}) {
  if(!m._definition.extra)return false;
  const d=m._definition;
  if(m.type==='lightninggoat'&&meta.electric&&!m.charged){
    m.charged=true;m.renderVariant='charged';w._state(m,'shocked',['shock','shock_pst']);w._emit('charged',{id:m.id});return true;
  }
  if(meta.electric&&m.type!=='lightninggoat'&&!m.state.startsWith('electrocute')&&w.time+EPS>=(m._electrocuteUntil??0)){
    m._electrocuteUntil=w.time+2+2*w._random();m.lastHitReaction=w.time;m._shieldDamage=0;
    w._state(m,'electrocute','shock_loop',{loop:true,duration:0.8});w._emit('electrocute',{id:m.id,duration:0.8});return true;
  }
  if(m.state.startsWith('electrocute')||m.state==='shocked')return true;
  if(m.state==='shield'){
    // Keep absorption while only replacing the visual queue with a shield hit.
    w._state(m,'shield',['hit_shield','hide_loop'],{loop:true});return true;
  }
  const attacking=m.state==='attack';
  const released=attacking&&m.stateTime+EPS>=(d.releaseFrame??Infinity)*DT;
  let interruptible=['idle','move','hit'].includes(m.state)||released||d.interruptAttack&&attacking;
  if(d.hitPolicy==='warrior')interruptible=!['attack','move','shield','shield_end'].includes(m.state);
  if(d.hitPolicy==='always')interruptible=m.state!=='shield_end';
  if(d.hitPolicy==='outsideAttack'||d.hitPolicy==='outsideAttackCooldown')interruptible=!attacking&&!['shield_end','shocked'].includes(m.state);
  if(!interruptible)return true;
  let recovered=w.time-m.lastHitReaction+EPS>=d.hitRecovery;
  if(d.hitPolicy==='always'||d.hitPolicy==='warrior'||d.hitPolicy==='outsideAttack')recovered=true;
  if(m.state==='idle'&&w.time<m.nextAttackAt)recovered=true;
  if(d.maxStunLocks){
    if(recovered)m._stunCount=1;
    else if((m._stunCount??1)<d.maxStunLocks){m._stunCount=(m._stunCount??1)+1;recovered=true;}
  }
  // Common hit states tagged busy cannot be repeatedly restarted unless a
  // species-specific attacked handler explicitly permits it.
  if(m.state==='hit'&&!['always','warrior','outsideAttack'].includes(d.hitPolicy))return true;
  if(recovered){m.lastHitReaction=w.time;w._state(m,'hit',d.hitClip);}
  return true;
}

export function updateExtraWorld(w) {
  for(const m of w.monsters)if(!m.dead&&m._definition.regenPeriod&&w.time+EPS>=m._regenAt){
    m._regenAt+=m._definition.regenPeriod;m.hp=Math.min(m.maxHp,m.hp+m._definition.regenAmount);
  }
  for(const m of w.monsters)if(m._burstAt!=null&&w.time+EPS>=m._burstAt){
    m._burstAt=null;
    for(const target of w.entities)if(target!==m&&!target.dead&&distance(m,target)<=3.5)w._damage(target,34,m,{burst:true});
    w._emit('burst',{id:m.id,x:m.x,z:m.z,radius:3.5});
  }
}
export const hasExtraPendingDamage=w=>w.monsters.some(m=>m._burstAt!=null);
