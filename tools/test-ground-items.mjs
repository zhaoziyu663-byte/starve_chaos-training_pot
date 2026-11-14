import assert from 'node:assert/strict';
import {CombatWorld,MAX_GRASS_DROPS} from '../dist/combat.js';
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
const frames=(w,n)=>{for(let i=0;i<n;i++)w.step();};
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function make(type='leif',x=20){const w=new CombatWorld({spawns:[{type,x,z:0}]});if(type!=='frog'){w.monsters[0].nextBrainAt=1e9;w.monsters[0].nextAttackAt=1e9;}return w;}
function integrity(w,totalGear=4){
 const all=[...w.inventory.items,...w.droppedItems.map(d=>d.item)];
 assert.equal(new Set(all.map(i=>i.id)).size,all.length);
 assert.equal(all.filter(i=>i.type!=='cutgrass').length,totalGear);
 assert.equal(all.filter(i=>i.type==='cutgrass'&&i.infinite).length,1);
 assert.equal(w.droppedItems.some(d=>d.item.infinite),false);
}


test('Actual frog hit drops one free grass unit and preserves every bag/cursor/hand item',()=>{
 const w=make('frog',2),before=w.inventory.snapshot(),source=w.inventory.infiniteGrass;
 frames(w,25);assert.equal(w.droppedItems.length,1);
 const grass=w.droppedItems[0].item;assert.equal(grass.type,'cutgrass');assert.equal(grass.infinite,false);assert.equal(grass.count,1);
 assert.deepEqual(w.inventory.snapshot(),before);assert.equal(w.inventory.infiniteGrass,source);assert.equal(source.count,Infinity);integrity(w);
});

test('Pickup walks to 1.15 distance and transfers original item at animation frame 6',()=>{
 const w=make(),cane=w.inventory.slots[1];w.clickSlot(1);const drop=w.dropActiveItem(6,0);assert(drop);integrity(w);
 assert.equal(w.requestPickup(drop.id),true);for(let i=0;i<100&&w.player.state!=='pickup';i++)w.step();
 assert.equal(w.player.state,'pickup');assert(Math.hypot(w.player.x-6,w.player.z)<=1.15+1e-8);
 const start=w.player.stateStarted;while(w.time-start<5/30-1e-8)w.step();assert.equal(w.droppedItems.length,1);
 w.step();assert.equal(w.droppedItems.length,0);assert.equal(w.inventory.slots[1],cane);
 const pickup=w.consumeEvents().find(e=>e.type==='pickup');near(pickup.time-start,6/30);integrity(w);
});

test('Off-hand and ground lightning recharge use same item timestamp',()=>{
 const w=make(),item=w.inventory.slots[3];w.useSlot(3);w.unequipHand();w.clickSlot(3);
 const drop=w.dropActiveItem(1,0);assert.equal(drop.item,item);frames(w,45);near(w.itemCooldown(item.id),1.5);
 w.requestPickup(drop.id);for(let i=0;i<40&&w.droppedItems.length;i++)w.step();
 assert.equal(w.inventory.slots[3],item);const remaining=w.itemCooldown(item.id);assert(remaining>0&&remaining<1.5);
 w.useSlot(3);near(w.dashRemaining,remaining);integrity(w);
});

test('Frog grass output does not depend on the source staying in its initial slot',()=>{
 const w=make(),source=w.inventory.slots[14];w.clickSlot(14);w.clickSlot(8);
 assert.equal(w.inventory.slots[14],null);assert.equal(w.inventory.slots[8],source);
 const first=w.dropStolenItem(w.monsters[0]);assert.equal(first.item.type,'cutgrass');assert.equal(w.inventory.slots[8],source);
 w.clickSlot(8);const before=w.inventory.snapshot();w.dropStolenItem(w.monsters[0]);
 assert.equal(w.inventory.active,source);assert.deepEqual(w.inventory.snapshot(),before);integrity(w);
});

test('Infinite grass cannot be equipped or assigned weapon damage',()=>{
 const w=make(),source=w.inventory.infiniteGrass,hand=w.equippedItem;
 assert.equal(source.equippable,false);assert.equal(source.damage,null);
 assert.equal(w.useSlot(14),false);assert.equal(w.equipItem(source.id),false);assert.equal(w.setWeapon('cutgrass'),false);
 assert.equal(w.setItemDamage(source.id,999),false);assert.equal(source.damage,null);
 w.clickSlot(14);assert.equal(w.clickHand(),false);assert.equal(w.inventory.active,source);assert.equal(w.equippedItem,hand);integrity(w);
});

test('Actively dropping infinite grass emits one unit and leaves the unique source on cursor',()=>{
 const w=make(),source=w.inventory.infiniteGrass;w.clickSlot(14);
 const drop=w.dropActiveItem(2,0);assert.equal(drop.item.type,'cutgrass');assert.equal(drop.item.count,1);assert.equal(drop.item.infinite,false);
 assert.equal(w.inventory.active,source);assert.equal(source.count,Infinity);w.cancelCursor();assert.equal(w.inventory.slots[14],source);integrity(w);
});

test('At most32 grass piles are retained; recycling grass never evicts dropped gear',()=>{
 const w=make();w.clickSlot(1);const gear=w.dropActiveItem(4,0);const source=w.inventory.infiniteGrass;
 for(let i=0;i<1000;i++)w.dropStolenItem({x:i%4+1,z:i%3});
 assert.equal(w.droppedItems.filter(d=>d.item.type==='cutgrass').length,MAX_GRASS_DROPS);
 assert.equal(w.droppedItems.length,MAX_GRASS_DROPS+1);assert.equal(w.droppedItems.find(d=>d.id===gear.id),gear);
 assert.equal(w.inventory.infiniteGrass,source);assert(w.droppedItems.filter(d=>d.item.type==='cutgrass').every(d=>d.item.count===1));integrity(w);
});

test('Picking up grass merges into the infinite source without another inventory stack',()=>{
 const w=make(),source=w.inventory.infiniteGrass;const drop=w.dropStolenItem({x:1,z:0});
 const before=w.inventory.snapshot();assert.equal(w.requestPickup(drop.id),true);frames(w,6);
 assert.equal(w.droppedItems.length,0);assert.deepEqual(w.inventory.snapshot(),before);assert.equal(w.inventory.infiniteGrass,source);integrity(w);
});

test('Grass pickup works with a full bag and does not displace equipment',()=>{
 const w=make(),source=w.inventory.infiniteGrass;
 while(w.inventory.emptySlot(null)>=0)w.addInventoryItem('spear',34);
 const before=w.inventory.snapshot(),drop=w.dropStolenItem({x:1,z:0});
 assert.equal(w.inventory.emptySlot(null),-1);assert.equal(w.requestPickup(drop.id),true);frames(w,6);
 assert.equal(w.droppedItems.length,0);assert.deepEqual(w.inventory.snapshot(),before);assert.equal(w.inventory.infiniteGrass,source);
 const all=w.inventory.items;assert.equal(new Set(all.map(i=>i.id)).size,all.length);
});

test('Both resets keep exactly one infinite source; keepInventory retains its moved identity',()=>{
 const w=make(),source=w.inventory.infiniteGrass;w.clickSlot(14);w.clickSlot(8);w.dropStolenItem({x:1,z:0});
 const gearIds=w.inventory.items.filter(i=>i.type!=='cutgrass').map(i=>i.id).sort();
 w.reset({keepInventory:true,spawns:[{type:'leif',x:20}]});assert.equal(w.droppedItems.length,0);
 assert.equal(w.inventory.slots[8].id,source.id);assert.equal(w.inventory.slots[14],null);
 assert.deepEqual(w.inventory.items.filter(i=>i.type!=='cutgrass').map(i=>i.id).sort(),gearIds);integrity(w);
 w.reset({spawns:[{type:'leif',x:20}]});assert.equal(w.inventory.slots[14].type,'cutgrass');assert.equal(w.inventory.slots[14].infinite,true);integrity(w);
});

test('Keep-inventory restart recovers dropped gear with IDs and custom damage intact',()=>{
 const w=make(),item=w.inventory.slots[3];w.setItemDamage(item.id,91);w.clickSlot(3);w.dropActiveItem(5,0);
 w.reset({keepInventory:true,spawns:[{type:'leif',x:20}]});assert.equal(w.droppedItems.length,0);
 assert.equal(w.inventory.slots[3].id,item.id);assert.equal(w.inventory.slots[3].damage,91);integrity(w);
});

test('Nearest pickup selects closest physical drop and cancellation cannot duplicate it',()=>{
 const w=make();w.clickSlot(1);const far=w.dropActiveItem(8,0);w.clickSlot(2);const close=w.dropActiveItem(2,0);
 assert.equal(w.requestPickup(),true);assert.equal(w._pickupId,close.id);w.setMove(0,1);w.step();assert.equal(w._pickupId,null);
 assert.equal(w.droppedItems.length,2);assert.equal(w.droppedItems.find(d=>d.id===far.id),far);integrity(w);
});

let failed=0;for(const[name,run]of tests){try{run();console.log(`PASS ${name}`);}catch(e){failed++;console.error(`FAIL ${name}\n${e.stack}`);}}
console.log(`${tests.length-failed}/${tests.length} ground-item checks passed`);if(failed)process.exitCode=1;
