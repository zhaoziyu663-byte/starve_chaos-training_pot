const NAMES={spear:'矛',spear_wathgrithr_lightning:'奔雷矛',cane:'步行手杖',cutgrass:'干草'};
const KEYS=['1','2','3','4','5','6','7','8','9','0','','','','',''];

export class InventoryHUD {
  constructor({world,sprites,onChange,onInteraction}) {
    this.world=world;this.sprites=sprites;this.onChange=onChange;this.onInteraction=onInteraction;
    this.root=document.querySelector('#inventory');this.slots=[];this.recharges=new Map();
    this.pointer=null;this.pointerPosition={x:0,y:0};
    const bag=document.createElement('div');bag.className='inventory-slots';
    for(let i=0;i<15;i++){
      const slot=this.makeSlot(`物品栏 ${i+1}`,KEYS[i]);slot.button.dataset.invSlot=String(i);
      this.attach(slot.button,()=>this.world.clickSlot(i),()=>this.world.useSlot(i));
      bag.append(slot.button);this.slots.push(slot);
    }
    const equipped=document.createElement('div');equipped.className='equipped-slots';
    for(const [type,label] of [['hands','手部装备'],['body','身体装备'],['head','头部装备']]){
      const slot=this.makeSlot(label,'');slot.button.dataset.equipSlot=type;slot.button.classList.add('equip-'+type);
      if(type==='hands'){this.hand=slot;this.attach(slot.button,()=>this.world.clickHand(),()=>!this.world.inventory.active&&this.world.unequipHand());}
      else{slot.button.disabled=true;slot.button.title=label+'：空';}
      equipped.append(slot.button);
    }
    this.root.append(bag,equipped);
    this.cursor=this.makeSlot('鼠标上的物品','',false);this.cursor.button.id='inventory-cursor';this.cursor.button.classList.add('hidden');document.body.append(this.cursor.button);
    this.root.addEventListener('contextmenu',event=>event.preventDefault());
    addEventListener('pointermove',event=>{this.pointerPosition={x:event.clientX,y:event.clientY};this.positionCursor();});
    addEventListener('pointerup',event=>this.finishDrag(event));
  }
  makeSlot(label,key,interactive=true){
    const button=document.createElement(interactive?'button':'div');button.className='inventory-slot';
    if(interactive)button.type='button';button.setAttribute('aria-label',label);
    const img=document.createElement('img');img.className='inventory-item';img.alt='';img.draggable=false;img.hidden=true;
    const overlay=document.createElement('canvas');overlay.className='inventory-recharge';overlay.width=136;overlay.height=136;overlay.setAttribute('aria-hidden','true');
    const hotkey=document.createElement('span');hotkey.className='inventory-hotkey';hotkey.textContent=key;
    const quantity=document.createElement('span');quantity.className='inventory-quantity';
    button.append(img,overlay,hotkey,quantity);
    const ctx=overlay.getContext('2d');ctx.setTransform(2,0,0,2,0,0);
    return {button,img,overlay,ctx,label,key,quantity,itemId:null,cooldownFrame:null,title:null};
  }
  attach(button,left,right){
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0&&event.button!==2)return;
      event.preventDefault();event.stopPropagation();this.onInteraction();
      this.pointerPosition={x:event.clientX,y:event.clientY};
      const hadActive=!!this.world.inventory.active;
      const changed=event.button===2?right():left();
      if(event.button===0&&!hadActive&&this.world.inventory.active)this.pointer={button,x:event.clientX,y:event.clientY};
      if(changed)this.onChange();this.render();document.querySelector('#world').focus();
    });
    button.addEventListener('keydown',event=>{
      if(event.code!=='Enter'&&event.code!=='Space')return;
      event.preventDefault();event.stopPropagation();this.onInteraction();
      if(right())this.onChange();this.render();document.querySelector('#world').focus();
    });
  }
  finishDrag(event){
    const pointer=this.pointer;this.pointer=null;
    if(!pointer||!this.world.inventory.active||Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<8)return;
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-inv-slot],[data-equip-slot]');
    if(!target||target===pointer.button)return;
    let changed=false;
    if(target.dataset.invSlot!==undefined)changed=this.world.clickSlot(Number(target.dataset.invSlot));
    else if(target.dataset.equipSlot==='hands')changed=this.world.clickHand();
    if(changed)this.onChange();this.render();
  }
  useHotkey(index){this.onInteraction();if(this.world.useSlot(index))this.onChange();this.render();}
  cancelCursor(){if(!this.world.inventory.active)return false;const changed=this.world.cancelCursor();if(changed)this.onChange();this.render();return changed;}
  positionCursor(){this.cursor.button.style.transform=`translate(${this.pointerPosition.x+12}px,${this.pointerPosition.y-30}px)`;}
  paintSlot(slot,item){
    const type=item?.type??item?.prefab,name=item?(NAMES[type]||type):'空';
    const cooldown=item?this.world.itemCooldown(item.id):0;
    const detail=item?.infinite?'无限':Number.isFinite(item?.damage)?`攻击力 ${item.damage}`:'';
    const title=item?`${name}${detail?' · '+detail:''}${cooldown>0?' · 冲刺冷却 '+cooldown.toFixed(1)+' 秒':''}${slot.key?' · '+slot.key:''}`:slot.label+'：空';
    if(title!==slot.title){slot.title=title;slot.button.title=title;slot.button.setAttribute('aria-label',`${slot.label}：${name}${item?.infinite?'，无限':''}${cooldown>0?'，冷却 '+cooldown.toFixed(1)+' 秒':''}`);}
    const quantity=item?.infinite?'∞':item?.count>1?String(item.count):'';
    if(slot.quantity.textContent!==quantity)slot.quantity.textContent=quantity;
    if(slot.itemId!==item?.id){
      slot.itemId=item?.id;slot.img.hidden=!item;
      if(item)slot.img.src=`./assets/ui-${type}.png`;
      slot.button.classList.toggle('occupied',!!item);slot.cooldownFrame=null;
    }
    const record=item?this.recharges.get(item.id):null;
    const elapsed=record?.finishedAt!=null?this.world.time-record.finishedAt:null;
    const flash=elapsed!==null&&elapsed>=0&&elapsed<.4?elapsed:null;
    const progress=1-Math.min(1,cooldown/this.world.dashCooldown);
    const frame=`${item?.id||''}:${cooldown>0?Math.floor(progress*360):-1}:${flash!==null?Math.floor(flash*30):-1}`;
    if(frame!==slot.cooldownFrame){
      slot.cooldownFrame=frame;slot.ctx.clearRect(0,0,68,68);
      if(item&&(cooldown>0||flash!==null))this.sprites.drawRecharge(slot.ctx,34,34,progress,68,{completedSeconds:flash});
    }
  }
  render(){
    const inv=this.world.inventory;if(!inv)return;
    for(const item of [...inv.slots,inv.hands,inv.active].filter(Boolean)){
      const remaining=this.world.itemCooldown(item.id),old=this.recharges.get(item.id);
      this.recharges.set(item.id,{remaining,finishedAt:old?.remaining>0&&remaining===0?this.world.time:old?.finishedAt});
    }
    for(let i=0;i<this.slots.length;i++)this.paintSlot(this.slots[i],inv.slots[i]);
    this.paintSlot(this.hand,inv.hands);this.paintSlot(this.cursor,inv.active);
    this.cursor.button.classList.toggle('hidden',!inv.active);this.positionCursor();
    document.body.classList.toggle('carrying-item',!!inv.active);
  }
}
