import { EXTRA_MONSTERS, EXTRA_ANIMATION_FRAMES, initExtraMonster, extraMonsterDecision, extraMonsterTimeline,
  extraMonsterMovement, extraMonsterHitReaction, extraDamageMultiplier, extraOnDamaged, extraOnHitOther,
  updateExtraWorld, hasExtraPendingDamage } from './extra-monsters.js';
import { DEERCLOPS, DEERCLOPS_ANIMATION_FRAMES, deerclopsDecision, deerclopsTimeline, deerclopsMovement,
  deerclopsHitReaction, updateDeerclopsHazards, applyColdness, updatePlayerCold, breakPlayerFreeze } from './deerclops.js';
import {TrainingInventory,TRAINING_GRASS} from './inventory.js';
/**
 * Independent, deterministic training simulation. No game files are loaded here.
 * Rules audited against DST build 762172 (scripts.zip): SGwilson, SGspider,
 * SGhound, SGtallbird, SGLeif, SGtentacle, combat, chaseandattack and tuning.
 * Positions/radii are game world units; facing is atan2(z, x), in radians.
 */
export const FIXED_DT = 1 / 30;
const EPSILON = 1e-8;
const TAU = Math.PI * 2;
const PLAYER_HIT_FRAME = 8;
const PLAYER_CHAIN_FRAME = 13;
const PLAYER_COOLDOWN = 0.4;
// Uncharged Elding Spear, arsenal_spear_4 unlocked. Its mouse reticle is
// always 6.5 world units from the caster (not a variable-length dash).
export const DASH = Object.freeze({ range: 6.5, cooldown: 3, damage: 68, sideRange: 1 });

export const UNARMED = Object.freeze({id:'unarmed',name:'空手',damage:10,range:2,hitRange:2,
  electric:false,speedMultiplier:1,attackClips:['punch'],chainFrames:24});
export const WEAPONS = Object.freeze({
  cane: Object.freeze({id:'cane',name:'步行手杖',damage:17,range:2,hitRange:2,electric:false,speedMultiplier:1.25}),
  spear: Object.freeze({ id: 'spear', name: '矛', damage: 34, range: 2, hitRange: 2, electric: false }),
  spear_wathgrithr_lightning: Object.freeze({
    id: 'spear_wathgrithr_lightning', name: '奔雷矛', damage: 59.5,
    range: 2, hitRange: 2, electric: true, wetBonus: 0.5,
  }),
});

export const INVENTORY_ITEMS=Object.freeze({...WEAPONS,cutgrass:TRAINING_GRASS});
export const MAX_GRASS_DROPS=32;

const CORE_MONSTERS = Object.freeze({
  spider: Object.freeze({ id: 'spider', name: '蜘蛛', hp: 100, damage: 20,
    speed: 5, radius: 0.5, mass: 10, attackRange: 3, hitRange: 3,
    cooldown: 3, hitFrames: [25], attackClips: ['atk'], moveClip: 'walk_loop', movePre: 'walk_pre',
    idleClip: 'idle', hitRecovery: 0, healthOffset: 105 }),
  hound: Object.freeze({ id: 'hound', name: '猎犬', hp: 150, damage: 20,
    speed: 10, radius: 0.5, mass: 10, attackRange: 3, hitRange: 3,
    cooldown: 2, hitFrames: [16], attackClips: ['atk_pre', 'atk'], moveClip: 'run_loop', movePre: 'run_pre',
    idleClip: 'idle', hitRecovery: 0, healthOffset: 105 }),
  tallbird: Object.freeze({ id: 'tallbird', name: '高脚鸟', hp: 800, damage: 50,
    speed: 7, radius: 0.5, mass: 10, attackRange: 3, hitRange: 3,
    cooldown: 2, hitFrames: [12], attackClips: ['atk_pre', 'atk'], moveClip: 'walk_loop', movePre: 'walk_pre',
    idleClip: 'idle', hitRecovery: 0.75, healthOffset: 205 }),
  leif: Object.freeze({ id: 'leif', name: '树精守卫', hp: 3000, damage: 49.5, rawDamage: 150,
    speed: 1.5, radius: 0.5, mass: 1000, attackRange: 3, hitRange: 3,
    cooldown: 3, hitFrames: [25], attackClips: ['atk'], moveClip: 'walk_loop', movePre: 'walk_pre',
    idleClip: 'idle_loop', hitRecovery: 1.5, healthOffset: 260 }),
  killerbee: Object.freeze({ id: 'killerbee', name: '杀人蜂', hp: 100, damage: 10,
    speed: 4, radius: 0.5, mass: 1, flying: true, attackRange: 0.6, hitRange: 0.6,
    cooldown: 2, hitFrames: [15], attackClips: ['atk'], movePre: 'walk_pre', moveClip: 'walk_loop',
    idleClip: 'idle_angry', hitRecovery: 0, dodgeStart: 3, dodgeStop: 6, brainPeriod: 0.125, healthOffset: 90 }),
  knight: Object.freeze({ id: 'knight', name: '发条骑士', hp: 900, damage: 40,
    speed: 5, radius: 0.5, mass: 50, attackRange: 2.5, hitRange: 2.75,
    cooldown: 2, hitFrames: [14], attackClips: ['atk'], movePre: 'walk_pre', moveClip: 'walk_loop',
    idleClip: 'idle_loop', hitRecovery: 0.75, dodgeStart: 5, dodgeStop: 8, brainPeriod: 0.125, healthOffset: 185 }),
  werepig: Object.freeze({ id: 'werepig', name: '疯猪', hp: 525, damage: 40,
    speed: 7, radius: 0.5, mass: 50, attackRange: 3, hitRange: 3,
    cooldown: 2, hitFrames: [16], attackClips: ['were_atk_pre', 'were_atk', 'were_atk_pst'],
    movePre: 'were_run_pre', moveClip: 'were_run_loop', idleClip: 'were_idle_loop',
    hitRecovery: 0.75, brainPeriod: 0.125, healthOffset: 165 }),
  tentacle: Object.freeze({ id: 'tentacle', name: '触手', hp: 500, damage: 34,
    speed: 0, radius: 0.25, mass: Infinity, attackRange: 4, hitRange: 4,
    cooldown: 2, hitFrames: [7, 17], attackClips: ['atk_loop', 'atk_idle'],
    moveClip: 'idle', idleClip: 'idle', hitRecovery: 0, wet: true, healthOffset: 190 }),
});

export const MONSTERS=Object.freeze({...CORE_MONSTERS,...EXTRA_MONSTERS,deerclops:DEERCLOPS});

// Extracted animation lengths, not guesses from guide videos. Values are frames.
// Variant directions can differ by one frame; setAnimationDurations can supply
// exact per-clip seconds from the asset manifest used by the renderer.
const ANIMATION_FRAMES = {
  ...EXTRA_ANIMATION_FRAMES, deerclops:DEERCLOPS_ANIMATION_FRAMES,
  player: { idle_loop: 66, run_pre: 4, run_loop: 16, run_pst: 8,
    atk_pre: 6, atk: 19, hit: 21, death: 55, lunge_pre: 12, lunge_lag: 10, lunge_pst: 17, item_in: 22, item_out: 16, punch: 31, pickup:5,pickup_pst:10,shock:16,shock_pst:13,frozen:6,frozen_loop_pst:6 },
  spider: { idle: 2, walk_pre: 6, walk_loop: 17, atk: 43, hit: 16, death: 27, taunt: 31 },
  hound: { idle: 10, run_pre: 3, run_loop: 8, atk_pre: 14, atk: 9, atk_pst: 4, hit: 13,
    death: 25, taunt: 39 },
  tallbird: { idle: 40, walk_pre: 5, walk_loop: 24, atk_pre: 10, atk: 21, hit: 16, death: 30, taunt: 64 },
  leif: { idle_loop: 70, walk_pre: 19, walk_loop: 66, atk: 55, hit: 17, death: 40 },
  killerbee: { idle: 3, idle_angry: 4, atk: 27, hit: 24, death: 26, walk_pre: 6, walk_loop: 30, walk_pst: 7 },
  knight: { idle_loop: 34, atk: 30, hit: 17, death: 27, taunt: 54, walk_pre: 4, walk_loop: 20, walk_pst: 9,
    shock_to_stun:15,stun_loop:28,stun_pst:38,stun_hit:11,stun_shock_loop:6,stun_shock_pst:13 },
  werepig: { were_idle_loop: 31, were_atk_pre: 15, were_atk: 7, were_atk_pst: 10,
    were_run_pre: 6, were_run_loop: 16, were_run_pst: 7, were_walk_pre: 6, were_walk_loop: 20,
    were_walk_pst: 6, howl: 82, hit: 14, death: 31 },
  tentacle: { ground_pre: 13, ground_loop: 30, ground_pst: 28, idle: 1, atk_pre: 25, atk_loop: 22, atk_idle: 30, atk_pst: 43,
    breach_pre: 18, breach_loop: 21, breach_pst: 37, hit: 17, death: 43 },
};

for (const type of ['spider','hound','tallbird','leif','tentacle','killerbee','knight','werepig']) {
  ANIMATION_FRAMES[type].shock_loop=6;
  ANIMATION_FRAMES[type].shock_pst=['leif','werepig'].includes(type)?8:9;
}

function segmentDistanceSq(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x-a.x)*dx+(point.z-a.z)*dz)/lengthSq)) : 0;
  return (point.x-a.x-t*dx)**2 + (point.z-a.z-t*dz)**2;
}
function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function weaponId(id) { return id === 'thunder_spear' || id === 'lightning' ? 'spear_wathgrithr_lightning' : id; }
function monsterId(id) { return id === 'treeguard' ? 'leif' : id; }

export class CombatWorld {
  constructor(options = {}) {
    this.bounds = finite(options.bounds, 30);
    this.seed = (options.seed ?? 762172) >>> 0;
    this.animationDurations = {};
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
    this.reset({ spawns: options.spawns ?? [], weapon: options.weapon ?? 'spear', damage: options.damage });
  }

  /** Starts a new round. For deterministic tests, optional explicit x/z are supported. */
  reset(config = {}) {
    const previousInventory=config.keepInventory?this.inventory?.snapshot():null;
    const remainingGround=[];
    if(config.keepInventory&&previousInventory)for(const drop of this.droppedItems??[]){
      if(drop.item.type==='cutgrass')continue;
      const data={id:drop.item.id,type:drop.item.type,damage:drop.item.damage,prevSlot:drop.item.prevSlot};
      let index=Number.isInteger(data.prevSlot)&&!previousInventory.slots[data.prevSlot]?data.prevSlot:previousInventory.slots.findIndex(i=>!i);
      if(index>=0)previousInventory.slots[index]=data;else remainingGround.push({...drop,item:data});
    }
    const initialWeapon=config.weapon??this.weapon?.id??'spear';
    this._rng = (config.seed ?? this.seed) >>> 0 || 1;
    this.time = 0;
    this.ticks = 0;
    this._accumulator = 0;
    this._nextId = 1;
    this.paused = false;
    this.attackHeld = false;
    this._attackRequested = false;
    this._move = { x: 0, z: 0 };
    this.targetId = null;
    this.events = [];
    this.hazards=[];this.droppedItems=[];this._pickupId=null;
    this.stats = { elapsed: 0, attacks: 0, hits: 0, misses: 0, kills: 0,
      hitsTaken: 0, damageTaken: 0, damageDealt: 0, healing: 0, cancelledAttacks: 0, dashes: 0 };
    this._dashItemId = null;
    this._dashTarget = null;
    this._battleborn = 0;
    this._battlebornAt = 0;
    this.player = this._entity('player', 0, 0, {
      name: '薇格弗德', hp: 200, speed: 6, radius: 0.5, mass: 75,
      damageMultiplier: 1.25, absorption: 0.25, idleClip: 'idle_loop',
    });
    this.player.id = 'player';
    this.player.x = finite(config.playerX);
    this.player.z = finite(config.playerZ);
    this.inventory=new TrainingInventory(INVENTORY_ITEMS,config.inventory??previousInventory);
    this.droppedItems=remainingGround.map(drop=>({...drop,item:this.inventory.createItem(drop.item.type,drop.item.damage,drop.item)}));
    for(const item of this.inventory.overflow.splice(0))this._dropItem(item,this.player.x,this.player.z,'inventory_overflow');
    const wanted=weaponId(initialWeapon);
    if(wanted==='unarmed')this.inventory.unequip();
    else {
      let selected=this.inventory.hands?.type===wanted?this.inventory.hands:this.inventory.items.find(item=>item.type===wanted);
      selected??=this.inventory.items.find(item=>item.type==='spear');
      if(selected)this.inventory.equip(selected.id,this.inventory.active===selected);
    }
    if(this.inventory.hands&&config.damage!=null)this.inventory.hands.damage=Math.max(0,finite(config.damage,this.inventory.hands.damage));
    this._syncHand();
    if(this.inventory.hands?.type==='spear_wathgrithr_lightning')this.inventory.hands.readyAt=DASH.cooldown;
    const spawns = Array.isArray(config.spawns) ? config.spawns :
      config.type ? [{ type: config.type, count: config.count ?? 1 }] : [];
    const total = Math.min(80, spawns.reduce((n, s) => n + clamp(Math.floor(finite(s.count, 1)), 0, 30), 0));
    this.monsters = [];
    for (const spawn of spawns) {
      const type = monsterId(spawn.type);
      if (!MONSTERS[type]) continue;
      const count = clamp(Math.floor(finite(spawn.count, 1)), 0, 30);
      for (let j = 0; j < count && this.monsters.length < 80; j++) {
        const index = this.monsters.length;
        const ringSize = Math.min(10, total);
        const angle = -Math.PI / 2 + (index % ringSize) * TAU / Math.max(1, ringSize);
        const radius = 6.5 + Math.floor(index / 10) * 3;
        const x = spawn.x != null ? finite(spawn.x) + j * 1.5 : Math.cos(angle) * radius;
        const z = spawn.z != null ? finite(spawn.z) : Math.sin(angle) * radius;
        const entity = this._entity(type,x,z,MONSTERS[type]);
        initExtraMonster(this,entity);
        if (type === 'tentacle') {
          entity.targetId = null;
          entity._retargetPeriod = 1.5 + this._random();
          entity._retargetAt = entity._retargetPeriod * this._random();
          entity._keepTargetAt = 0;
          entity._groundTimeout = 5 + 10 * this._random();
        }
        if(type==='werepig') entity._newTarget=true;
        this.monsters.push(entity);
      }
    }
    this.entities = [this.player, ...this.monsters];
    this.status = this.monsters.length ? 'running' : 'ready';
    this._emit('reset', { count: this.monsters.length });
    return this;
  }

  _entity(type, x, z, data) {
    return { id: `${type}-${this._nextId++}`, type, name: data.name, x, z,
      previousX: x, previousZ: z, facing: Math.PI / 2,
      hp: data.hp, maxHp: data.hp, radius: data.radius, mass: data.mass,
      speed: data.speed, state: 'idle', stateTime: 0, stateStarted: 0,
      animation: data.idleClip, animTime: 0, animLoop: true,
      attackActive: false, rangeVisible: type !== 'tentacle', healthVisible:type!=='tentacle',
      attackRange: data.attackRange ?? 2, hitRange: data.hitRange ?? 2,
      nextAttackAt: 0, nextBrainAt: 0, lastHitReaction: -Infinity,
      flashUntil: 0, dead: false, moving: false, targetId: type === 'player' ? null : 'player',
      hitIndex: 0, attackTargetId: null, healthOffset: data.healthOffset ?? 175,
      _definition: data, _queue: [data.idleClip], _stateDuration: Infinity,
      _playerHitDone: false, _intent: 'idle' };
  }

  setMove(x, z) {
    x = finite(x); z = finite(z);
    const magnitude = Math.hypot(x, z);
    this._move = magnitude > 1 ? { x: x / magnitude, z: z / magnitude } : { x, z };
  }

  /** Selecting a target alone does not force an attack. requestAttack is click-to-attack. */
  setTarget(id) {
    const target = this.monsters.find(m => m.id === id && !m.dead);
    this.targetId = target?.id ?? null;
    return target ?? null;
  }

  requestAttack(id = this.targetId) {
    this._pickupId=null;
    if (id != null) this.setTarget(id);
    this._attackRequested = true;
  }

  get equippedItem() { return this.inventory.hands; }
  get activeItem() { return this.inventory.active; }

  _syncHand() {
    const item=this.inventory.hands;
    this.weapon=item?WEAPONS[item.type]:UNARMED;
    this.baseDamage=item?.damage??UNARMED.damage;
    this.player.weapon=this.weapon.id;
    this.player.weaponItemId=item?.id??null;
    this.player.attackRange=this.weapon.range;
    this.player.hitRange=this.weapon.hitRange;
    this.player.speed=this.player._definition.speed*(this.weapon.speedMultiplier??1);
  }

  _inventoryUsable() {
    const p=this.player;
    return !p.dead&&!['hit','dash_pre','dash_recover','frozen','thaw'].includes(p.state)&&
      !(p.state==='pickup'&&p.stateTime+EPSILON<6*FIXED_DT)&&
      !(p.state==='electrocute'&&p.stateTime+EPSILON<(this.duration('player','shock')+4*FIXED_DT));
  }

  _handChanged(change,reason) {
    if(!change)return false;
    const p=this.player, wasMoving=p.state==='move';
    if(p.state==='attack')this._cancelPlayerAttack();
    // Inventory:Equip emits unequip, then equip for a different ENTITY, even
    // if both entities have the same prefab. Moving keeps its locomotion.
    if(change.old)this._emit('unequip',{id:p.id,eslot:'hands',itemId:change.old.id,itemType:change.old.type});
    const incoming=change.item;
    if(incoming?.type==='spear_wathgrithr_lightning'&&this.itemCooldown(incoming.id)<=EPSILON) {
      // RefreshAttunedSkills enables AOE only when already charged. Equipping
      // a still-recharging spear does NOT restart its remaining cooldown.
      incoming.readyAt=this.time+DASH.cooldown;
    }
    this._syncHand();
    if(incoming)this._emit('equip',{id:p.id,eslot:'hands',itemId:incoming.id,itemType:incoming.type,oldItemId:change.old?.id??null});
    if(!wasMoving) this._state(p,incoming?'item_out':'item_in',incoming?'item_out':'item_in');
    this._emit('inventorychange',{reason,handId:incoming?.id??null,activeId:this.inventory.active?.id??null});
    return true;
  }

  /** Slot indices are zero-based. Empty hotkeys do nothing in original DST. */
  useSlot(index) {
    if(!this._inventoryUsable()||this.inventory.active||!this.inventory.isSlot(index))return false;
    const item=this.inventory.slots[index];
    return item?this.equipItem(item.id):false;
  }

  equipItem(id) {
    if(!this._inventoryUsable())return false;
    return this._handChanged(this.inventory.equip(id,this.inventory.active?.id===id),'equip');
  }

  unequipHand() {
    if(!this._inventoryUsable())return false;
    return this._handChanged(this.inventory.unequip(),'unequip');
  }

  clickSlot(index) {
    if(this.player.dead||!this.inventory.clickSlot(index))return false;
    this._emit('inventorychange',{reason:'slot',slot:index,activeId:this.inventory.active?.id??null});
    return true;
  }

  clickHand() {
    if(!this._inventoryUsable())return false;
    const change=this.inventory.active?this.inventory.equip(this.inventory.active.id,true):this.inventory.unequip(true);
    return this._handChanged(change,'hand');
  }

  cancelCursor() {
    if(!this.inventory.cancelActive())return false;
    this._emit('inventorychange',{reason:'return',activeId:null});return true;
  }

  itemCooldown(id) {
    const item=typeof id==='object'?id:this.inventory.find(id)??this.droppedItems.find(d=>d.item.id===id)?.item;
    return item?Math.max(0,item.readyAt-this.time):0;
  }

  setItemDamage(id,damage) {
    const item=this.inventory.find(id);
    if(!item||!item.equippable)return false;
    item.damage=Math.max(0,finite(damage,item.damage));
    if(item===this.inventory.hands)this._syncHand();
    this._emit('inventorychange',{reason:'damage',itemId:id});return true;
  }

  addInventoryItem(type,damage,slot) {
    type=weaponId(type);
    if(type==='cutgrass')return this.inventory.ensureInfiniteGrass();
    if(!WEAPONS[type])return null;
    const target=this.inventory.emptySlot(slot);
    if(target<0)return null;
    const item=this.inventory.createItem(type,damage);item.prevSlot=target;
    this.inventory.slots[target]=item;
    this._emit('inventorychange',{reason:'add',itemId:item.id,slot:target});return item;
  }

  _dropItem(item,x,z,reason='drop') {
    const entry={id:`drop-${item.id}`,item,x:finite(x,this.player.x),z:finite(z,this.player.z),radius:0.5};
    this.droppedItems.push(entry);
    this._emit('itemdrop',{id:entry.id,itemId:item.id,itemType:item.type,x:entry.x,z:entry.z,reason});
    this._emit('inventorychange',{reason,itemId:item.id});return entry;
  }

  _dropGrassUnit(x,z,reason) {
    const grassDrops=this.droppedItems.filter(drop=>drop.item.type==='cutgrass');
    if(grassDrops.length>=MAX_GRASS_DROPS){
      // Infinite training supply keeps only the latest 32 one-unit piles.
      // Recycling a grass pile never evicts a dropped weapon or cane.
      const entry=grassDrops[0];
      this.droppedItems.splice(this.droppedItems.indexOf(entry),1);
      entry.x=finite(x,this.player.x);entry.z=finite(z,this.player.z);entry.item.count=1;
      this.droppedItems.push(entry);
      this._emit('itemdrop',{id:entry.id,itemId:entry.item.id,itemType:'cutgrass',x:entry.x,z:entry.z,reason,count:1,recycled:true});
      return entry;
    }
    const unit=this.inventory.createItem('cutgrass',undefined,{infinite:false,count:1});
    return this._dropItem(unit,x,z,reason);
  }

  dropActiveItem(x=this.player.x,z=this.player.z) {
    const item=this.inventory.active;
    if(!item||!this._inventoryUsable())return false;
    if(item.type==='cutgrass'&&item.infinite)return this._dropGrassUnit(x,z,'grass_drop');
    this.inventory.active=null;return this._dropItem(item,x,z);
  }

  dropStolenItem(thief) {
    // Explicit training convenience requested by the user: every frog hit
    // drops one free grass unit, regardless of source position. Gear is safe.
    this.inventory.ensureInfiniteGrass();
    const p=this.player,dx=thief.x-p.x,dz=thief.z-p.z,length=Math.hypot(dx,dz)||1;
    return this._dropGrassUnit(p.x+dx/length,p.z+dz/length,'frog_grass');
  }

  requestPickup(id) {
    if(!this._inventoryUsable())return false;
    const drop=id?this.droppedItems.find(d=>d.id===id):this.droppedItems.reduce((best,d)=>!best||distance(d,this.player)<distance(best,this.player)?d:best,null);
    if(!drop||drop.item.type!=='cutgrass'&&this.inventory.emptySlot(null)<0)return false;
    this._cancelPlayerAttack();this._attackRequested=false;this._pickupId=drop.id;
    return true;
  }

  _finishPickup() {
    const index=this.droppedItems.findIndex(d=>d.id===this._pickupId);
    if(index>=0){
      const drop=this.droppedItems[index];
      if(distance(drop,this.player)<=1.5){
        if(drop.item.type==='cutgrass'){
          const source=this.inventory.ensureInfiniteGrass();
          this.droppedItems.splice(index,1);
          this._emit('pickup',{id:drop.id,itemId:source.id,absorbedItemId:drop.item.id,slot:this.inventory.slotOf(source.id),count:drop.item.count});
          this._emit('inventorychange',{reason:'pickup',itemId:source.id});
        }else{
          const slot=this.inventory.emptySlot(drop.item.prevSlot);
          if(slot>=0){
            this.inventory.slots[slot]=drop.item;drop.item.prevSlot=slot;this.droppedItems.splice(index,1);
            this._emit('pickup',{id:drop.id,itemId:drop.item.id,slot});this._emit('inventorychange',{reason:'pickup',itemId:drop.item.id});
          }
        }
      }
    }
    this._pickupId=null;
  }

  /** Compatibility API. Prefabs select an owned item; IDs select an exact
   * entity. Re-selecting the same entity has no equip/unequip side effects. */
  setWeapon(id,damage) {
    if(id==='cutgrass')return false;
    if(id==='unarmed')return this.unequipHand();
    let item=this.inventory.find(id);
    if(!item) {
      const type=WEAPONS[weaponId(id)]?weaponId(id):'spear';
      item=this.inventory.hands?.type===type?this.inventory.hands:this.inventory.items.find(i=>i.type===type);
      item??=this.addInventoryItem(type,damage);
    }
    if(!item)return false;
    if(damage!=null)this.setItemDamage(item.id,damage);
    if(item===this.inventory.hands)return true;
    return this.equipItem(item.id);
  }

  setDamage(damage) {
    return this.inventory.hands?this.setItemDamage(this.inventory.hands.id,damage):false;
  }

  /** Pass { player: { atk_pre: seconds, ... }, hound: {...}, ... }. */
  setAnimationDurations(durations = {}) {
    for (const [type, clips] of Object.entries(durations)) {
      this.animationDurations[type] ??= {};
      for (const [clip, seconds] of Object.entries(clips)) {
        if (Number.isFinite(seconds) && seconds > 0) this.animationDurations[type][clip] = seconds;
      }
    }
  }

  duration(type, clip) {
    return this.animationDurations[type]?.[clip] ??
      (ANIMATION_FRAMES[type]?.[clip] ?? 30) * FIXED_DT;
  }

  get aliveCount() { return this.monsters.filter(m => !m.dead).length; }
  get selectedTarget() { return this.monsters.find(m => m.id === this.targetId && !m.dead) ?? null; }
  get damage() { return this.baseDamage; }
  get dashCooldown() { return DASH.cooldown; }
  get dashRange() { return DASH.range; }
  get dashRemaining() { return Math.min(DASH.cooldown,this.itemCooldown(this.inventory.hands?.id)); }
  get dashReady() { return this.weapon.electric && this.dashRemaining <= EPSILON &&
    this.status === 'running' && !this.paused && !this.player.dead &&
    ['idle','item_in','item_out','move','attack'].includes(this.player.state); }

  getDashTarget(x,z) {
    if (!Number.isFinite(x)||!Number.isFinite(z)) return null;
    const p=this.player,dx=x-p.x,dz=z-p.z,length=Math.hypot(dx,dz);
    if(length<EPSILON)return null;
    const target={x:p.x+DASH.range*dx/length,z:p.z+DASH.range*dz/length};
    return {...target,valid:Math.hypot(target.x,target.z)<=this.bounds-p.radius};
  }

  requestDash(x, z) {
    if (!this.dashReady || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const p = this.player, dx = x-p.x, dz = z-p.z, length = Math.hypot(dx, dz);
    if (length < EPSILON) return false;
    const target = { x: p.x + DASH.range*dx/length, z: p.z + DASH.range*dz/length };
    // The arena's edge is not valid landing ground; do not silently change range.
    if (Math.hypot(target.x, target.z) > this.bounds-p.radius) return false;
    this._cancelPlayerAttack();
    this._pickupId=null;
    this._attackRequested = false;
    this._dashTarget = target;
    this._dashItemId=this.inventory.hands.id;
    p.facing = Math.atan2(dz, dx);
    this._state(p, 'dash_pre', 'lunge_pre');
    this._emit('dashstart', { id: p.id, itemId:this._dashItemId, fromX: p.x, fromZ: p.z, toX: target.x, toZ: target.z });
    return true;
  }

  _performDash() {
    const p = this.player, start = { x: p.x, z: p.z }, end = this._dashTarget;
    if (!end || !this.weapon.electric || this.inventory.hands?.id!==this._dashItemId) { this._idle(p); return; }
    this._state(p, 'dash_recover', 'lunge_pst');
    const dx = end.x-start.x, dz = end.z-start.z, length = Math.hypot(dx,dz);
    const ux = dx/length, uz = dz/length;
    p.facing = Math.atan2(dz,dx);
    const tip = { x: end.x+ux*p.hitRange, z: end.z+uz*p.hitRange };
    // aoeweapon_lunge.lua: one broad-phase candidate set, then a separate
    // endpoint extension. Candidates are visited once even if both overlap.
    const broadRadius = (length+p.hitRange*0.5+3)*0.5;
    const center = { x:start.x+ux*broadRadius, z:start.z+uz*broadRadius };
    const victims = this.monsters.filter(m => !m.dead).filter(m => {
      const side = DASH.sideRange+m.radius;
      if (distance(m,center) <= broadRadius) return segmentDistanceSq(m,start,end) < side*side;
      return distance(m,end) < p.hitRange+m.radius && segmentDistanceSq(m,end,tip) < side*side;
    });
    for (const target of victims) {
      const amount = DASH.damage*p._definition.damageMultiplier*(target._definition.wet ? 1.5 : 1);
      this.stats.hits++;
      this._damage(target,amount,p,{electric:true,skill:'dash'});
      this._battlebornHit(target,DASH.damage);
    }
    p.x=end.x; p.z=end.z; p.previousX=end.x; p.previousZ=end.z;
    this.inventory.hands.readyAt=this.time+DASH.cooldown;
    this.stats.dashes=(this.stats.dashes??0)+1;
    this._emit('dash',{id:p.id,itemId:this._dashItemId,fromX:start.x,fromZ:start.z,toX:end.x,toZ:end.z,
      targets:victims.map(m=>m.id),damage:DASH.damage,cooldown:DASH.cooldown});
    this._dashTarget=null;
  }

  consumeEvents() { const events = this.events; this.events = []; return events; }

  update(deltaSeconds) {
    if (this.paused || this.status === 'ready') return 0;
    // Visibility changes are paused by the UI. Do not catch up long background stalls.
    this._accumulator += clamp(finite(deltaSeconds), 0, 0.25);
    let count = 0;
    while (this._accumulator + EPSILON >= FIXED_DT) {
      this._accumulator -= FIXED_DT;
      this.step();
      count++;
    }
    return count;
  }

  step() {
    if (this.paused || this.status === 'ready') return;
    updatePlayerCold(this);
    const now = this.time;
    const next = now + FIXED_DT;
    for (const e of this.entities) { e.previousX = e.x; e.previousZ = e.z; }
    if (this.status === 'running') {
      this._playerDecision();
      for (const m of this.monsters) if (!m.dead) this._monsterDecision(m);
      this._integrateMovement();
      this._resolveCollisions();
    }
    this.ticks++;
    this.time = this.ticks * FIXED_DT;
    for (const e of this.entities) {
      e.stateTime = Math.max(0, next - e.stateStarted);
      this._animate(e);
    }
    if (this.status === 'running') {
      this._playerTimeline();
      for (const m of this.monsters) if (!m.dead && !this.player.dead) this._monsterTimeline(m);
      updateExtraWorld(this);
      updateDeerclopsHazards(this);
      this.stats.elapsed = this.time;
      if (this.player.dead) this.status = 'dead';
      else if (this.monsters.length && this.aliveCount === 0 && !hasExtraPendingDamage(this)) this.status='won';
    } else updateDeerclopsHazards(this);
  }

  _random() {
    let n = this._rng;
    n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    this._rng = n >>> 0;
    return this._rng / 4294967296;
  }

  _emit(type, values = {}) {
    const event = { type, time: this.time, tick: this.ticks, ...values };
    this.events.push(event);
    if (this.events.length > 1000) this.events.splice(0, this.events.length - 1000);
    this.onEvent?.(event);
  }

  _state(entity, state, clips, options = {}) {
    entity.state = state;
    if(entity===this.player&&['frozen','thaw','dead'].includes(state))this._pickupId=null;
    entity.healthVisible=entity.type!=='tentacle' || ['attack_pre','attack','hit','electrocute','electrocute_pst','dead','retract'].includes(state);
    entity.stateStarted = this.time;
    entity.stateTime = 0;
    entity._queue = Array.isArray(clips) ? clips : [clips];
    entity.animation = entity._queue[0];
    entity.animTime = 0;
    entity.animLoop = options.loop ?? false;
    entity.attackActive = options.attack ?? false;
    entity._stateDuration = options.duration ??
      (entity.animLoop ? Infinity : entity._queue.reduce((sum, c) => sum + this.duration(entity.type, c), 0));
    entity.moving = state === 'move';
    entity._intent = entity.moving ? 'chase' : 'idle';
    entity.hitIndex = 0;
    if (state === 'howl') this._emit('howl', { id: entity.id, monster: entity.type });
    if (state === 'taunt') this._emit('taunt', { id: entity.id, monster: entity.type });
  }

  _idle(entity, clip) {
    this._state(entity, 'idle', clip ?? entity._definition.idleClip, { loop: true });
    if (entity.type === 'tentacle') entity._groundTimeout = this.time + 5 + 10*this._random();
  }

  _animate(entity) {
    let time = entity.stateTime;
    for (let i = 0; i < entity._queue.length; i++) {
      const clip = entity._queue[i];
      const length = this.duration(entity.type, clip);
      if (time < length || i === entity._queue.length - 1) {
        entity.animation = clip;
        entity.animTime = entity.animLoop && i === entity._queue.length - 1 ? time % length : Math.min(time, length - 0.0001);
        return;
      }
      time -= length;
    }
  }

  _face(entity, target) { entity.facing = Math.atan2(target.z - entity.z, target.x - entity.x); }

  _pickTarget() {
    const selected = this.selectedTarget;
    if (selected) return selected;
    let target = null;
    let best = Infinity;
    for (const monster of this.monsters) {
      if (monster.dead) continue;
      const d = distance(this.player, monster);
      if (d < best) { target = monster; best = d; }
    }
    return target;
  }

  _cancelPlayerAttack() {
    const p = this.player;
    if (p.state === 'attack' && !p._playerHitDone) {
      p.nextAttackAt = this.time; // combat.CancelAttack = ResetCooldown
      this.stats.cancelledAttacks++;
      this._emit('attackcancel', { id: p.id, targetId: p.attackTargetId });
    }
    p.attackTargetId = null;
    p.attackActive = false;
  }

  _playerDecision() {
    const p = this.player;
    if(p.state.startsWith('dash_')||['frozen','thaw'].includes(p.state))return;
    if(p.state==='pickup'&&p.stateTime+EPSILON<6*FIXED_DT)return;
    if(p.state==='electrocute'&&p.stateTime+EPSILON<this.duration('player','shock')+4*FIXED_DT)return;
    if (p.state === 'hit' && this.time + EPSILON < p.stateStarted + p._stateDuration) return;
    if (p.state === 'hit') this._idle(p);
    const moving = Math.hypot(this._move.x, this._move.z) > 0.01;
    if (moving) {
      this._pickupId=null;
      this._cancelPlayerAttack();
      this._attackRequested = false;
      if (p.state !== 'move') this._state(p, 'move', ['run_pre', 'run_loop'], { loop: true });
      p._intent = 'manual';
      p.facing = Math.atan2(this._move.z, this._move.x);
      return;
    }
    if(this._pickupId){
      const drop=this.droppedItems.find(d=>d.id===this._pickupId);
      if(!drop){this._pickupId=null;}
      else if(p.state!=='pickup'){
        if(distance(p,drop)>1.15+EPSILON){
          if(p.state!=='move'||p._intent!=='pickup')this._state(p,'move',['run_pre','run_loop'],{loop:true});
          p._intent='pickup';this._face(p,drop);
        }else this._state(p,'pickup',['pickup','pickup_pst'],{duration:10*FIXED_DT});
        return;
      }
    }
    const wantsAttack = this.attackHeld || this._attackRequested;
    if (p.state === 'move' && (p._intent !== 'approach' || !wantsAttack)) this._idle(p);
    const canChain = p.state !== 'attack' || this.time + EPSILON >= p.stateStarted + (this.weapon.chainFrames??PLAYER_CHAIN_FRAME) * FIXED_DT;
    if (wantsAttack && canChain) {
      const target = this._pickTarget();
      if (!target) return;
      this.targetId = target.id;
      p.targetId = target.id;
      this._face(p, target);
      if (distance(p, target) > this.weapon.range + target.radius) {
        this._cancelPlayerAttack();
        if (p.state !== 'move' || p._intent !== 'approach') {
          this._state(p, 'move', ['run_pre', 'run_loop'], { loop: true });
        }
        p._intent = 'approach';
      } else if (this.time + EPSILON >= p.nextAttackAt) {
        this._state(p, 'attack', this.weapon.attackClips??['atk_pre','atk'], { attack: true });
        p.attackTargetId = target.id;
        p._playerHitDone = false;
        p.nextAttackAt = this.time + PLAYER_COOLDOWN;
        this._attackRequested = false;
        this.stats.attacks++;
        this._emit('attack', { id: p.id, targetId: target.id, weapon: this.weapon.id, itemId:this.inventory.hands?.id??null });
      } else if (p.state === 'move') this._idle(p);
    }
  }

  _playerTimeline() {
    const p = this.player;
    if (p.state === 'dash_pre') {
      if (p.stateTime + EPSILON >= p._stateDuration) this._performDash();
      return;
    }
    if (p.state === 'dash_recover') {
      if (p.stateTime + EPSILON >= p._stateDuration) { this._idle(p); this._emit('dashend',{id:p.id}); }
      return;
    }
    if(p.state==='pickup'){
      if(p.stateTime+EPSILON>=6*FIXED_DT&&this._pickupId)this._finishPickup();
      if(p.stateTime+EPSILON>=10*FIXED_DT)this._idle(p);
      return;
    }
    if(p.state==='electrocute'){
      if(p.stateTime+EPSILON>=p._stateDuration)this._idle(p);
      return;
    }
    if(['item_in','item_out'].includes(p.state)) {
      if(p.stateTime+EPSILON>=p._stateDuration)this._idle(p);
      return;
    }
    if (p.state !== 'attack') return;
    if (!p._playerHitDone && p.stateTime + EPSILON >= PLAYER_HIT_FRAME * FIXED_DT) {
      p._playerHitDone = true;
      const target = this.monsters.find(m => m.id === p.attackTargetId);
      if (target && !target.dead && distance(p, target) <= this.weapon.hitRange + target.radius + EPSILON) {
        let amount = this.baseDamage * p._definition.damageMultiplier;
        if (this.weapon.electric && target._definition.wet) amount *= 1 + this.weapon.wetBonus;
        this.stats.hits++;
        this._damage(target, amount, p, {electric:this.weapon.electric && !!target._definition.wet});
        this._battlebornHit(target);
      } else {
        this.stats.misses++;
        this._emit('miss', { id: p.id, targetId: p.attackTargetId });
      }
    }
    if (p.stateTime + EPSILON >= (this.weapon.chainFrames??PLAYER_CHAIN_FRAME) * FIXED_DT) p.attackActive = false;
    if (p.stateTime + EPSILON >= p._stateDuration) this._idle(p);
  }

  _monsterDecision(monster) {
    if(deerclopsDecision(this,monster)||extraMonsterDecision(this,monster))return;
    if (monster.type === 'tentacle') { this._tentacleDecision(monster); return; }
    if (this.time + EPSILON < monster.nextBrainAt) return;
    do { monster.nextBrainAt += monster._definition.brainPeriod ?? 0.125; } while (monster.nextBrainAt <= this.time + EPSILON);
    const definition = monster._definition;
    if (monster._newTarget) {
      monster._newTarget=false;
      if (this._random()<0.3) { this._state(monster,'howl','howl'); return; }
    }
    if (monster.type==='knight' && (monster.state==='shock_to_stun' || monster.state.startsWith('stun_'))) {
      if(monster.state==='stun_pst' && monster.stateTime+EPSILON>=30*FIXED_DT) this._idle(monster);
      else return;
    }
    const range = definition.attackRange + this.player.radius;
    const d = distance(monster, this.player);
    if (['electrocute','electrocute_pst','howl','taunt','attack_post','dead'].includes(monster.state)) return;
    // Release of busy and attack are different in the original graphs.
    if (monster.state === 'attack') {
      const freeFrame = monster.type === 'tallbird' ? 14 : monster.type === 'knight' ? 28 : Infinity;
      if (monster.stateTime + EPSILON < freeFrame*FIXED_DT) return;
      if (monster.type === 'tallbird' && d <= range) return;
      this._idle(monster);
    }
    if (monster.state === 'hit') {
      if (['spider','killerbee','werepig'].includes(monster.type)) return;
      if (monster.type === 'knight' && monster.stateTime + EPSILON < 11*FIXED_DT) {
        if (d <= range && this.time + EPSILON >= monster.nextAttackAt) monster._queuedAttack = true;
        return;
      }
    }
    const cooldown = this.time + EPSILON < monster.nextAttackAt;
    if (definition.dodgeStart && cooldown && monster.state !== 'hit') {
      const retreat = monster._intent === 'retreat' ? d < definition.dodgeStop : d < definition.dodgeStart;
      if (retreat) {
        if (monster.state !== 'move') this._state(monster,'move',[definition.movePre,definition.moveClip].filter(Boolean),{loop:true});
        monster._intent='retreat';
      } else this._idle(monster);
      return;
    }
    if (d <= range && !cooldown) { this._startMonsterAttack(monster); return; }
    if (monster.state === 'hit') return;
    this._face(monster, this.player);
    const stopDistance = monster.state === 'move' ? monster.radius + this.player.radius + 0.1 : range;
    if (d > stopDistance) {
      if (monster.state !== 'move') this._state(monster,'move',[definition.movePre,definition.moveClip].filter(Boolean),{loop:true});
      monster._intent = 'chase';
    } else if (monster.state === 'move') this._idle(monster);
  }

  _startMonsterAttack(monster) {
    this._face(monster, this.player);
    monster._queuedAttack=false;
    this._state(monster, 'attack', monster._definition.attackClips, { attack: true });
    monster.nextAttackAt = this.time + monster._definition.cooldown;
    monster.attackTargetId = 'player';
    this._emit('attack', { id: monster.id, targetId: 'player', monster: monster.type });
  }

  _combatTarget(entity) { return this.entities.find(e=>e.id===entity.targetId && !e.dead) ?? null; }

  _tentacleDecision(monster) {
    // No tentacle brain exists. Its combat component acquires on a fixed,
    // randomly seeded 1.5–2.5 s period and validates an existing target every 1 s.
    let target=this._combatTarget(monster);
    if (target && this.time + EPSILON >= monster._keepTargetAt) {
      monster._keepTargetAt=this.time+1;
      if (distance(monster,target)>6) { monster.targetId=null; target=null; }
    }
    if (this.time + EPSILON >= monster._retargetAt) {
      monster._retargetAt+=monster._retargetPeriod;
      if (!target) {
        target=this.entities.filter(e=>!e.dead && e!==monster && e.type!=='tentacle' && distance(e,monster)<=4)
          .sort((a,b)=>distance(a,monster)-distance(b,monster))[0]??null;
        if (target) {
          monster.targetId=target.id;
          monster._keepTargetAt=this.time+1;
          if (['idle','rumble','ground_post','breach_post'].includes(monster.state)) {
            this._state(monster,'emerge',['breach_pre','breach_loop'],{loop:true});
          }
        }
      }
    }
    monster.rangeVisible=!!target || distance(monster,this.player)<=6;
  }

  _tentacleTimeline(monster) {
    const target=this._combatTarget(monster);
    if (monster.state==='emerge') {
      // taunt waits beyond .75 s AND for CanAttack (range 4+target radius,
      // combat cooldown). A target lingering between 4.5 and 6 keeps warning.
      if (monster.stateTime > 0.75+EPSILON && target &&
          distance(monster,target)<=monster.attackRange+target.radius && this.time+EPSILON>=monster.nextAttackAt) {
        this._face(monster,target);
        this._state(monster,'attack_pre','atk_pre',{attack:true});
        monster.nextAttackAt=this.time+monster._definition.cooldown;
      } else if (!target) this._state(monster,'breach_post','breach_pst');
    } else if (monster.state==='attack_pre' && monster.stateTime+EPSILON>=monster._stateDuration) {
      this._startTentacleLoop(monster);
    } else if (monster.state==='attack') {
      this._monsterHitTimeline(monster,target);
      if (monster.stateTime+EPSILON>=18*FIXED_DT) monster.attackActive=false;
      if (monster.stateTime+EPSILON>=monster._stateDuration) {
        if (target) this._startTentacleLoop(monster);
        else this._state(monster,'retract','atk_pst');
      }
    } else if (monster.state==='hit' && monster.stateTime+EPSILON>=monster._stateDuration) {
      // Critical counterattack path: never go through idle/taunt/attack_pre.
      this._startTentacleLoop(monster);
    } else if (['idle','rumble'].includes(monster.state) && this.time+EPSILON>=monster._groundTimeout) {
      if (monster.state==='idle') {
        this._state(monster,'rumble',['ground_pre','ground_loop'],{loop:true});
        monster._groundTimeout=this.time+5+10*this._random();
      } else this._state(monster,'ground_post','ground_pst');
    } else if (['ground_post','breach_post','retract'].includes(monster.state) && monster.stateTime+EPSILON>=monster._stateDuration) {
      this._idle(monster);
      if (target) this._state(monster,'emerge',['breach_pre','breach_loop'],{loop:true});
    }
  }

  _monsterHitTimeline(monster,target=this.player) {
    const definition=monster._definition;
    for (;monster.hitIndex<definition.hitFrames.length;monster.hitIndex++) {
      if (monster.stateTime+EPSILON<definition.hitFrames[monster.hitIndex]*FIXED_DT) break;
      if (target && !target.dead && distance(monster,target)<=definition.hitRange+target.radius+EPSILON) this._damage(target,definition.damage,monster);
      else this._emit('miss',{id:monster.id,targetId:target?.id??null});
    }
  }

  _monsterTimeline(monster) {
    if(deerclopsTimeline(this,monster))return;
    if (monster.state==='electrocute' && monster.stateTime+EPSILON>=monster._stateDuration) {
      if(monster.type==='knight' && !monster._shockWasStunned) {
        monster._stunHits=0; this._state(monster,'shock_to_stun','shock_to_stun');
      } else this._state(monster,'electrocute_pst',monster._shockWasStunned?'stun_shock_pst':'shock_pst');
      return;
    }
    if (monster.state==='electrocute_pst' && monster.stateTime+EPSILON>=monster._stateDuration) {
      if (monster.type==='tentacle') this._startTentacleLoop(monster);
      else if(monster.type==='knight' && monster._shockWasStunned) this._state(monster,'stun_loop','stun_loop');
      else this._idle(monster);
      return;
    }
    if(monster.type==='knight' && (monster.state==='shock_to_stun' || monster.state.startsWith('stun_'))) {
      if(monster.state==='stun_loop') {
        while(monster.hitIndex<2 && monster.stateTime+EPSILON>=[12,24][monster.hitIndex]*FIXED_DT) {
          monster._stunHits++;monster.hitIndex++;
        }
      }
      if(monster.state==='stun_hit' && monster.stateTime+EPSILON>=6*FIXED_DT && monster._stunHits>=4) {
        this._state(monster,'stun_pst','stun_pst');
      } else if(monster.stateTime+EPSILON>=monster._stateDuration) {
        if(monster.state==='stun_loop') this._state(monster,'stun_pst','stun_pst');
        else if(monster.state==='stun_pst') this._idle(monster);
        else this._state(monster,'stun_loop','stun_loop');
      }
      return;
    }
    if(extraMonsterTimeline(this,monster))return;
    if (monster.type==='tentacle') { this._tentacleTimeline(monster); return; }
    if (monster.state==='attack') {
      this._monsterHitTimeline(monster);
      if (monster.type==='werepig' && monster.stateTime+EPSILON>=21*FIXED_DT) monster.moving=false;
      if (monster.stateTime+EPSILON>=monster._stateDuration) {
        if (monster.type==='hound') {
          if (this._random()<0.333) this._state(monster,'taunt','taunt');
          else this._state(monster,'attack_post','atk_pst');
        } else this._idle(monster);
      }
    } else if (monster.type==='knight' && monster.state==='hit' && monster._queuedAttack && monster.stateTime+EPSILON>=11*FIXED_DT) {
      this._startMonsterAttack(monster);
    } else if (['hit','attack_post','taunt','howl'].includes(monster.state) && monster.stateTime+EPSILON>=monster._stateDuration) {
      if (monster.state==='taunt' && monster.type==='hound' && this._random()<0.333) this._state(monster,'taunt','taunt');
      else this._idle(monster);
    }
  }

  _startTentacleLoop(monster) {
    this._state(monster,'attack',monster._definition.attackClips,{attack:true});
    monster.attackTargetId=monster.targetId;
    this._emit('attack',{id:monster.id,targetId:monster.targetId,monster:monster.type});
  }

  _integrateMovement() {
    for (const entity of this.entities) {
      if (entity.dead) continue;
      if(deerclopsMovement(this,entity)||extraMonsterMovement(this,entity))continue;
      if (entity.type==='werepig' && entity.state==='attack') {
        // SGwerepig motor velocity is facing-locked, including its 15f windup.
        const f=Math.round(entity.stateTime/FIXED_DT);
        const speed=f<15?3:f<17?8:f<18?4:f<19?2:f<20?1:f<21?0.5:0;
        entity.moving=speed>0;
        entity.x+=Math.cos(entity.facing)*speed*FIXED_DT;
        entity.z+=Math.sin(entity.facing)*speed*FIXED_DT;
        this._bound(entity); continue;
      }
      if (entity.state !== 'move') continue;
      let dx, dz;
      if (entity === this.player && entity._intent === 'manual') {
        dx = this._move.x; dz = this._move.z;
      } else {
        const target=entity===this.player?(entity._intent==='pickup'?this.droppedItems.find(d=>d.id===this._pickupId):this._pickTarget()):this.player;
        if (!target || target.dead) continue;
        dx = target.x - entity.x; dz = target.z - entity.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.0001) continue;
        const retreat=entity._intent==='retreat';
        const stop=retreat?0:entity===this.player?(entity._intent==='pickup'?1.15:this.weapon.range+target.radius-0.03):entity.radius+target.radius+0.05;
        if (length <= stop) continue;
        let speed = entity.speed;
        if (entity.type === 'spider' && entity.stateTime < 6 * FIXED_DT) speed = 3;
        if (entity.type === 'leif' && entity.stateTime < 19 * FIXED_DT &&
            (entity.stateTime < 11 * FIXED_DT || entity.stateTime >= 17 * FIXED_DT)) speed = 0;
        if (entity.type==='knight') {
          const pre=this.duration('knight','walk_pre');
          const cycle=(entity.stateTime-pre)/FIXED_DT;
          const f=((cycle%20)+20)%20;
          if (entity.stateTime<pre || f<7-EPSILON || f>=19-EPSILON) speed=0;
        }
        const amount = Math.min(speed * FIXED_DT, retreat ? Math.max(0,entity._definition.dodgeStop-length) : length - stop)*(retreat?-1:1);
        dx = dx / length * amount; dz = dz / length * amount;
        entity.x += dx; entity.z += dz;
        entity.facing = Math.atan2(dz, dx);
        this._bound(entity);
        continue;
      }
      entity.x += dx * entity.speed * FIXED_DT;
      entity.z += dz * entity.speed * FIXED_DT;
      this._bound(entity);
    }
  }

  _bound(entity) {
    const radius = Math.hypot(entity.x, entity.z);
    const limit = this.bounds - entity.radius;
    if (radius > limit) { entity.x *= limit / radius; entity.z *= limit / radius; }
  }

  _resolveCollisions() {
    const alive = this.entities.filter(e => !e.dead);
    for (let iteration = 0; iteration < 2; iteration++) {
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        // Flyers collide with other flyers, not ground characters.
        if(a._definition.collisionless||b._definition.collisionless||!!a._definition.flying!==!!b._definition.flying)continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const minimum = a.radius + b.radius;
        if (d >= minimum || (!a.moving && !b.moving)) continue;
        if (d < 0.00001) { dx = 1; dz = 0; d = 1; }
        const overlap = minimum - Math.hypot(b.x - a.x, b.z - a.z);
        const wa = Number.isFinite(a.mass) ? 1 / a.mass : 0;
        const wb = Number.isFinite(b.mass) ? 1 / b.mass : 0;
        if (wa + wb === 0) continue;
        dx /= d; dz /= d;
        a.x -= dx * overlap * wa / (wa + wb); a.z -= dz * overlap * wa / (wa + wb);
        b.x += dx * overlap * wb / (wa + wb); b.z += dz * overlap * wb / (wa + wb);
        this._bound(a); this._bound(b);
      }
    }
  }

  _damage(target, rawAmount, source, meta = {}) {
    if (target.dead || rawAmount <= 0) return;
    const amount=rawAmount*(target===this.player?1-target._definition.absorption:extraDamageMultiplier(target));
    const actual = Math.min(target.hp, amount);
    target.hp = Math.max(0, target.hp - amount);
    target.flashUntil = this.time + 0.15;
    if (target === this.player) {
      this.stats.hitsTaken++;
      this.stats.damageTaken += actual;
    } else if (source===this.player) this.stats.damageDealt += actual;
    this._emit('hit', { id: target.id, sourceId: source.id, sourceX:source.x,sourceZ:source.z,targetId: target.id,
      damage: amount, actualDamage: actual, hp: target.hp, x: target.x, z: target.z,
      electric: !!meta.electric, skill: meta.skill });
    extraOnHitOther(this,source,target,meta);
    if (target.hp <= 0) {
      target.dead = true;
      target.rangeVisible = false;
      this._state(target, 'dead', 'death');
      if (target !== this.player && source===this.player) this.stats.kills++;
      if (this.targetId === target.id) this.targetId = null;
      this._emit('death', { id: target.id, sourceId: source.id, monster: target.type });
      return;
    }
    extraOnDamaged(this,target,amount,source,meta);
    if(target.type==='tentacle' && target.targetId) {
      if(target.targetId===source.id || !(target._lastAttacker===target.targetId && this.time-(target._lastAttackedAt??-Infinity)<=2)) {
        target.targetId=source.id;target._lastAttacker=source.id;target._lastAttackedAt=this.time;
      }
    }
    if(!breakPlayerFreeze(this,target,source))this._hitReaction(target,meta);
  }

  _battlebornHit(target, weaponDamage=this.baseDamage) {
    // components/battleborn.lua: weapon base damage (not the character multiplier)
    // and the victim's unmodified combat damage determine Wigfrid's stored healing.
    if (weaponDamage <= 0 || this.player.dead) return;
    const since = this.time - this._battlebornAt - 3;
    if (since >= 5) this._battleborn = 0;
    else if (since > 0) this._battleborn *= 1 - (since / 5) ** 2;
    const victimDamage = target._definition.rawDamage ?? target._definition.damage;
    this._battleborn += clamp(victimDamage * 0.25 * weaponDamage / target.maxHp, 0.33, 2);
    this._battlebornAt = this.time;
    if (this._battleborn > 1) {
      const healed = Math.min(this._battleborn, this.player.maxHp - this.player.hp);
      this.player.hp += healed;
      this.stats.healing += healed;
      if (healed > 0) this._emit('heal', { id: 'player', amount: healed, hp: this.player.hp });
      this._battleborn = 0;
    }
  }

  _hitReaction(entity,meta={}) {
    if (entity === this.player) {
      // lunge_start is nointerrupt, not invincible: HP was already reduced.
      if (entity.state==='dash_pre') return;
      if(entity.state==='electrocute')return;
      if (entity.state==='dash_recover') this._emit('dashend',{id:entity.id,interrupted:true});
      this._cancelPlayerAttack();this._pickupId=null;
      if(meta.electric){this._state(entity,'electrocute',['shock','shock_pst']);this._attackRequested=false;return;}
      this._state(entity, 'hit', 'hit', { duration: 6 * FIXED_DT });
      this._attackRequested = false;
      return;
    }
    if(extraMonsterHitReaction(this,entity,meta))return;
    const type = entity.type;
    const stunned=type==='knight' && (entity.state==='shock_to_stun' || entity.state.startsWith('stun_')) &&
      !(entity.state==='stun_pst' && entity.stateTime>=14*FIXED_DT);
    const noShock=(type==='knight' && entity.state==='shock_to_stun' && entity.stateTime<7*FIXED_DT) || type==='tentacle' && ['idle','rumble','ground_post','breach_post','emerge','retract'].includes(entity.state);
    if (meta.electric && !noShock && !entity.state.startsWith('electrocute') && this.time+EPSILON >= (entity._electrocuteUntil??0)) {
      const resistance=type==='leif'||entity._definition.epic?(entity._shockResistance??0):0;
      entity._shockResistance=resistance+(type==='leif'||entity._definition.epic?1:0);
      entity._electrocuteUntil=this.time+2+2*this._random()+entity._shockResistance;
      entity.lastHitReaction=this.time;
      entity._shockWasStunned=stunned;
      this._state(entity,'electrocute',stunned?'stun_shock_loop':'shock_loop',{loop:true,duration:0.8});
      this._emit('electrocute',{id:entity.id,duration:0.8});
      return;
    }
    if (entity.state.startsWith('electrocute')) return;
    if(stunned) {
      const interruptible=entity.state==='stun_loop' ||
        (entity.state==='shock_to_stun' && entity.stateTime>=7*FIXED_DT) ||
        (entity.state==='stun_hit' && entity.stateTime>=6*FIXED_DT) ||
        (entity.state==='stun_pst' && entity._stunHits<4 && entity.stateTime<10*FIXED_DT);
      if(interruptible && this.time-entity.lastHitReaction+EPSILON>=0.75) {
        entity._stunHits++;entity.lastHitReaction=this.time;this._state(entity,'stun_hit','stun_hit');
      }
      return;
    }
    if(deerclopsHitReaction(this,entity,meta))return;
    if (type === 'spider' || type==='killerbee') {
      this._state(entity, 'hit', 'hit');
    } else if (type === 'hound') {
      if (entity.state !== 'attack') this._state(entity, 'hit', 'hit');
    } else if (type === 'tentacle') {
      if (entity.state!=='hit' && entity.state!=='attack_pre' &&
          !(entity.state==='attack' && entity.stateTime+EPSILON<18*FIXED_DT)) this._state(entity,'hit','hit');
    } else {
      const inCooldown=this.time+EPSILON<entity.nextAttackAt;
      const recovery=type==='knight' && inCooldown ? 2 : entity._definition.hitRecovery;
      let recovered=this.time-entity.lastHitReaction+EPSILON>=recovery;
      if (entity.state==='idle' && inCooldown && type!=='knight') recovered=true;
      if (type==='werepig') {
        if (recovered) entity._hitreactCount=1;
        else if ((entity._hitreactCount??1)<2) { recovered=true; entity._hitreactCount=2; }
      }
      const interruptible = ['idle','move','howl'].includes(entity.state) ||
        (type==='werepig' && entity.state==='attack' && entity.stateTime+EPSILON>=26*FIXED_DT) ||
        (type==='knight' && ((entity.state==='attack' && entity.stateTime+EPSILON>=28*FIXED_DT) ||
                            (entity.state==='hit' && entity.stateTime+EPSILON>=11*FIXED_DT))) ||
        (type==='tallbird' && entity.state==='attack' && entity.stateTime>=14*FIXED_DT);
      if (recovered && interruptible) {
        entity.lastHitReaction=this.time;
        this._state(entity,'hit','hit');
      }
    }
  }
}
