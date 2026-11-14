import assert from 'node:assert/strict';
import { CombatWorld, FIXED_DT } from '../dist/combat.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const frames = (world, count) => { for (let i = 0; i < count; i++) world.step(); };
const worldWith = (type, x = 2, z = 0, options = {}) => new CombatWorld({
  spawns: [{ type, count: 1, x, z }], ...options,
});
function stopEnemy(monster) { monster.nextBrainAt = 1000; monster.nextAttackAt = 1000; }

test('Spear damage lands at frame 8, with Wigfrid multiplier', () => {
  const world = worldWith('leif');
  stopEnemy(world.monsters[0]);
  world.attackHeld = true;
  frames(world, 7);
  assert.equal(world.monsters[0].hp, 3000);
  world.step();
  assert.equal(world.monsters[0].hp, 3000 - 34 * 1.25);
  assert.equal(world.stats.hits, 1);
});

test('Moving before impact cancels damage and resets attack cooldown', () => {
  const world = worldWith('leif');
  stopEnemy(world.monsters[0]);
  world.attackHeld = true;
  frames(world, 7);
  world.setMove(0, 1);
  world.step();
  assert.equal(world.monsters[0].hp, 3000);
  assert.equal(world.stats.cancelledAttacks, 1);
  world.setMove(0, 0);
  world.step();
  assert.equal(world.stats.attacks, 2);
  assert.equal(world.player.state, 'attack');
});

test('Moving after impact preserves damage and existing cooldown', () => {
  const world = worldWith('leif');
  stopEnemy(world.monsters[0]);
  world.attackHeld = true;
  frames(world, 8);
  const hp = world.monsters[0].hp;
  world.setMove(0, 1);
  world.step();
  assert.equal(world.monsters[0].hp, hp);
  assert.equal(world.stats.cancelledAttacks, 0);
  world.setMove(0, 0);
  frames(world, 2);
  assert.equal(world.stats.attacks, 1);
  frames(world, 2);
  assert.equal(world.stats.attacks, 2);
});

test('Held attack chains after frame 13, never at every render frame', () => {
  const world = worldWith('leif');
  stopEnemy(world.monsters[0]);
  world.attackHeld = true;
  frames(world, 13);
  assert.equal(world.stats.attacks, 1);
  world.step();
  assert.equal(world.stats.attacks, 2);
});

test('Both weapons preserve attack timing when damage changes', () => {
  const a = worldWith('leif', 2, 0, { weapon: 'spear', damage: 10 });
  const b = worldWith('leif', 2, 0, { weapon: 'spear_wathgrithr_lightning', damage: 80 });
  for (const world of [a, b]) { stopEnemy(world.monsters[0]); world.attackHeld = true; frames(world, 40); }
  assert.equal(a.stats.attacks, b.stats.attacks);
  assert.equal(a.stats.hits, b.stats.hits);
  assert.equal(a.stats.damageDealt * 8, b.stats.damageDealt);
});

test('Ordinary spider can be stunlocked; attacking hound is not interrupted', () => {
  const spider = worldWith('spider');
  spider.attackHeld = true;
  frames(spider, 50);
  assert.equal(spider.stats.hitsTaken, 0);
  assert.equal(spider.stats.kills, 1);
  const hound = worldWith('hound', 2, 0, { damage: 1 });
  hound.attackHeld = true;
  frames(hound, 16);
  assert.equal(hound.stats.hitsTaken, 1);
  assert.equal(hound.player.hp, 200 - 20 * 0.75);
});

test('Hound hit checks live distance at frame 16, so a retreat can evade', () => {
  const world = worldWith('hound', 3.3);
  world.step();
  assert.equal(world.monsters[0].state, 'attack');
  world.setMove(-1, 0);
  frames(world, 16);
  assert.equal(world.stats.hitsTaken, 0);
  assert(world.consumeEvents().some(event => event.type === 'miss' && event.id === world.monsters[0].id));
});

test('Tallbird and treeguard use distinct 12/25 frame attack events', () => {
  for (const [type, hitFrame] of [['tallbird', 12], ['leif', 25]]) {
    const world = worldWith(type);
    frames(world, hitFrame - 1);
    assert.equal(world.stats.hitsTaken, 0, type);
    world.step();
    assert.equal(world.stats.hitsTaken, 1, type);
  }
});

test('Tentacle emerges, then damages twice at loop frames 7 and 17', () => {
  const world = worldWith('tentacle', 3);
  world.monsters[0]._retargetAt=0; // Control acquisition phase, not a fabricated fixed detection delay.
  frames(world, 48); // 23 ticks of taunt (>0.75s), then 25 ticks of attack_pre
  assert.equal(world.monsters[0].state, 'attack');
  assert.equal(world.stats.hitsTaken, 0);
  frames(world, 6);
  assert.equal(world.stats.hitsTaken, 0);
  world.step();
  assert.equal(world.stats.hitsTaken, 1);
  frames(world, 9);
  assert.equal(world.stats.hitsTaken, 1);
  world.step();
  assert.equal(world.stats.hitsTaken, 2);
});

test('Tentacle attack sound events begin with each attack loop, after emergence', () => {
  const world = worldWith('tentacle', 3);
  world.monsters[0]._retargetAt=0;
  frames(world, 47);
  assert.equal(world.consumeEvents().filter(e => e.type === 'attack').length, 0);
  world.step();
  let attacks = world.consumeEvents().filter(e => e.type === 'attack');
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].tick, 48);
  frames(world, 52);
  attacks = world.consumeEvents().filter(e => e.type === 'attack');
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].tick, 100);
});

test('Wet tentacles take the uncharged lightning spear wet multiplier', () => {
  const world = worldWith('tentacle', 2, 0, { weapon: 'spear_wathgrithr_lightning' });
  world.attackHeld = true;
  frames(world, 8);
  assert.equal(world.monsters[0].hp, 500 - 59.5 * 1.25 * 1.5);
});

test('Simulation results are independent of render delta batching', () => {
  const a = worldWith('leif');
  const b = worldWith('leif');
  a.attackHeld = b.attackHeld = true;
  for (let i = 0; i < 120; i++) a.update(FIXED_DT);
  for (let i = 0; i < 40; i++) b.update(0.1);
  assert.equal(a.ticks, b.ticks);
  assert.deepEqual(a.stats, b.stats);
  assert.equal(a.player.hp, b.player.hp);
  assert.equal(a.monsters[0].hp, b.monsters[0].hp);
});

test('Pause freezes simulation, reset clears counters, multi-spawn IDs are unique', () => {
  const world = new CombatWorld({ spawns: [{ type: 'hound', count: 4 }, { type: 'spider', count: 3 }] });
  assert.equal(world.monsters.length, 7);
  assert.equal(new Set(world.entities.map(e => e.id)).size, 8);
  world.paused = true;
  world.update(0.25);
  assert.equal(world.time, 0);
  world.paused = false;
  world.update(0.1);
  assert.equal(world.ticks, 3);
  world.reset({ type: 'leif', count: 1 });
  assert.equal(world.stats.hitsTaken, 0);
  assert.equal(world.time, 0);
  assert.equal(world.status, 'running');
});

test('Stationary tentacles remain fixed under player collision', () => {
  const world = worldWith('tentacle', 1);
  world.setMove(1, 0);
  frames(world, 4);
  assert.equal(world.monsters[0].x, 1);
  assert(world.player.x <= 0.25 + 1e-8);
});

test('Click attacks approach once and preserve the running animation timeline', () => {
  const world = worldWith('leif', 10);
  stopEnemy(world.monsters[0]);
  world.requestAttack(world.monsters[0].id);
  frames(world, 10);
  assert.equal(world.player.state, 'move');
  assert.equal(world.player.animation, 'run_loop');
  assert(world.player.stateTime > 0.3);
  frames(world, 65);
  assert.equal(world.stats.attacks, 1);
  assert.equal(world.stats.hits, 1);
});

test('Wigfrid restores health from battleborn without multiplying its weapon input twice', () => {
  const world = worldWith('spider');
  stopEnemy(world.monsters[0]);
  world.player.hp = 100;
  world.requestAttack(world.monsters[0].id);
  frames(world, 8);
  assert.equal(world.player.hp, 101.7);
  assert.equal(world.stats.healing, 1.7);
});

let failures = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`${tests.length - failures}/${tests.length} combat checks passed`);
if (failures) process.exitCode = 1;
