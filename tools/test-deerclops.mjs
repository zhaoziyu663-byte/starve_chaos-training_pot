import assert from 'node:assert/strict';
import {
  DEERCLOPS, DEERCLOPS_ANIMATION_FRAMES, deerclopsDecision,
  deerclopsTimeline, deerclopsHitReaction, spawnDeerclopsIce,
  updateDeerclopsHazards, applyColdness, updatePlayerCold, breakPlayerFreeze,
} from '../dist/deerclops.js';

const DT = 1 / 30;
const tests = [];
const test = (name, run) => tests.push([name, run]);
const near = (a, b, tolerance = 1e-7) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function harness(seed = 337) {
  const w = { time: 0, ticks: 0, status: 'running', hazards: [], events: [], hits: [], animationDurations: {},
    _rng: seed,
    _random() { let n = this._rng; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; this._rng = n >>> 0; return this._rng / 4294967296; },
    _emit(type, data) { this.events.push({ type, time: this.time, ...data }); },
    _state(e, state, clips, options = {}) {
      e.state = state; e.stateTime = 0; e.stateStarted = this.time;
      e._queue = Array.isArray(clips) ? clips : [clips]; e.animation = e._queue[0];
      e.animLoop = !!options.loop; e.attackActive = !!options.attack; e.moving = state === 'move';
      const frames = e.type === 'deerclops' ? DEERCLOPS_ANIMATION_FRAMES : { hit: 21, frozen: 6, frozen_loop_pst: 6 };
      e._stateDuration = options.duration ?? (options.loop ? Infinity : e._queue.reduce((n, clip) => n + (frames[clip] ?? 30) * DT, 0));
    },
    _face(e, t) { e.facing = Math.atan2(t.z - e.z, t.x - e.x); },
    _idle(e) { this._state(e, 'idle', e.type === 'deerclops' ? 'idle_loop' : 'idle_loop', { loop: true }); },
    _damage(target, amount, source, meta) {
      this.hits.push({ targetId: target.id, sourceId: source.id, amount, time: this.time, meta });
      target.hp -= amount;
      target.dead = target.hp <= 0;
      if (target === this.player && !breakPlayerFreeze(this, target) && !target.dead) this._state(target, 'hit', 'hit', { duration: 6 * DT });
    },
  };
  w.player = { id: 'player', type: 'player', x: 8, z: 0, radius: 0.5,
    hp: 10000, maxHp: 10000, dead: false, state: 'idle', stateTime: 0, stateStarted: 0, nextAttackAt: 0 };
  w.deer = { id: 'deerclops-1', type: 'deerclops', x: 0, z: 0, radius: 0.5,
    hp: 4000, maxHp: 4000, dead: false, state: 'idle', stateTime: 0, stateStarted: 0,
    nextAttackAt: 0, nextBrainAt: 0, facing: 0, lastHitReaction: -Infinity,
    _definition: DEERCLOPS };
  w.entities = [w.player, w.deer];
  return w;
}
function frame(w) {
  updatePlayerCold(w);
  deerclopsDecision(w, w.deer);
  w.time = ++w.ticks * DT;
  for (const e of w.entities) e.stateTime = w.time - e.stateStarted;
  deerclopsTimeline(w, w.deer);
  updateDeerclopsHazards(w);
}
const frames = (w, count) => { for (let i = 0; i < count; i++) frame(w); };

test('No false direct attack: frame 31 spawns ice; frame 34 is earliest AOE', () => {
  const w = harness();
  frames(w, 30);
  assert.equal(w.hazards.length, 0);
  assert.equal(w.hits.length, 0);
  frame(w);
  assert(w.hazards.length >= 20 && w.hazards.length <= 28);
  assert.equal(w.hazards.filter(h => h.active).length, 1);
  frames(w, 2);
  assert.equal(w.hits.length, 0);
  frames(w, 6);
  assert.equal(w.hits.length, 1);
  assert(w.hits[0].time >= 34 * DT - 1e-8);
  assert.equal(w.hits[0].amount, 75);
});

test('Spike geometry has three exact center points, a front fan and a close rear sweep', () => {
  const w = harness();
  spawnDeerclopsIce(w, w.deer);
  const points = w.hazards;
  const center = points.filter(h => h.kind === 'center').sort((a, b) => a.x - b.x);
  assert.equal(center.length, 3);
  center.forEach((h, i) => { near(h.x, 8 / 3 * (i + 1)); near(h.z, 0); });
  const front = points.filter(h => h.kind === 'front');
  assert(front.length >= 12 && front.length <= 17);
  for (const h of front) {
    assert(h.distanceFromOwner <= 8);
    assert(Math.abs(Math.atan2(h.z, h.x)) <= 35 * Math.PI / 180 + 1e-8);
  }
  const rear = points.filter(h => h.kind === 'rear');
  assert(rear.length >= 5 && rear.length <= 8);
  for (const h of rear) {
    assert(h.distanceFromOwner >= 1 && h.distanceFromOwner <= 3);
    assert(Math.abs(Math.atan2(h.z, h.x)) >= 35 * Math.PI / 180 - 1e-8);
  }
  assert.equal(points.filter(h => h.big).length, 4);
  assert.equal(points.filter(h => h.sound).length, 6);
  near(Math.min(...points.map(h => h.spawnAt)), 0);
  near(Math.max(...points.map(h => h.spawnAt)), 0.25);
});

test('Overlapping spikes in one swing hit a victim once, including collateral monsters', () => {
  const w = harness();
  w.player.x = 2;
  const spider = { id: 'spider-1', type: 'spider', x: 2, z: 0, radius: 0.5, hp: 1000, dead: false };
  w.entities.push(spider);
  spawnDeerclopsIce(w, w.deer);
  for (let i = 0; i < 20; i++) { w.time = i * DT; updateDeerclopsHazards(w); }
  assert.equal(w.hits.filter(h => h.targetId === 'player').length, 1);
  assert.equal(w.hits.filter(h => h.targetId === spider.id).length, 1);
  assert.equal(spider.hp, 850);
  assert.equal(w.hits.filter(h => h.targetId === w.deer.id).length, 0);
});

test('AOE uses each spike position and victim radius, not a radius-8 circle', () => {
  for (const [x, z, shouldHit] of [[9.4, 0, true], [9.6, 0, false], [-8, 0, false], [0, 8, false]]) {
    const w = harness();
    w.player.x = x; w.player.z = z;
    spawnDeerclopsIce(w, w.deer);
    for (let i = 0; i < 15; i++) { w.time = i * DT; updateDeerclopsHazards(w); }
    assert.equal(w.hits.length > 0, shouldHit, `position ${x},${z}`);
  }
});

test('Retreat between spike appearance and damage avoids the attack', () => {
  const w = harness();
  frames(w, 31);
  assert(w.hazards.some(h => h.active));
  w.player.x = 11;
  frames(w, 12);
  assert.equal(w.hits.length, 0);
  assert.equal(w.events.filter(e => e.type === 'miss').length, 1);
});

test('Early aiming follows within 45 degrees and locks at frame 16', () => {
  const w = harness();
  frame(w);
  w.player.x = 8 * Math.cos(20 * Math.PI / 180); w.player.z = 8 * Math.sin(20 * Math.PI / 180);
  frame(w);
  near(w.deer.facing, 20 * Math.PI / 180);
  frames(w, 14);
  w.player.x = 0; w.player.z = 8;
  frames(w, 15);
  near(w.deer.facing, 20 * Math.PI / 180);
  const center = w.hazards.find(h => h.kind === 'center');
  near(Math.atan2(center.z, center.x), 20 * Math.PI / 180);
});

test('A target leaving the early tracking cone permanently drops tracking for that swing', () => {
  const w = harness();
  frame(w); w.player.x = 0; w.player.z = 8; frame(w);
  w.player.x = 8; w.player.z = 1; frame(w);
  near(w.deer.facing, 0);
  assert.equal(w.deer._deerTracking, false);
});

test('Attack cannot be interrupted before frame 51; recovery also gates repeated flinches', () => {
  const w = harness();
  frames(w, 30);
  deerclopsHitReaction(w, w.deer);
  assert.equal(w.deer.state, 'attack');
  frames(w, 21);
  deerclopsHitReaction(w, w.deer);
  assert.equal(w.deer.state, 'hit');
  const started = w.deer.stateStarted;
  w.time += 0.4; w.deer.stateTime = 0.4;
  deerclopsHitReaction(w, w.deer);
  assert.equal(w.deer.stateStarted, started);
});

test('Attack cooldown is four seconds, independent of its 59-frame animation', () => {
  const w = harness();
  frames(w, 120);
  assert.equal(w.events.filter(e => e.type === 'attack').length, 1);
  frame(w);
  assert.equal(w.events.filter(e => e.type === 'attack').length, 2);
});

test('Each ice sprite expires after its own extracted clip length', () => {
  const w = harness();
  spawnDeerclopsIce(w, w.deer);
  updateDeerclopsHazards(w);
  assert(w.hazards.find(h => h.active).expiresAt <= 28 * DT + 1e-8);
  for (let i = 1; i < 40; i++) { w.time = i * DT; updateDeerclopsHazards(w); }
  assert.equal(w.hazards.length, 0);
});

test('Coldness decays once per three seconds; ordinary four-second attacks need accumulation', () => {
  const w = harness();
  applyColdness(w, w.player, 2, w.deer);
  assert.equal(w.player.frozen, undefined);
  w.time = 3; updatePlayerCold(w); assert.equal(w.player.coldness, 1);
  w.time = 4; applyColdness(w, w.player, 2, w.deer); assert.equal(w.player.coldness, 3);
  w.time = 7; updatePlayerCold(w); assert.equal(w.player.coldness, 2);
  w.time = 8; applyColdness(w, w.player, 2, w.deer);
  assert.equal(w.player.state, 'frozen'); assert.equal(w.player.frozen, true);
});

test('Freeze has three seconds frozen, three seconds thawing, then ten frames hit recovery', () => {
  const w = harness();
  applyColdness(w, w.player, 4, w.deer);
  w.time = 2.99; updatePlayerCold(w); assert.equal(w.player.state, 'frozen');
  w.time = 3; updatePlayerCold(w); assert.equal(w.player.state, 'thaw');
  assert.equal(w.player.frozen, true);
  w.time = 6; updatePlayerCold(w); assert.equal(w.player.state, 'hit');
  assert.equal(w.player.frozen, false);
  near(w.player._stateDuration, 10 * DT);
  near(w.player.nextAttackAt, 6.3);
});

test('Damage breaks the existing freeze before the same hit applies new coldness', () => {
  const w = harness();
  applyColdness(w, w.player, 4, w.deer);
  w.time = 1;
  w._damage(w.player, 75, w.deer);
  assert.equal(w.player.frozen, false);
  assert.equal(w.player.coldness, 0);
  near(w.player._stateDuration, 10 * DT);
  applyColdness(w, w.player, 2, w.deer);
  assert.equal(w.player.coldness, 2);
  assert.equal(w.player.frozen, false);
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} Deerclops checks passed`);
if (failed) process.exitCode = 1;
