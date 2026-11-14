import { CombatWorld, MONSTERS, WEAPONS } from './combat.js';
import { Sprites } from './sprites.js';
import { GameAudio } from './audio.js';
import { InventoryHUD } from './inventory-ui.js';
import { FollowCamera, CAMERA_GROUND_Y } from './camera.js';

const $ = s => document.querySelector(s);
const canvas = $('#world'), ctx = canvas.getContext('2d', { alpha: false });
const sprites = new Sprites(), audio = new GameAudio();
const world = new CombatWorld({weapon:'spear',damage:34,seed:337,bounds:Infinity});
const camera = new FollowCamera();
const keys = new Set(), effects = [], spellEffects=[];
let ready=false, loading=false, width=0,height=0,dpr=1, scale=46, last=0, screenEntities=[], screenItems=[], mouseAttack=false, clickMove=null;
let weapon='spear', lastStatus='ready', audioMovementTime=0, visualTime=0;
let pointerAim=null, aiming=false, aimPoint=null, lastHandId=undefined, inventoryHUD=null;
let floorImage=null, groundPattern=null, groundShade=null, bgmCombat='ambient', uiImages={};
const epicTrails=new Map();
// Source art is 150 pixels per world unit (offering_pot.lua / storage_robot.lua).
// Per-prefab Transform scales come from the extracted metadata.
const ART_PIXELS_PER_UNIT=150;
const HEAD_HEIGHTS={player:379,spider:274,hound:388,tallbird:893,leif:1239,tentacle:846,killerbee:240,knight:495,werepig:370};
const LABELS={player:'薇格弗德',spider:'蜘蛛',hound:'猎犬',tallbird:'高脚鸟',leif:'树精守卫',tentacle:'触手',killerbee:'杀人蜂',knight:'发条骑士',werepig:'疯猪'};

function isBoss(e){return !!e._definition?.epic||e.type==='leif'||e.type==='deerclops';}
function resize(){width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);scale=Math.max(20,Math.min(49,width/24,height/16));const maxHeight=Math.max(3,...world.monsters.map(e=>{const m=sprites.metadata?.(e.type,e.renderVariant)||{};return (m.headHeight||HEAD_HEIGHTS[e.type]||400)*(m.renderScale||1)/150;}));scale=Math.max(18,Math.min(scale,(groundY()-(world.monsters.some(isBoss)?(width<1000?190:140):110))/maxHeight));camera.resize(width,height,scale);if(ready)camera.follow(world.player,0);ctx.setTransform(dpr,0,0,dpr,0,0);makeShade();}
addEventListener('resize',resize);resize();
function groundY(){return height*CAMERA_GROUND_Y;}
function project(x,z){return camera.project(x,z);}
function unproject(x,y){return camera.unproject(x,y);}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function alive(e){return e.hp>0;}
function isTyping(){return ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);}

function cancelAim(){aiming=false;aimPoint=null;canvas.classList.remove('aiming');}
function syncEquipment(){
  const item=world.inventory.hands,id=item?.id??null;
  weapon=world.weapon.id;
  if(id!==lastHandId){lastHandId=id;cancelAim();$('#equipped-name').textContent=item?.name||'空手';$('#damage').value=world.baseDamage;$('#damage').disabled=!item;}
  $('#dash-hint').classList.toggle('hidden',weapon!=='spear_wathgrithr_lightning');
  if(aiming&&(!world.dashReady||world.inventory.active))cancelAim();
}
function beginAim(point){
  if(aiming){cancelAim();return false;}
  if(!ready||!world.dashReady||world.inventory.active)return false;
  if(!point){
    if(pointerAim)point=unproject(pointerAim.x,pointerAim.y);
    else{const target=world.selectedTarget||world.monsters.filter(alive).sort((a,b)=>Math.hypot(a.x-world.player.x,a.z-world.player.z)-Math.hypot(b.x-world.player.x,b.z-world.player.z))[0];point=target||{x:world.player.x+Math.cos(world.player.facing)*6.5,z:world.player.z+Math.sin(world.player.facing)*6.5};}
  }
  aiming=true;aimPoint={x:point.x,z:point.z};clickMove=null;mouseAttack=false;world.attackHeld=false;canvas.classList.add('aiming');canvas.focus();return true;
}
function confirmAim(point){
  if(!aiming||!world.dashReady)return false;
  point=point||aimPoint;
  if(!point)return false;
  if(!world.requestDash(point.x,point.z))return false;
  cancelAim();clickMove=null;mouseAttack=false;audio.unlock();canvas.focus();return true;
}

function makeGround(){
  const tile=document.createElement('canvas');tile.width=512;tile.height=512;const g=tile.getContext('2d');
  g.fillStyle='#63674c';g.fillRect(0,0,512,512);
  let seed=73628;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<17000;i++){const x=random()*512,y=random()*512;g.fillStyle=random()>.5?'#c7c99a09':'#222a170c';g.fillRect(x,y,random()*4+.3,random()*2+.3);}
  for(let i=0;i<230;i++){const x=random()*512,y=random()*512,r=random()*17+3;g.strokeStyle=random()>.6?'#b0ac7733':'#2e39252c';g.lineWidth=.5+random()*.7;g.beginPath();g.moveTo(x-r*.6,y);g.quadraticCurveTo(x,y-3,x+r,y+random()*3);g.stroke();}
  for(let i=0;i<35;i++){const x=random()*512,y=random()*512;g.strokeStyle='#28352260';g.lineWidth=.7;g.beginPath();g.moveTo(x-3,y+3);g.lineTo(x-4,y-3);g.lineTo(x,y+2);g.lineTo(x+2,y-4);g.lineTo(x+2,y+3);g.stroke();}
  if(floorImage){g.save();g.globalAlpha=.45;g.globalCompositeOperation='multiply';g.drawImage(floorImage,0,0,512,512);g.restore();}
  groundPattern=ctx.createPattern(tile,'repeat');
}
makeGround();

function makeShade(){
  groundShade=document.createElement('canvas');groundShade.width=Math.max(1,width);groundShade.height=Math.max(1,height);
  const g=groundShade.getContext('2d'),glow=g.createRadialGradient(width*.5,height*.58,0,width*.5,height*.58,Math.max(width,height)*.8);
  glow.addColorStop(0,'#aaa67a12');glow.addColorStop(1,'#141e0c38');g.fillStyle=glow;g.fillRect(0,0,width,height);
}
function drawGround(){
  ctx.save();ctx.translate(-camera.x*scale,-camera.z*scale*.64);ctx.fillStyle=groundPattern;ctx.fillRect(camera.x*scale,camera.z*scale*.64,width,height);ctx.restore();
  ctx.drawImage(groundShade,0,0,width,height);
}

function drawRange(e){
  if(!alive(e)||e.rangeVisible===false)return;
  const p=project(e.x,e.z),config=MONSTERS[e.type]||{};
  const radius=e.hitRange??config.hitRange??config.range??(e.type==='leif'?3.3:e.type==='tentacle'?3:1.8);
  const r=radius*scale;
  const attacking=e.attackActive||e.state==='attack';
  ctx.save();ctx.lineWidth=attacking?2.5:2;ctx.strokeStyle=attacking?'#b51713':'#181c15c9';ctx.setLineDash([7,6]);ctx.beginPath();ctx.ellipse(p.x,p.y,r,r*.64,0,0,Math.PI*2);ctx.stroke();
  if(e.id===world.targetId||e.id===world.player?.targetId){ctx.setLineDash([]);ctx.strokeStyle='#d4c18e99';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(p.x,p.y,(e.radius+.1)*scale,(e.radius+.1)*scale*.64,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}

function drawDashAim(){
  if(!aiming||!world.dashReady||!aimPoint)return;
  if(pointerAim)aimPoint=unproject(pointerAim.x,pointerAim.y);
  const end=world.getDashTarget(aimPoint.x,aimPoint.z);if(!end)return;
  const a=project(world.player.x,world.player.z),facing=Math.atan2(end.z-world.player.z,end.x-world.player.x);
  sprites.drawReticule(ctx,a.x,a.y,facing,scale,{zScale:.64,valid:end.valid,seconds:visualTime});
}

function drawHP(e,p,h){
  if(!alive(e)||e.healthVisible===false)return;
  const isPlayer=e===world.player, w=isPlayer?76:clamp((e.maxHp||100)/40+52,58,100),y=p.y-h-17;
  const ratio=clamp(e.hp/e.maxHp,0,1);
  ctx.save();ctx.fillStyle='#171911e6';ctx.strokeStyle='#120f0b';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(p.x-w/2-2,y-2,w+4,13,2);ctx.fill();ctx.stroke();
  ctx.fillStyle=isPlayer?'#698444':ratio>.5?'#a43c2c':ratio>.25?'#c27b31':'#bd2c22';ctx.fillRect(p.x-w/2,y,w*ratio,9);
  ctx.fillStyle='#e2d8b0';ctx.globalAlpha=.5;ctx.fillRect(p.x-w/2,y,w*ratio,2);ctx.globalAlpha=1;
  ctx.font='bold 12px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.lineJoin='round';ctx.lineWidth=3;ctx.strokeStyle='#171910';
  const value=`${Math.ceil(e.hp)} / ${e.maxHp}`;ctx.strokeText(value,p.x,y-5);ctx.fillStyle='#f1e8ce';ctx.fillText(value,p.x,y-5);ctx.restore();
}

function drawEntity(e){
  const id=e===world.player?'player':e.type,metadata=sprites.metadata?.(id,e.renderVariant)||{},p=project(e.x,e.z),s=scale/ART_PIXELS_PER_UNIT*(metadata.renderScale||1),h=(metadata.headHeight||HEAD_HEIGHTS[id]||400)*s;
  const dead=!alive(e);ctx.save();
  if(!dead){ctx.fillStyle='#17200e36';ctx.beginPath();ctx.ellipse(p.x,p.y+3,((e.radius||.5)*scale+8),((e.radius||.5)*scale+8)*.32,0,0,Math.PI*2);ctx.fill();}
  let anim=e.animation||'idle';let animTime=e.animTime??e.stateTime??visualTime;
  if(world.status==='ready'){anim=e._definition.idleClip||'idle_loop';animTime=visualTime;}
  const bounds=e._drawBounds||(e._drawBounds=[0,0,0,0]);
  sprites.draw(ctx,id,anim,animTime,e.facing||0,p.x,p.y,s,{weapon,variant:e.renderVariant,loop:e.animLoop!==false&&!dead,boundsOut:bounds});
  const headHeight=Math.max(h,-bounds[1]*s);
  if(e.flashUntil>world.time){ctx.globalAlpha=.15;ctx.fillStyle='#f0bb95';ctx.beginPath();ctx.ellipse(p.x,p.y-h*.45,h*.23,h*.4,0,0,Math.PI*2);ctx.fill();}
  ctx.restore();drawHP(e,p,headHeight);
  screenEntities.push({id:e.id,e,x:p.x,y:p.y,h:e.healthVisible===false?18:headHeight,w:e.healthVisible===false?40:Math.max(42,h*.65)});
}

function drawEpic(){
  const bosses=world.monsters?.filter(e=>isBoss(e)&&alive(e))||[];if(!bosses.length)return;
  const target=bosses.find(e=>e.id===world.targetId||e.id===world.player?.targetId)||bosses[0];
  const w=Math.min(440,width*.4),x=(width-w)/2,y=width<1000?105:32,ratio=target.hp/target.maxHp;
  if(uiImages['epic-frame']){
    const s=w/579,mx=x+33.5*s,my=y+46*s,mw=512*s,mh=20*s;
    const trail=epicTrails.get(target.id)??ratio;const next=Math.max(ratio,trail-.0025);epicTrails.set(target.id,next);
    ctx.save();ctx.drawImage(uiImages['epic-meter_bg'],mx,my,mw,mh);ctx.fillStyle='#c3a26f';ctx.fillRect(mx,my,mw*next,mh);ctx.fillStyle='#9b392b';ctx.fillRect(mx,my,mw*ratio,mh);
    ctx.globalAlpha=.4;ctx.drawImage(uiImages['epic-meter_fg'],0,0,512*ratio,20,mx,my,mw*ratio,mh);ctx.globalAlpha=1;ctx.drawImage(uiImages['epic-frame'],x,y,w,107*s);
    ctx.textAlign='center';ctx.font='16px Georgia,"Microsoft YaHei",serif';ctx.lineWidth=4;ctx.strokeStyle='#14170e';ctx.strokeText(target.name,width/2,y-6);ctx.fillStyle='#e9dfbc';ctx.fillText(target.name,width/2,y-6);
    ctx.font='12px Georgia,serif';ctx.strokeText(`${Math.ceil(target.hp)} / ${target.maxHp}`,width/2,y+97*s);ctx.fillText(`${Math.ceil(target.hp)} / ${target.maxHp}`,width/2,y+97*s);ctx.restore();return;
  }
  ctx.save();ctx.fillStyle='#14160d';ctx.strokeStyle='#998d63';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(x-16,y+15);ctx.lineTo(x-6,y+6);ctx.lineTo(x+w+6,y+6);ctx.lineTo(x+w+16,y+15);ctx.lineTo(x+w+6,y+26);ctx.lineTo(x-6,y+26);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#3e2820';ctx.fillRect(x,y+10,w,12);ctx.fillStyle='#94372c';ctx.fillRect(x,y+10,w*ratio,12);ctx.fillStyle='#c86e45';ctx.fillRect(x,y+10,w*ratio,3);
  for(let i=1;i<4;i++){ctx.fillStyle='#100f0c88';ctx.fillRect(x+w*i/4,y+10,2,12);}
  ctx.font='15px Georgia,"Microsoft YaHei",serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.strokeStyle='#15180e';ctx.lineWidth=4;ctx.strokeText(target.name,width/2,y+2);ctx.fillStyle='#e6ddbb';ctx.fillText(target.name,width/2,y+2);
  ctx.font='12px Georgia,serif';ctx.textBaseline='top';ctx.strokeText(`${Math.ceil(target.hp)} / ${target.maxHp}`,width/2,y+31);ctx.fillStyle='#e7dfc3';ctx.fillText(`${Math.ceil(target.hp)} / ${target.maxHp}`,width/2,y+31);ctx.restore();
}

function drawEffects(dt){
  for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.age+=dt;if(e.age>.65){effects.splice(i,1);continue;}const p=project(e.x,e.z);ctx.save();ctx.globalAlpha=1-e.age/.65;ctx.textAlign='center';ctx.font='bold 18px Georgia,serif';ctx.lineWidth=3;ctx.strokeStyle='#261a12';ctx.fillStyle=e.player?'#f0876b':'#ead0a0';const text='−'+Math.round(e.amount);ctx.strokeText(text,p.x,p.y-65-e.age*35);ctx.fillText(text,p.x,p.y-65-e.age*35);ctx.restore();}
}

function drawSpellEffects(){
  for(let i=spellEffects.length-1;i>=0;i--){
    const effect=spellEffects[i],age=world.time-effect.time;
    if(age>=effect.duration){spellEffects.splice(i,1);continue;}
    const p=project(effect.x,effect.z);
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.shadowColor='#ededd1';ctx.shadowBlur=5;
    sprites.draw(ctx,effect.model,effect.animation,age,effect.facing,p.x,p.y-(effect.height||0)*scale/ART_PIXELS_PER_UNIT,scale/ART_PIXELS_PER_UNIT*effect.scale,{loop:false});
    ctx.restore();
  }
}

function drawGroundItems(){
  screenItems=[];
  for(const drop of world.droppedItems||[]){
    const p=project(drop.x,drop.z),type=drop.item?.type||drop.type,img=uiImages[type];if(!img)continue;
    ctx.save();ctx.fillStyle='#13190f55';ctx.beginPath();ctx.ellipse(p.x,p.y+4,14,6,0,0,Math.PI*2);ctx.fill();ctx.drawImage(img,p.x-18,p.y-25,36,36);ctx.restore();screenItems.push({id:drop.id,x:p.x,y:p.y-7});
  }
}

function drawHazard(hazard){
  const p=project(hazard.x,hazard.z);
  sprites.draw(ctx,hazard.asset||'deerclops_ice',hazard.animation,hazard.animTime||0,hazard.facing||0,p.x,p.y,scale/ART_PIXELS_PER_UNIT*(hazard.scale||1),{loop:false});
}

function processEvents(){
  for(const ev of world.consumeEvents()){
    const type=ev.type||ev.event;
    if(type==='dash')spellEffects.push({model:'elec_lunge_fx',animation:'fx',x:ev.toX,z:ev.toZ,facing:Math.atan2(ev.toZ-ev.fromZ,ev.toX-ev.fromX),time:ev.time,duration:13/30,scale:1.55});
    if(['damage','hit'].includes(type)){
      const e=world.entities.find(e=>e.id===(ev.targetId??ev.target?.id??ev.target));
      if(e){
        effects.push({x:e.x,z:e.z,amount:ev.amount??ev.damage??0,age:0,player:e===world.player});
        if(ev.electric){const dx=(ev.sourceX??world.player.x)-e.x,dz=(ev.sourceZ??world.player.z)-e.z,len=Math.hypot(dx,dz)||1,offset=e.radius+.2;spellEffects.push({model:'elec_hit_fx',animation:'sparks_1',x:e.x+dx/len*offset,z:e.z+dz/len*offset,height:150,facing:e.facing||0,time:ev.time,duration:13/30,scale:2});}
      }
    }
    audio.event(ev,world);
  }
}

function frame(now){
  const dt=last?Math.min((now-last)/1000,.1):0;last=now;visualTime+=dt;
  if(ready){
    let mx=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),mz=Number(keys.has('KeyS'))-Number(keys.has('KeyW'));
    if(mx||mz)clickMove=null;
    if(clickMove&&!mx&&!mz){const dx=clickMove.x-world.player.x,dz=clickMove.z-world.player.z,d=Math.hypot(dx,dz);if(d>.15){mx=dx/d;mz=dz/d;}else clickMove=null;}
    world.setMove(mx,mz);world.attackHeld=!aiming&&(keys.has('KeyF')||mouseAttack);world.update(dt);processEvents();audio.update(world);syncEquipment();inventoryHUD.render();
    if(world.player.moving&&world.status==='running'&&!world.paused){audioMovementTime+=dt;if(audioMovementTime>.31){audio.play('player_step',.3);audioMovementTime=0;}}
    const active=world.status==='running'&&!world.paused&&world.monsters.some(e=>alive(e)&&Math.hypot(e.x-world.player.x,e.z-world.player.z)<9);
    const mode=active?(world.monsters.some(e=>isBoss(e)&&alive(e))?'boss':'combat'):'ambient';
    if(mode!==bgmCombat){bgmCombat=mode;audio.setMode(mode);}
    camera.follow(world.player,world.paused?0:dt);
    if(lastStatus!==world.status){lastStatus=world.status;if(world.status==='dead')showOverlay('你死了','再来一次');else if(world.status==='won')showOverlay('已击败','再来一次');}
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);drawGround();screenEntities=[];
  if(ready){drawDashAim();drawGroundItems();for(const e of world.monsters)drawRange(e);const visible=[...world.entities,...(world.hazards||[]).filter(h=>h.active&&world.time<h.expiresAt)];for(const e of visible.sort((a,b)=>a.z-b.z)){if(e.type==='deerclops_ice')drawHazard(e);else drawEntity(e);}drawSpellEffects();drawEffects(world.paused?0:dt);drawEpic();}
  requestAnimationFrame(frame);
}

function config(){const count=clamp(Math.floor(Number($('#count').value)||1),1,12),rows=Math.ceil(count/3);return {spawns:Array.from({length:count},(_,i)=>({type:$('#monster').value,count:1,x:2.6+(i%3)*2.1,z:(Math.floor(i/3)-(rows-1)/2)*2.5})),playerX:-4,playerZ:1.4,keepInventory:true};}
async function loadMonster(type){await sprites.ensure?.(type);world.setAnimationDurations?.(sprites.durations());}
function setLoading(value){loading=value;$('#start').disabled=value;$('#monster').disabled=value;$('#count').disabled=value;$('#start').textContent=value?'载入中':'开始';}
async function start(){
  if(!ready||loading)return;cancelAim();world.cancelCursor();keys.clear();mouseAttack=false;clickMove=null;pointerAim=null;world.paused=true;setLoading(true);
  try{await loadMonster($('#monster').value);audio.pending.length=0;audio.unlock();effects.length=0;spellEffects.length=0;world.reset(config());lastHandId=undefined;inventoryHUD.recharges.clear();syncEquipment();inventoryHUD.render();world.paused=false;world.status='running';lastStatus='running';camera.reset(world.player);resize();$('#overlay').classList.add('hidden');$('#load-error').classList.add('hidden');$('#pause').textContent='Ⅱ';canvas.focus();}
  catch(error){$('#load-error').textContent=`资源载入失败：${error.message}`;$('#load-error').classList.remove('hidden');console.error(error);}
  finally{setLoading(false);}
}
function showOverlay(title,button){cancelAim();$('#overlay-title').textContent=title;$('#overlay-action').textContent=button;$('#overlay').classList.remove('hidden');keys.clear();mouseAttack=false;clickMove=null;world.setMove(0,0);world.attackHeld=false;audio.setMode('ambient');}
function togglePause(){if(!ready||world.status!=='running')return;world.paused=!world.paused;if(world.paused){showOverlay('暂停','继续');audio.pause();}else{$('#overlay').classList.add('hidden');audio.unlock();canvas.focus();}$('#pause').textContent=world.paused?'▶':'Ⅱ';}
$('#setup').addEventListener('submit',e=>{e.preventDefault();start();});$('#reset').addEventListener('click',start);$('#pause').addEventListener('click',togglePause);
$('#overlay-action').addEventListener('click',()=>{if(world.status==='running')togglePause();else start();});
$('#damage').addEventListener('change',()=>{const n=clamp(Number($('#damage').value)||world.baseDamage,1,9999);$('#damage').value=n;world.setDamage(n);inventoryHUD?.render();});
$('#count').addEventListener('change',()=>{$('#count').value=clamp(Math.floor(Number($('#count').value)||1),1,12);});
$('#monster').addEventListener('change',async()=>{if(ready&&world.status==='ready'&&!loading){setLoading(true);try{await loadMonster($('#monster').value);world.cancelCursor();world.reset(config());camera.reset(world.player);world.status='ready';lastHandId=undefined;syncEquipment();inventoryHUD.render();resize();}catch(error){$('#load-error').textContent=`资源载入失败：${error.message}`;$('#load-error').classList.remove('hidden');}finally{setLoading(false);}}});
$('#sound').addEventListener('click',()=>{audio.unlock();audio.muted=!audio.muted;audio.setVolume(Number($('#volume').value)/100);$('#sound').setAttribute('aria-pressed',String(audio.muted));$('#sound').textContent=audio.muted?'♪':'♫';});
$('#volume').addEventListener('input',()=>audio.setVolume(Number($('#volume').value)/100));
addEventListener('keydown',e=>{
  if(isTyping())return;
  if(/^Digit[0-9]$/.test(e.code)){e.preventDefault();if(!e.repeat&&ready)inventoryHUD.useHotkey((Number(e.code.slice(5))+9)%10);return;}
  if(['KeyW','KeyA','KeyS','KeyD','KeyF','Space','Escape','KeyR'].includes(e.code))e.preventDefault();
  if(e.code==='Escape'&&!e.repeat){if(aiming)cancelAim();else if(world.inventory.active)inventoryHUD?.cancelCursor();else togglePause();}
  else if(e.code==='KeyR'&&!e.repeat)start();
  else if(e.code==='Space'){if(ready&&!aiming&&!world.inventory.active){const drop=[...(world.droppedItems||[])].sort((a,b)=>Math.hypot(a.x-world.player.x,a.z-world.player.z)-Math.hypot(b.x-world.player.x,b.z-world.player.z))[0];if(drop){clickMove=null;world.requestPickup?.(drop.id);}}}
  else keys.add(e.code);
});
addEventListener('keyup',e=>keys.delete(e.code));
function release(){cancelAim();keys.clear();mouseAttack=false;clickMove=null;if(ready){world.setMove(0,0);world.attackHeld=false;}if(world.status==='running'&&!world.paused)togglePause();audio.pause();}
addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
canvas.addEventListener('pointermove',e=>{pointerAim={x:e.clientX,y:e.clientY};if(aiming)aimPoint=unproject(e.clientX,e.clientY);});
canvas.addEventListener('pointerleave',()=>{pointerAim=null;});
canvas.addEventListener('pointerdown',e=>{if(!ready||world.status!=='running'||world.paused)return;canvas.focus();audio.unlock();if(world.inventory.active){if(e.button===0){cancelAim();world.dropActiveItem?.();syncEquipment();inventoryHUD.render();}return;}if(e.button===2){e.preventDefault();beginAim(unproject(e.clientX,e.clientY));return;}if(e.button!==0)return;if(aiming){e.preventDefault();confirmAim(unproject(e.clientX,e.clientY));return;}const drop=screenItems.find(v=>Math.abs(e.clientX-v.x)<20&&Math.abs(e.clientY-v.y)<20);if(drop){clickMove=null;mouseAttack=false;world.requestPickup?.(drop.id);return;}const chosen=[...screenEntities].reverse().find(v=>v.e!==world.player&&alive(v.e)&&Math.abs(e.clientX-v.x)<v.w/2&&e.clientY<v.y+15&&e.clientY>v.y-v.h);
  if(chosen){world.requestAttack(chosen.id);mouseAttack=true;clickMove=null;}else clickMove=unproject(e.clientX,e.clientY);});
addEventListener('pointerup',()=>mouseAttack=false);canvas.addEventListener('contextmenu',e=>e.preventDefault());

async function init(){
  try{
    $('#monster').replaceChildren(...Object.values(MONSTERS).map(definition=>{const option=document.createElement('option');option.value=definition.id;option.textContent=definition.name;return option;}));$('#monster').value='hound';
    await Promise.all([sprites.load(),audio.load(),(async()=>{const data=await(await fetch('./assets/ui.json')).json();await Promise.all(['epic-frame','epic-meter_bg','epic-meter_fg','spear','spear_wathgrithr_lightning','cane','cutgrass','Ground_noise'].map(async key=>{uiImages[key]=await sprites.loadImage(data[key].src);}));})()]);
    world.setAnimationDurations?.(sprites.durations());
    inventoryHUD=new InventoryHUD({world,sprites,onChange:()=>{syncEquipment();audio.unlock();},onInteraction:cancelAim});
    world.reset(config());camera.reset(world.player);world.status='ready';ready=true;syncEquipment();inventoryHUD.render();resize();$('#start').disabled=false;$('#start').textContent='开始';audio.setVolume(.45);
    floorImage=uiImages.Ground_noise;makeGround();
    window.trainer={world,sprites,audio,start,config,ready:true};
  }catch(error){$('#load-error').textContent=`资源载入失败：${error.message}。请刷新重试。`;$('#load-error').classList.remove('hidden');console.error(error);}
}
requestAnimationFrame(frame);init();
