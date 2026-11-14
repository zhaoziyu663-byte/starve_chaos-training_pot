import assert from 'node:assert/strict';
import { CombatWorld, FIXED_DT } from '../dist/combat.js';
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);
const frames=(w,n)=>{for(let i=0;i<n;i++)w.step();};
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function make(options={}) {
  const w=new CombatWorld({spawns:[{type:'leif',count:1,x:2,z:0}],...options});
  w.monsters[0].nextBrainAt=1e9;w.monsters[0].nextAttackAt=1e9;
  return w;
}
function unique(w) {
  const items=[...w.inventory.slots,w.inventory.hands,w.inventory.active].filter(Boolean);
  assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  return items;
}

test('15 slots and hands own four gear items plus one infinite grass source',()=>{
  const w=make(),inv=w.inventory;
  assert.equal(inv.slots.length,15);assert.equal(inv.slots[0],null);
  assert.equal(inv.hands.type,'spear');assert.equal(inv.hands.prevSlot,0);
  assert.equal(inv.slots[1].type,'cane');assert.equal(inv.slots[2].type,'spear');
  assert.equal(inv.slots[3].type,'spear_wathgrithr_lightning');assert.equal(unique(w).length,5);
  assert.equal(w.useSlot(0),false);assert.equal(w.useSlot(14),false);assert.equal(w.inventory.hands.type,'spear');
});

test('Same-prefab different entities perform real unequip/equip; same entity does not',()=>{
  const w=make(),first=w.equippedItem.id,second=w.inventory.slots[2].id;
  w.consumeEvents();assert.equal(w.useSlot(2),true);
  assert.equal(w.equippedItem.id,second);assert.equal(w.inventory.slots[0].id,first);assert.equal(w.inventory.slots[2],null);
  const events=w.consumeEvents();assert.equal(events.filter(e=>e.type==='unequip').length,1);
  assert.equal(events.filter(e=>e.type==='equip')[0].itemId,second);
  assert.equal(w.equipItem(second),false);assert.equal(w.setWeapon('spear'),true);
  assert.equal(w.consumeEvents().filter(e=>e.type==='equip'||e.type==='unequip').length,0);
  assert.equal(w.useSlot(0),true);assert.equal(w.equippedItem.id,first);assert.equal(w.inventory.slots[2].id,second);unique(w);
});

test('Switching before frame 8 cancels old hit and cancels only its uncommitted cooldown',()=>{
  const w=make();w.attackHeld=true;frames(w,7);
  const old=w.equippedItem.id;assert.equal(w.useSlot(2),true);assert.equal(w.stats.cancelledAttacks,1);
  assert.equal(w.monsters[0].hp,3000);near(w.player.nextAttackAt,w.time);
  w.step();assert.equal(w.stats.attacks,2);assert.notEqual(w.equippedItem.id,old);
  frames(w,6);assert.equal(w.stats.hits,0);w.step();assert.equal(w.stats.hits,1);
});

test('Double-switch clears frame-13 animation gate but preserves the host 0.4s cooldown',()=>{
  const w=make();w.attackHeld=true;frames(w,8);const hp=w.monsters[0].hp;
  assert.equal(w.useSlot(2),true);assert.equal(w.player.state,'item_out');near(w.player.nextAttackAt,0.4);
  assert.equal(w.monsters[0].hp,hp);frames(w,4);assert.equal(w.stats.attacks,1);
  w.step();assert.equal(w.stats.attacks,2);
  const attacks=w.consumeEvents().filter(e=>e.type==='attack'&&e.id==='player');near(attacks[1].time,12/30);
  const uninterrupted=make();uninterrupted.attackHeld=true;frames(uninterrupted,14);
  const regular=uninterrupted.consumeEvents().filter(e=>e.type==='attack'&&e.id==='player');near(regular[1].time,13/30);
});

test('Unequip and equip cannot clear a completed attack cooldown through multiple items',()=>{
  const w=make();w.attackHeld=true;frames(w,8);
  w.unequipHand();assert.equal(w.weapon.id,'unarmed');w.useSlot(1);w.useSlot(2);
  near(w.player.nextAttackAt,0.4);frames(w,4);assert.equal(w.stats.attacks,1);
});

test('Cane changes movement immediately to 7.5 and returns to 6 when switching back',()=>{
  const w=make({spawns:[{type:'leif',count:1,x:20,z:0}]});w.setMove(0,1);w.step();near(w.player.z,0.2);
  const stateStart=w.player.stateStarted;w.useSlot(1);assert.equal(w.player.state,'move');assert.equal(w.player.stateStarted,stateStart);
  near(w.player.speed,7.5);w.step();near(w.player.z,0.45);
  w.useSlot(0);near(w.player.speed,6);w.step();near(w.player.z,0.65);
});

test('Cane retains original 17 base damage, range 2, and ordinary 8-frame weapon hit',()=>{
  const w=make();w.useSlot(1);assert.equal(w.damage,17);assert.equal(w.weapon.range,2);
  w.requestAttack(w.monsters[0].id);frames(w,7);assert.equal(w.stats.hits,0);w.step();near(w.stats.damageDealt,17*1.25);
});

test('Item damage is independent even for two spears and survives swapping',()=>{
  const w=make(),a=w.equippedItem,b=w.inventory.slots[2];
  w.setItemDamage(a.id,11);w.setItemDamage(b.id,29);near(w.damage,11);
  w.useSlot(2);near(w.damage,29);w.setDamage(30);w.useSlot(0);near(w.damage,11);near(b.damage,30);
});

test('Lightning recharge belongs to item, advances in pocket, and unfinished re-equip preserves remainder',()=>{
  const w=make({spawns:[{type:'leif',count:1,x:20,z:0}]}),spear=w.inventory.slots[3];
  w.useSlot(3);near(w.itemCooldown(spear.id),3);frames(w,30);near(w.itemCooldown(spear.id),2);
  w.useSlot(1);frames(w,30);assert.equal(w.inventory.slots[3].id,spear.id);near(w.itemCooldown(spear.id),1);
  w.useSlot(3);near(w.dashRemaining,1);frames(w,30);assert.equal(w.dashReady,true);
  w.useSlot(1);w.useSlot(3);near(w.itemCooldown(spear.id),3); // Already charged -> native OnEquip discharges.
});

test('Two lightning items have independent recharge timestamps and item-specific dash events',()=>{
  const w=make({spawns:[{type:'leif',count:1,x:20,z:0}]}),first=w.inventory.slots[3];
  const second=w.addInventoryItem('spear_wathgrithr_lightning',70,4);
  w.useSlot(3);frames(w,30);w.useSlot(4);near(w.itemCooldown(first.id),2);near(w.itemCooldown(second.id),3);
  frames(w,60);near(w.itemCooldown(first.id),0);near(w.itemCooldown(second.id),1);
  frames(w,30);assert.equal(w.requestDash(10,0),true);frames(w,12);
  near(w.itemCooldown(second.id),3);near(w.itemCooldown(first.id),0);
  assert.equal(w.consumeEvents().find(e=>e.type==='dash').itemId,second.id);unique(w);
});

test('Cursor picks, places and swaps actual items; right-use is rejected while cursor occupied',()=>{
  const w=make(),cane=w.inventory.slots[1],spear=w.inventory.slots[2];
  w.clickSlot(1);assert.equal(w.inventory.active,cane);assert.equal(w.inventory.slots[1],null);
  assert.equal(w.useSlot(2),false);assert.equal(w.inventory.slots[2],spear);
  w.clickSlot(2);assert.equal(w.inventory.active,spear);assert.equal(w.inventory.slots[2],cane);
  w.clickSlot(7);assert.equal(w.inventory.active,null);assert.equal(w.inventory.slots[7],spear);unique(w);
});

test('Hand click with a cursor swaps into cursor, and Esc restores old preferred slot',()=>{
  const w=make(),old=w.equippedItem,cane=w.inventory.slots[1];
  w.clickSlot(1);w.clickHand();assert.equal(w.inventory.hands,cane);assert.equal(w.inventory.active,old);
  assert.equal(w.inventory.slots[0],null);w.cancelCursor();assert.equal(w.inventory.slots[0],old);
  w.clickHand();assert.equal(w.inventory.active,cane);assert.equal(w.inventory.hands,null);assert.equal(w.weapon.id,'unarmed');
  w.cancelCursor();assert.equal(w.inventory.slots[1],cane);unique(w);
});

test('Cursor return falls back to first empty slot when its original slot is occupied',()=>{
  const w=make(),old=w.equippedItem;
  w.clickHand(); // old spear on cursor, original slot 0 empty.
  w.clickSlot(1); // spear into cane slot, cane now cursor, home 1 occupied.
  w.cancelCursor();assert.equal(w.inventory.slots[0].type,'cane');assert.equal(w.inventory.slots[1],old);unique(w);
});

test('Round reset optionally preserves layout, exact item IDs, damage and current hands',()=>{
  const w=make();w.clickSlot(2);w.clickSlot(9);w.useSlot(1);
  const hand=w.equippedItem.id,item=w.inventory.slots[9].id;w.setItemDamage(item,80);
  w.reset({keepInventory:true,spawns:[{type:'leif',x:20}]});assert.equal(w.equippedItem.id,hand);
  assert.equal(w.inventory.slots[9].id,item);assert.equal(w.inventory.slots[9].damage,80);assert.equal(w.player.speed,7.5);
  unique(w);w.reset({weapon:'spear',spawns:[{type:'leif',x:20}]});assert.equal(w.inventory.slots[2].type,'spear');assert.equal(w.inventory.slots[9],null);
});

test('Pause stops every per-item cooldown and busy skill states reject hotkey equip',()=>{
  const w=make({weapon:'spear_wathgrithr_lightning',spawns:[{type:'leif',x:20}]}),id=w.equippedItem.id;
  w.paused=true;frames(w,90);near(w.itemCooldown(id),3);w.paused=false;frames(w,90);
  assert.equal(w.requestDash(10,0),true);assert.equal(w.useSlot(1),false);assert.equal(w.equippedItem.id,id);
});

let failed=0;
for(const [name,run] of tests){try{run();console.log(`PASS ${name}`);}catch(error){failed++;console.error(`FAIL ${name}\n${error.stack}`);}}
console.log(`${tests.length-failed}/${tests.length} inventory checks passed`);
if(failed)process.exitCode=1;
