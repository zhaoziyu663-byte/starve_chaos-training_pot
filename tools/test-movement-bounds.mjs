import assert from 'node:assert/strict';
import { CombatWorld, FIXED_DT } from '../dist/combat.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const frames = (world, count) => { for (let i = 0; i < count; i++) world.step(); };
const near = (actual, expected, tolerance = 1e-7) => assert(
  Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`,
);
const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
function make(options = {}) {
  const world = new CombatWorld({
    spawns: [{ type: 'hound', x: -1000, z: -1000 }], ...options,
  });
  for (const monster of world.monsters) {
    monster.nextBrainAt = 1e9;
    monster.nextAttackAt = 1e9;
  }
  return world;
}

test('Unbounded configuration survives round reset while the default arena stays finite', () => {
  const world = make({ bounds: Infinity });
  assert.equal(world.bounds, Infinity);
  world.reset({ playerX: 120, playerZ: -90, spawns: [{ type: 'hound', x: -1000, z: -1000 }] });
  world.monsters[0].nextBrainAt = 1e9;
  world.setMove(1, 0);
  frames(world, 300);
  near(world.player.x, 180);
  near(world.player.z, -90);
  assert.equal(world.bounds, Infinity);
  assert.equal(make().bounds, 30);
});

test('Walking in all eight directions continues beyond the former radius 30 without losing speed', () => {
  for (const [x, z] of directions) {
    const world = make({ bounds: Infinity });
    const magnitude = Math.hypot(x, z);
    world.setMove(x, z);
    frames(world, 600);
    const distance = 6 * FIXED_DT * 600;
    near(world.player.x, x / magnitude * distance);
    near(world.player.z, z / magnitude * distance);
    assert.equal(world.player.hp, world.player.maxHp);
    assert.equal(world.status, 'running');
  }
});

test('Cane walking keeps speed 7.5 beyond the former wall and switching back restores speed 6', () => {
  const world = make({ bounds: Infinity });
  assert(world.useSlot(1));
  world.setMove(1, 0);
  frames(world, 300);
  near(world.player.x, 75);
  assert(world.useSlot(0));
  frames(world, 150);
  near(world.player.x, 105);
});

test('An aimed dash wholly outside the former arena stays valid and travels exactly 6.5 units', () => {
  const world = make({ bounds: Infinity, weapon: 'spear_wathgrithr_lightning' });
  world.player.x = 80;
  world.player.z = -45;
  frames(world, 90);
  const target = world.getDashTarget(83, -41);
  assert.equal(target.valid, true);
  near(target.x, 83.9);
  near(target.z, -39.8);
  assert.equal(world.requestDash(83, -41), true);
  frames(world, 11);
  near(world.player.x, 80);
  near(world.player.z, -45);
  world.step();
  near(world.player.x, target.x);
  near(world.player.z, target.z);
  near(Math.hypot(world.player.x - 80, world.player.z + 45), 6.5);
  near(world.dashRemaining, 3);
});

test('Ordinary and expanded monsters pursue the player outside the former arena without snapping inward', () => {
  for (const type of ['hound', 'beefalo', 'spider_warrior']) {
    const world = new CombatWorld({ bounds: Infinity, spawns: [{ type, x: 70, z: 45 }] });
    world.player.x = 90;
    world.player.z = 45;
    const monster = world.monsters[0];
    monster.nextAttackAt = 1e9;
    frames(world, 90);
    assert(monster.x > 75 && monster.x < world.player.x, `${type}: chase position ${monster.x}`);
    near(monster.z, 45);
    near(world.player.x, 90);
    near(world.player.z, 45);
    assert.equal(world.player.hp, world.player.maxHp);
  }
});

test('Body collision still separates overlapping actors outside the former arena', () => {
  const world = make({ bounds: Infinity, spawns: [{ type: 'hound', x: 200.75, z: -80 }] });
  world.player.x = 200;
  world.player.z = -80;
  world.setMove(1, 0);
  world.step();
  const monster = world.monsters[0];
  near(Math.hypot(world.player.x - monster.x, world.player.z - monster.z), world.player.radius + monster.radius);
  assert(world.player.x > 190 && monster.x > 190);
  near(world.player.z, -80);
  near(monster.z, -80);
});

test('Default and explicit finite arenas retain their circular movement boundary', () => {
  for (const options of [{}, { bounds: 8 }]) for (const [x, z] of directions) {
    const world = make(options);
    world.setMove(x, z);
    frames(world, 300);
    near(Math.hypot(world.player.x, world.player.z), world.bounds - world.player.radius);
    const before = { x: world.player.x, z: world.player.z };
    frames(world, 30);
    near(world.player.x, before.x);
    near(world.player.z, before.z);
  }
});

test('Finite arenas still reject an outside dash and accept its exact inclusive landing boundary', () => {
  for (const bounds of [8, 30]) {
    const world = make({ bounds, weapon: 'spear_wathgrithr_lightning' });
    frames(world, 90);
    world.player.x = bounds - 6;
    assert.equal(world.getDashTarget(100, 0).valid, false);
    assert.equal(world.requestDash(100, 0), false);
    near(world.dashRemaining, 0);
    world.player.x = bounds - 7;
    assert.equal(world.getDashTarget(100, 0).valid, true);
    assert.equal(world.requestDash(100, 0), true);
    frames(world, 12);
    near(world.player.x, bounds - world.player.radius);
    near(world.player.z, 0);
  }
});

let failures = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`${tests.length - failures}/${tests.length} movement boundary checks passed`);
if (failures) process.exitCode = 1;
