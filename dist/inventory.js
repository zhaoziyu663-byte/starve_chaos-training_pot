/** Small non-stacking DST inventory model. Slots, hands and cursor own items
 * exclusively. Keyboard/mouse equips preserve each outgoing item's prevslot,
 * matching inventory.lua:1286,1339–1377 and GiveItem:1062–1095. */
export const INVENTORY_SIZE=15;
export const TRAINING_GRASS=Object.freeze({id:'cutgrass',name:'干草',equippable:false,infinite:true,count:Infinity,damage:null});
export class TrainingInventory {
  constructor(definitions, snapshot = null) {
    this.definitions={...definitions,cutgrass:TRAINING_GRASS};
    this.slots = Array(INVENTORY_SIZE).fill(null);
    this.hands = null;
    this.active = null;
    this._serial = 0;
    this.overflow=[];
    if (snapshot) {
      const restore = data => data ? this.createItem(data.type ?? data.prefab, data.damage, data) : null;
      this.slots = Array.from({length:INVENTORY_SIZE},(_,i)=>restore(snapshot.slots?.[i]));
      this.hands = restore(snapshot.hands);
      this.active = restore(snapshot.active ?? snapshot.cursor);
    } else {
      for (const [slot,type] of ['spear','cane','spear','spear_wathgrithr_lightning'].entries()) {
        const item=this.createItem(type); item.prevSlot=slot; this.slots[slot]=item;
      }
    }
    this.ensureInfiniteGrass();
  }
  get cursor() { return this.active; }
  get items() { return [...this.slots.filter(Boolean),...this.hands?[this.hands]:[],...this.active?[this.active]:[]]; }
  get infiniteGrass(){return this.items.find(item=>item.type==='cutgrass'&&item.infinite)??null;}
  ensureInfiniteGrass(){
    if(this.infiniteGrass)return this.infiniteGrass;
    const item=this.createItem('cutgrass');item.prevSlot=14;
    const slot=this.emptySlot(14);
    if(slot>=0)this.slots[slot]=item;
    else {this.overflow.push(this.slots[14]);this.slots[14]=item;}
    return item;
  }
  createItem(type,damage,properties={}) {
    const definition=this.definitions[type];
    if(!definition) throw new TypeError(`Unknown inventory item: ${type}`);
    const serial=++this._serial;
    if(properties.id) this._serial=Math.max(this._serial,Number(properties.id.match(/(\d+)$/)?.[1])||0);
    const infinite=properties.infinite??definition.infinite??false;
    return {id:properties.id??`item-${serial}`,type,prefab:type,name:definition.name,
      equippable:definition.equippable!==false,infinite,count:infinite?Infinity:(properties.count??1),
      damage:definition.equippable===false?null:Number.isFinite(damage)?Math.max(0,damage):definition.damage,
      cooldown:definition.electric?3:0,readyAt:0,prevSlot:properties.prevSlot??null};
  }
  find(id) { return this.items.find(item=>item.id===id)??null; }
  slotOf(id) { return this.slots.findIndex(item=>item?.id===id); }
  isSlot(index) { return Number.isInteger(index)&&index>=0&&index<INVENTORY_SIZE; }
  emptySlot(preferred) {
    if(this.isSlot(preferred)&&!this.slots[preferred])return preferred;
    return this.slots.findIndex(item=>!item);
  }
  equip(id,oldToActive=false) {
    const item=this.find(id),old=this.hands;
    if(!item||item===old||!item.equippable)return null;
    const slot=this.slotOf(id);
    if(slot<0&&this.active!==item)return null;
    if(oldToActive&&this.active!==item)return null;
    if(slot>=0){this.slots[slot]=null;item.prevSlot=slot;}
    else this.active=null;
    this.hands=item;
    if(old) {
      if(oldToActive)this.active=old;
      else this.slots[this.emptySlot(old.prevSlot)]=old;
    }
    return {item,old};
  }
  unequip(toActive=false) {
    const old=this.hands;
    if(!old||toActive&&this.active)return null;
    const destination=toActive?-1:this.emptySlot(old.prevSlot);
    if(!toActive&&destination<0)return null;
    this.hands=null;
    if(toActive)this.active=old;else this.slots[destination]=old;
    return {item:null,old};
  }
  clickSlot(index) {
    if(!this.isSlot(index))return false;
    const item=this.slots[index],active=this.active;
    if(!item&&!active)return false;
    if(item)item.prevSlot=index;
    this.slots[index]=active;
    this.active=item;
    return true;
  }
  cancelActive() {
    if(!this.active)return false;
    const slot=this.emptySlot(this.active.prevSlot);
    if(slot<0)return false;
    this.slots[slot]=this.active;this.active=null;return true;
  }
  snapshot() {
    const copy=item=>item?{id:item.id,type:item.type,damage:item.damage,prevSlot:item.prevSlot,infinite:item.infinite,count:item.infinite?null:item.count}:null;
    return {slots:this.slots.map(copy),hands:copy(this.hands),active:copy(this.active)};
  }
}
