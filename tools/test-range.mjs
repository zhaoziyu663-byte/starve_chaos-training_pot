import assert from 'node:assert/strict';
import { CombatWorld } from '../dist/combat.js';

function scenario(weapon, distance) {
  const world=new CombatWorld({weapon,spawns:[{type:'hound',count:1,x:distance,z:0}]});
  world.monsters[0].nextBrainAt=1000;
  world.monsters[0].nextAttackAt=1000;
  world.requestAttack(world.monsters[0].id);
  return world;
}
let checks=0;
for(const weapon of ['spear','spear_wathgrithr_lightning']) {
  let world=scenario(weapon,2.5);
  world.step();assert.equal(world.player.state,'attack');assert.equal(world.player.x,0);
  for(let i=0;i<7;i++)world.step();
  assert.equal(world.stats.hits,1);checks++;
  console.log(`PASS ${weapon}: host starts and hits at inclusive 2.5 center distance`);

  world=scenario(weapon,2.501);
  world.step();assert.equal(world.stats.attacks,0);assert.equal(world.player.state,'move');checks++;
  console.log(`PASS ${weapon}: outside host radius must approach before starting`);

  world=scenario(weapon,2.49);world.step();world.monsters[0].x=2.501;
  for(let i=0;i<7;i++)world.step();
  assert.equal(world.stats.hits,0);assert.equal(world.monsters[0].hp,150);checks++;
  console.log(`PASS ${weapon}: target escaping before frame 8 makes the hit miss`);
}
console.log(`${checks}/${checks} range boundary checks passed`);
