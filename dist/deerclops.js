/* Ordinary, non-Winter's Feast Deerclops. Audited against DST 762172.
 * SGdeerclops.lua:35-175, 320-330, 377-397, 703-744, 855-929.
 * Each swing schedules discrete ice-spike AOE tasks. It is NOT a circular hit
 * at frame 35. Coordinates use the trainer's atan2(z,x) facing convention.
 */
const DT = 1 / 30;
const EPS = 1e-8;
const DEG = Math.PI / 180;
export const DEERCLOPS = Object.freeze({
  id: 'deerclops', name: '独眼巨鹿', hp: 4000, damage: 75, rawDamage: 150,
  speed: 3, radius: 0.5, mass: 1000, attackRange: 8, hitRange: 8,
  cooldown: 4, hitFrames: [], attackClips: ['atk'], movePre: 'walk_pre',
  moveClip: 'walk_loop', idleClip: 'idle_loop', hitRecovery: 0.75,
  healthOffset: 310, renderScale: 1.65, boss: true, epic: true,
  freezepower: 2, brainPeriod: 0.125,
});

// Replaced by the renderer's extracted animation manifest when available.
export const DEERCLOPS_ANIMATION_FRAMES = Object.freeze({
  idle_loop: 57, walk_pre: 8, walk_loop: 48, walk_pst: 14,
  atk: 59, hit: 15, death: 68, taunt: 52, shock_loop: 6, shock_pst: 9,
});
export const DEERCLOPS_ICE_ANIMATION_FRAMES = Object.freeze({
  spike1: 28, spike2: 28, spike3: 28, spike4: 26,
  spike_big1: 26, spike_big2: 28, spike_big3: 28, spike_big4: 28,
});

export const PLAYER_FREEZE = Object.freeze({ resistance: 4, wearOff: 3, thawTime: 3, breakHitFrames: 10 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const int = (world, a, b) => a + Math.floor(world._random() * (b - a + 1));
function emit(world, type, data) { world._emit?.(type, data); }
function clipDuration(world, type, clip, fallbackFrames = 30) {
  return world.animationDurations?.[type]?.[clip] ?? fallbackFrames * DT;
}

function beginAttack(world, entity) {
  world._face(entity, world.player);
  world._state(entity, 'attack', ['atk'], { attack: true });
  entity.nextAttackAt = world.time + DEERCLOPS.cooldown;
  entity.attackTargetId = world.player.id;
  entity._deerTracking = true;
  entity._deerIceSpawned = false;
  entity._deerPendingAttack = false;
  emit(world, 'attack', { id: entity.id, targetId: world.player.id, monster: 'deerclops' });
}

export function deerclopsDecision(world, entity) {
  if (entity.type !== 'deerclops') return false;
  if (entity.dead || world.player.dead) return true;
  if (entity.state === 'attack') {
    if (entity._deerTracking && entity.stateTime < 16 * DT) {
      const desired = Math.atan2(world.player.z - entity.z, world.player.x - entity.x);
      if (angleDiff(entity.facing, desired) < Math.PI / 4) entity.facing = desired;
      else entity._deerTracking = false;
    }
    if (entity.stateTime + EPS < 56 * DT) return true;
  }
  if (['electrocute', 'electrocute_pst', 'frozen', 'thaw'].includes(entity.state)) return false;
  if (world.time + EPS < (entity.nextBrainAt ?? 0)) return true;
  do { entity.nextBrainAt = (entity.nextBrainAt ?? 0) + 0.125; }
  while (entity.nextBrainAt <= world.time + EPS);
  const range = DEERCLOPS.attackRange + world.player.radius;
  const distance = dist(entity, world.player);
  const ready = world.time + EPS >= entity.nextAttackAt && distance <= range;
  if (entity.state === 'hit' && entity.stateTime + EPS < 10 * DT) {
    if (ready) entity._deerPendingAttack = true;
    return true;
  }
  if (ready) { beginAttack(world, entity); return true; }
  const stop = entity.state === 'move' ? entity.radius + world.player.radius + 0.1 : range;
  if (distance > stop) {
    world._face(entity, world.player);
    if (entity.state !== 'move') world._state(entity, 'move', ['walk_pre', 'walk_loop'], { loop: true });
    entity._intent = 'chase';
  } else if (entity.state === 'move') world._idle(entity);
  return true;
}

export function deerclopsTimeline(world, entity) {
  if (entity.type !== 'deerclops') return false;
  if (entity.state === 'attack') {
    if (entity.stateTime + EPS >= 16 * DT) entity._deerTracking = false;
    if (!entity._deerIceSpawned && entity.stateTime + EPS >= 31 * DT) {
      entity._deerIceSpawned = true;
      spawnDeerclopsIce(world, entity);
    }
    // Range mod checks state name as well as attack tag, so it stays red here.
    if (entity.stateTime + EPS >= entity._stateDuration) world._idle(entity);
    return true;
  }
  if (entity.state === 'hit') {
    if (entity._deerPendingAttack && entity.stateTime + EPS >= 10 * DT) beginAttack(world, entity);
    else if (entity.stateTime + EPS >= entity._stateDuration) world._idle(entity);
    return true;
  }
  return false;
}

// Ordinary Deerclops walk_pre and walk_loop move at a constant three units/s;
// generic world movement already handles this. No extra movement hook required.
export function deerclopsMovement() { return false; }

export function deerclopsHitReaction(world, entity) {
  if (entity.type !== 'deerclops') return false;
  const interruptible = ['idle', 'move'].includes(entity.state) ||
    (entity.state === 'attack' && entity.stateTime + EPS >= 51 * DT) ||
    (entity.state === 'hit' && entity.stateTime + EPS >= 10 * DT);
  if (interruptible && world.time - (entity.lastHitReaction ?? -Infinity) + EPS >= DEERCLOPS.hitRecovery) {
    entity.lastHitReaction = world.time;
    entity._deerPendingAttack = false;
    world._state(entity, 'hit', 'hit');
  }
  return true;
}

/** Emit the same randomized spike field as SGdeerclops.SpawnIceFx. */
export function spawnDeerclopsIce(world, owner) {
  world.hazards ??= [];
  world._deerSwingSerial = (world._deerSwingSerial ?? 0) + 1;
  const points = [];
  const facing = owner.facing;
  const add = (radius, angle, kind) => points.push({
    x: owner.x + radius * Math.cos(angle), z: owner.z + radius * Math.sin(angle), radius, kind,
  });
  for (let i = 1; i <= 3; i++) add(DEERCLOPS.attackRange / 3 * i, facing, 'center');
  for (let i = 0, count = int(world, 12, 17); i < count; i++) {
    const angle = facing - (int(world, 1, 70) - 35) * DEG;
    add(DEERCLOPS.attackRange * Math.sqrt(world._random()), angle, 'front');
  }
  for (let i = 0, count = int(world, 5, 8); i < count; i++) {
    const angle = facing + Math.PI - (int(world, 1, 290) - 145) * DEG;
    add(2 * world._random() + 1, angle, 'rear');
  }
  points.sort((a, b) => a.radius - b.radius);
  const count = points.length;
  const group = { id: `deer-swing-${world._deerSwingSerial}`, ownerId: owner.id,
    targets: new Set(), remaining: count, originalTargetId: owner.attackTargetId ?? 'player' };
  const delayVariation = 0.25 / (count - 1) * 0.3;
  let nextBig = 1, currentSound = 0;
  for (let i = 1; i <= count; i++) {
    const random = world._random();
    const index = Math.floor(random * random * points.length * 0.6);
    const point = points.splice(index, 1)[0];
    const delay = i === 1 ? 0 : i === count ? 0.25 :
      (i - 1) / (count - 1) * 0.25 + delayVariation * (world._random() - 0.5);
    const soundIndex = Math.floor((i - 1) / (count - 1) * 5);
    const sound = soundIndex >= currentSound;
    if (sound) currentSound = soundIndex + 1;
    const big = Math.floor(i * 4 / count) === nextBig;
    const variation = big ? nextBig++ : null;
    const animation = `${big ? 'spike_big' : 'spike'}${variation ?? 1}`;
    const plannedAt = world.time + delay;
    world.hazards.push({ id: `${group.id}-${i}`, type: 'deerclops_ice', asset: 'deerclops_ice',
      ownerId: owner.id, x: point.x, z: point.z, facing, rotation: facing, scale: 1,
      animation, animTime: 0, animLoop: false, active: false, big, variation,
      radius: 1, spawnAt: plannedAt, startedAt: null, damageAt: Infinity, expiresAt: Infinity,
      kind: point.kind, distanceFromOwner: point.radius, sound,
      _hitDelay: Math.max(0, 3 * DT - delay), _group: group, _damageDone: false,
    });
  }
  emit(world, 'icefield', { id: owner.id, groupId: group.id, count, x: owner.x, z: owner.z, facing });
  return group;
}

/** Call once per simulation tick, after monster timelines, including terminal rounds. */
export function updateDeerclopsHazards(world) {
  if (!world.hazards?.length) return;
  for (const spike of world.hazards) {
    if (spike.type !== 'deerclops_ice') continue;
    if (!spike.active && world.time + EPS >= spike.spawnAt) {
      spike.active = true;
      if (spike.variation == null) {
        spike.variation = int(world, 1, 4);
        spike.animation = `spike${spike.variation}`;
      }
      spike.startedAt = world.time;
      spike.damageAt = world.time + (spike._hitDelay < DT ? 0 : spike._hitDelay);
      spike.expiresAt = world.time + clipDuration(world, 'deerclops_ice', spike.animation,
        DEERCLOPS_ICE_ANIMATION_FRAMES[spike.animation]);
      emit(world, 'icespike', { id: spike.ownerId, hazardId: spike.id, x: spike.x, z: spike.z,
        animation: spike.animation, sound: spike.sound });
    }
    if (!spike.active) continue;
    spike.animTime = Math.max(0, world.time - spike.startedAt);
    if (!spike._damageDone && world.time + EPS >= spike.damageAt) {
      spike._damageDone = true;
      const owner = world.entities.find(e => e.id === spike.ownerId);
      const group = spike._group;
      if (owner && !owner.dead && world.status !== 'dead' && world.status !== 'won') {
        for (const target of world.entities) {
          if (target.dead || target.hp <= 0 || target.type === 'deerclops' ||
              target.flight || target.untargetable || target.invisible || group.targets.has(target.id)) continue;
          const radius = spike.radius + target.radius;
          // The source uses strict '<', not '<='.
          if ((target.x - spike.x) ** 2 + (target.z - spike.z) ** 2 < radius * radius) {
            group.targets.add(target.id);
            world._damage(target, target === world.player ? 75 : 150, owner,
              { ice: true, hazardId: spike.id, groupId: group.id });
            if (!target.dead) applyColdness(world, target, 2, owner);
          }
        }
      }
      group.remaining--;
      if (group.remaining === 0 && group.targets.size === 0 && owner && !owner.dead) {
        emit(world, 'miss', { id: owner.id, targetId: group.originalTargetId, groupId: group.id });
      }
    }
  }
  world.hazards = world.hazards.filter(h => h.type !== 'deerclops_ice' || !h.active || world.time < h.expiresAt - EPS);
}

function unfreeze(world, target, reason) {
  target.frozen = false;
  target.coldness = 0;
  target.coldState = 'normal';
  target.coldDecayAt = Infinity;
  target.frozenUntil = 0;
  if (!target.dead) {
    target.nextAttackAt = Math.max(target.nextAttackAt ?? 0, world.time + 0.3);
    world._state(target, 'hit', 'hit', { duration: PLAYER_FREEZE.breakHitFrames * DT });
  }
  emit(world, 'unfreeze', { id: target.id, reason });
}

/** Player coldness only; NPC damage is simulated, NPC freeze reactions deferred. */
export function applyColdness(world, target, amount, source) {
  if (target !== world.player || target.dead || amount <= 0) return false;
  target.coldness = Math.max(0, (target.coldness ?? 0) + amount);
  target.coldDecayAt = world.time + PLAYER_FREEZE.wearOff;
  emit(world, 'cold', { id: target.id, sourceId: source?.id, coldness: target.coldness });
  if (target.frozen || target.coldness >= PLAYER_FREEZE.resistance) {
    const wasFrozen = target.frozen;
    target.frozen = true;
    target.coldState = 'frozen';
    target.frozenUntil = world.time + PLAYER_FREEZE.wearOff;
    world._cancelPlayerAttack?.();
    world._attackRequested = false;
    world._dashTarget = null;
    world._dashItemId = null;
    world._state(target, 'frozen', 'frozen');
    if (!wasFrozen) emit(world, 'freeze', { id: target.id, sourceId: source?.id });
  }
  return true;
}

/** Called before player decisions. Frozen -> thaw (3 s) -> hit (3 s + 10 f). */
export function updatePlayerCold(world) {
  const player = world.player;
  if (!player) return;
  if (player.dead) { player.frozen = false; player.coldness = 0; return; }
  if (player.frozen) {
    if (world.time + EPS >= player.frozenUntil) {
      if (player.coldState === 'frozen') {
        player.coldState = 'thaw';
        player.coldness = 0;
        player.frozenUntil = world.time + PLAYER_FREEZE.thawTime;
        world._state(player, 'thaw', 'frozen_loop_pst', { loop: true });
        emit(world, 'thaw', { id: player.id });
      } else unfreeze(world, player, 'timeout');
    }
  } else if ((player.coldness ?? 0) > 0 && world.time + EPS >= (player.coldDecayAt ?? Infinity)) {
    const periods = Math.floor((world.time - player.coldDecayAt + EPS) / PLAYER_FREEZE.wearOff) + 1;
    player.coldness = Math.max(0, player.coldness - periods);
    player.coldDecayAt += periods * PLAYER_FREEZE.wearOff;
  }
}

/** Call after player damage, before generic hit reaction. Freezable.damagetobreak=0. */
export function breakPlayerFreeze(world, target) {
  if (target !== world.player || !target.frozen) return false;
  unfreeze(world, target, 'damage');
  return true;
}
