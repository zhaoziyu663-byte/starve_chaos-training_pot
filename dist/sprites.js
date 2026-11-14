const COMMON = ['player','spear','spear_lightning','cane','reticuleline','recharge_meter','elec_lunge_fx','elec_hit_fx','hound'];
const HIDDEN_PLAYER_LAYERS = new Set(['HAT','HEAD_HAT','HEAD_HAT_NOHELM','HAT_HAIR','HAT_HAIR_FRONT','HAT_HAIR_BACK','HAIR_HAT','ARM_normal','ARM_normal_lower','ARM_normal_upper']);
const FALLBACKS = ['idle_loop','idle','idle_loop_down','were_idle_loop','run_loop','walk_loop','were_run_loop','atk_idle'];
const LIGHTNING = 'spear_wathgrithr_lightning';

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}

export class Sprites {
  constructor(options = {}) {
    this.models = {}; this.images = new Map(); this.ground = null;
    this.manifest=null; this.manifestPromise=null; this.loadQueue=Promise.resolve();
    this.frameCache = new Map(); this.cacheBytes = 0; this.nextPacketId = 0;
    this.maxCacheBytes = options.maxCacheBytes ?? 32 * 1024 * 1024;
    this.maxCacheEntries = options.maxCacheEntries ?? 384;
    this.maxSurfacePixels = options.maxSurfacePixels ?? 1024 * 1024;
    this.createCanvas = options.createCanvas ?? makeCanvas;
    this.stats = {hits:0, misses:0, builds:0, evictions:0, directFrames:0, sourceDraws:0, compositeDraws:0, compiledFrames:0};
  }
  async load() {
    await this.ensure(COMMON); return this;
  }
  async loadManifest() {
    if (this.manifest) return this.manifest;
    if (!this.manifestPromise) this.manifestPromise=(async()=>{
      const response=await fetch('./assets/manifest.json');
      if (!response.ok) throw new Error('动画资源清单未载入');
      this.manifest=await response.json(); return this.manifest;
    })().catch(error=>{this.manifestPromise=null; throw error;});
    return this.manifestPromise;
  }
  metadata(id,variant=null) {
    const info=this.manifest?.metadata?.[id] || this.models[id]?.metadata || {};
    return variant && info.variants?.[variant] ? this.metadata(info.variants[variant]) : info;
  }
  ensure(type) {
    const requested=Array.isArray(type)?[...type]:[type];
    // Serialize commits and prepare(): simultaneous selection/start requests
    // cannot expose partially prepared models or rebuild another request's cache.
    const job=this.loadQueue.then(async()=>{
      const manifest=await this.loadManifest(), ids=[], seen=new Set();
      const visit=id=>{
        if (seen.has(id)) return; seen.add(id);
        if (!manifest.entities[id]) throw new Error(`未找到动画资源：${id}`);
        for (const dependency of manifest.metadata?.[id]?.dependencies || []) visit(dependency);
        ids.push(id);
      };
      requested.forEach(visit);
      const missing=ids.filter(id=>!this.models[id]);
      if (missing.length) {
        const loaded=await Promise.all(missing.map(async id=>{
          const response=await fetch(`./${manifest.entities[id].replace(/^\.\//,'')}`);
          if (!response.ok) throw new Error(`动画资源未载入：${id}`);
          const data=await response.json();
          data.textures=await Promise.all(data.atlases.map(a=>this.loadImage(a.src)));
          data.tintedTextures=Object.fromEntries(await Promise.all(Object.entries(data.tintedAtlases || {}).map(async([name,atlases])=>[name,await Promise.all(atlases.map(a=>this.loadImage(a.src)))])));
          data.metadata=manifest.metadata?.[id] || data.metadata || {};
          return [id,data];
        }));
        for (const [id,data] of loaded) this.models[id]=data;
        this.prepare();
      }
      return Array.isArray(type)?this:this.metadata(type);
    });
    this.loadQueue=job.catch(()=>{}); return job;
  }
  loadImage(src) {
    if (!this.images.has(src)) this.images.set(src, new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = error=>{this.images.delete(src); reject(error);}; img.src = src;
    }));
    return this.images.get(src);
  }
  // Resolve symbol intervals and original layer order once, not each render tick.
  prepare() {
    this.clearCache(); this.nextPacketId = 0; this.stats.compiledFrames = 0;
    for (const model of Object.values(this.models)) {
      model.animMap = new Map(); model.symbolFrames = new Map(); model.compiledAnimations = new Map();
      model.defaultBank = model.bank || model.animations[0]?.bank;
      model.hiddenLayers = new Set(model.hideLayers || []);
      for (const anim of model.animations) {
        const key = `${anim.bank}:${anim.name}`;
        if (!model.animMap.has(key)) model.animMap.set(key, []);
        model.animMap.get(key).push(anim);
        if (anim.bank === model.defaultBank) model.animMap.set(anim.name, model.animMap.get(key));
      }
      for (const [name, frames] of Object.entries(model.symbols)) {
        const lookup = new Map();
        for (const frame of frames) {
          const pieces = frame.pieces.filter(p => p[3] > 0 && p[4] > 0);
          for (let index = frame.frame; index < frame.frame + frame.duration; index++) {
            // Preserve the old first matching interval semantics.
            if (!lookup.has(index)) lookup.set(index, pieces);
          }
        }
        model.symbolFrames.set(name, lookup);
      }
    }
    for (const [id, model] of Object.entries(this.models)) {
      for (const anim of model.animations) {
        const packets = anim.frames.map(frame => {
          const variants = id === 'player'
            ? {spear:this.compileFrame(id,model,frame,'spear'), lightning:this.compileFrame(id,model,frame,LIGHTNING), cane:this.compileFrame(id,model,frame,'cane'), unarmed:this.compileFrame(id,model,frame,'unarmed')}
            : {default:this.compileFrame(id,model,frame)};
          if (Object.keys(model.tintedTextures || {}).length) variants.tints=Object.fromEntries(Object.entries(model.tintedTextures).map(([name,textures]) => [name,this.compileFrame(id,model,frame,undefined,textures)]));
          return variants;
        });
        model.compiledAnimations.set(anim, packets);
      }
    }
  }
  compileFrame(id, model, frame, weaponName, tintedTextures) {
    const commands = []; let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
    for (let i=frame.elements.length-1; i>=0; i--) {
      const [symbol,symbolFrame,layer,a,b,c,d,tx,ty] = frame.elements[i];
      if (model.hiddenLayers.has(layer)) continue;
      if (id==='tallbird' && layer==='beakfull') continue;
      if (id==='player') {
        const bare=weaponName==='unarmed';
        if (symbol==='headbase_hat' || (HIDDEN_PLAYER_LAYERS.has(layer) && !(bare && /^ARM_normal(?:_|$)/.test(layer)))) continue;
        if (bare && (symbol==='swap_object' || /^ARM_carry(?:_|$)/.test(layer))) continue;
      }
      let source=model, name=symbol;
      if (id==='player' && symbol==='swap_object') {
        source=this.models[weaponName==='cane' ? 'cane' : weaponName===LIGHTNING ? 'spear_lightning' : 'spear'];
        name=weaponName==='cane' ? 'swap_cane' : weaponName===LIGHTNING ? 'swap_spear_wathgrithr_lightning' : 'swap_spear';
      }
      const pieces=source?.symbolFrames.get(name)?.get(symbolFrame);
      if (!pieces?.length) continue;
      commands.push({textures:source===model && tintedTextures ? tintedTextures : source.textures,pieces,matrix:[a,b,c,d,tx,ty]});
      // Native bounds can include hidden hats and placeholders. Bound every
      // transformed visible piece so clipping cannot truncate an attack or spear.
      for (const p of pieces) {
        const [,,,,,x,y,w,h]=p;
        for (const [px,py] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]) {
          const xx=a*px+c*py+tx, yy=b*px+d*py+ty;
          left=Math.min(left,xx); right=Math.max(right,xx); top=Math.min(top,yy); bottom=Math.max(bottom,yy);
        }
      }
    }
    this.stats.compiledFrames++;
    return {key:this.nextPacketId++,commands,bounds:commands.length ? [left,top,right-left,bottom-top] : null};
  }
  animation(model, name, facing=0, bank=model.defaultBank) {
    const find = clip => model.animMap.get(`${bank}:${clip}`);
    let list=find(name);
    if (!list) for (const fallback of FALLBACKS) {
      if (find(fallback)) {list=find(fallback); break;}
    }
    if (!list) list=[model.animations.find(a => a.bank === bank)].filter(Boolean);
    const c=Math.cos(facing), s=Math.sin(facing);
    // A dedicated diagonal-only clip indicates eight-facing art. Do not infer it
    // from 255 (all facings) or 248 (front/diagonal shared player hit animation).
    const mode=model.metadata?.facingMode;
    const eight=mode!==4 && list.some(a => (a.facings & 240) && !(a.facings & 15));
    const direction=mode===6 ? [1,64,128,4,32,16][((Math.round(facing/(Math.PI/3))%6)+6)%6]
      : eight ? [1,64,8,128,4,32,2,16][((Math.round(facing/(Math.PI/4))%8)+8)%8]
      : Math.abs(c)>Math.abs(s) ? (c>=0 ? 1 : 4) : (s>=0 ? 8 : 2);
    const anim=list.find(a=>a.facings & direction) || list[0];
    return {anim,mirror:!!anim && ((direction===4 && !!(anim.facings & 1)) || (direction===32 && !!(anim.facings & 16)) || (direction===128 && !!(anim.facings & 64)))};
  }
  symbol(ctx,model,symbol,symbolFrame=0) {
    const pieces=model?.symbolFrames?.get(symbol)?.get(symbolFrame);
    if (!pieces) return;
    for (const [atlas,sx,sy,sw,sh,dx,dy,dw,dh] of pieces) ctx.drawImage(model.textures[atlas],sx,sy,sw,sh,dx,dy,dw,dh);
  }
  renderPacket(ctx,packet) {
    for (const {textures,pieces,matrix} of packet.commands) {
      ctx.save(); ctx.transform(...matrix);
      for (const [atlas,sx,sy,sw,sh,dx,dy,dw,dh] of pieces) {
        ctx.drawImage(textures[atlas],sx,sy,sw,sh,dx,dy,dw,dh); this.stats.sourceDraws++;
      }
      ctx.restore();
    }
  }
  cachedFrame(packet,density) {
    if (!packet.bounds || this.maxCacheEntries<=0 || this.maxCacheBytes<=0) return null;
    // Round up so caching never lowers requested pixel resolution. Position and
    // mirroring are excluded: the entire crowd can share the same animation frame.
    const bucket=Math.ceil(Math.max(.125,density)*8), key=`${packet.key}:${bucket}`;
    const old=this.frameCache.get(key);
    if (old) {this.frameCache.delete(key); this.frameCache.set(key,old); this.stats.hits++; return old;}
    this.stats.misses++;
    const resolution=bucket/8, padding=2, [left,top,w,h]=packet.bounds;
    const width=Math.ceil(w*resolution)+padding*2, height=Math.ceil(h*resolution)+padding*2, bytes=width*height*4;
    // Oversized entries fall back to source commands, not a low-resolution image.
    if (!Number.isFinite(bytes) || width<=0 || height<=0 || width>4096 || height>4096 || width*height>this.maxSurfacePixels || bytes>this.maxCacheBytes) return null;
    const surface=this.createCanvas(width,height), paint=surface.getContext('2d');
    if (!paint) return null;
    const x=left-padding/resolution, y=top-padding/resolution;
    paint.setTransform(resolution,0,0,resolution,-x*resolution,-y*resolution);
    this.renderPacket(paint,packet);
    const item={surface,x,y,width:width/resolution,height:height/resolution,bytes};
    while (this.frameCache.size && (this.frameCache.size>=this.maxCacheEntries || this.cacheBytes+bytes>this.maxCacheBytes)) {
      const first=this.frameCache.keys().next().value, evicted=this.frameCache.get(first);
      this.frameCache.delete(first); this.cacheBytes-=evicted.bytes;
      evicted.surface.width=0; evicted.surface.height=0; this.stats.evictions++;
    }
    this.frameCache.set(key,item); this.cacheBytes+=bytes; this.stats.builds++;
    return item;
  }
  clearCache() {
    for (const item of this.frameCache.values()) {item.surface.width=0; item.surface.height=0;}
    this.frameCache.clear(); this.cacheBytes=0;
  }
  diagnostics() {return {...this.stats,entries:this.frameCache.size,bytes:this.cacheBytes,maxBytes:this.maxCacheBytes};}
  draw(ctx,id,name,seconds,facing,x,y,scale,options={}) {
    id=this.metadata(id).variants?.[options.variant] || id;
    const model=this.models[id]; if (!model) return null;
    const {anim,mirror}=this.animation(model,name,facing,options.bank);
    if (!anim?.frames.length) return null;
    let index=Math.floor(Math.max(0,seconds)*anim.fps+1e-7);
    index=options.loop===false ? Math.min(anim.frames.length-1,index) : index%anim.frames.length;
    const frame=anim.frames[index], variants=model.compiledAnimations.get(anim)[index];
    const variant=options.weapon===null || options.weapon==='unarmed' ? 'unarmed' : options.weapon==='cane' ? 'cane' : options.weapon===LIGHTNING ? 'lightning' : 'spear';
    const packet=variants.tints?.[options.tint] || variants.default || variants[variant];
    if (options.boundsOut && packet.bounds) {
      for (let i=0;i<4;i++) options.boundsOut[i]=packet.bounds[i];
    }
    const transform=ctx.getTransform();
    // Largest singular value also handles the rotated, compressed ground plane.
    const sum=transform.a**2+transform.b**2+transform.c**2+transform.d**2, determinant=transform.a*transform.d-transform.b*transform.c;
    const pixels=Math.sqrt((sum+Math.sqrt(Math.max(0,sum*sum-4*determinant*determinant)))/2);
    const cached=this.cachedFrame(packet,Math.abs(scale)*pixels);
    ctx.save(); ctx.translate(x,y); ctx.scale(mirror ? -scale : scale,scale);
    if (cached) {ctx.drawImage(cached.surface,cached.x,cached.y,cached.width,cached.height); this.stats.compositeDraws++;}
    else {this.renderPacket(ctx,packet); this.stats.directFrames++;}
    ctx.restore();
    return frame.bounds;
  }
  drawWeapon(ctx,id) {
    const model=this.models[id]; if (!model) return;
    const symbol=id==='cane' ? 'swap_cane' : id==='spear' ? 'swap_spear' : 'swap_spear_wathgrithr_lightning';
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
    ctx.save(); ctx.translate(36,45); ctx.rotate(.5); ctx.scale(.21,.21); this.symbol(ctx,model,symbol,0); ctx.restore();
  }
  drawReticule(ctx,x,y,facing,worldScale,{zScale=.64,valid=true,seconds=0}={}) {
    // reticuleline is horizontal ground art, not a billboard. The source arrow
    // points +X and is anchored to the caster, not to the selected endpoint.
    ctx.save(); ctx.translate(x,y); ctx.scale(1,zScale); ctx.rotate(facing);
    const bounds=this.draw(ctx,'reticuleline','idle',seconds,0,0,0,worldScale/150*1.5,{loop:false,tint:valid?'gold':'invalid'});
    ctx.restore(); return bounds;
  }
  drawRecharge(ctx,x,y,percent,size=68,{completedSeconds=null}={}) {
    const p=Math.max(0,Math.min(1,percent));
    if (p<.9999) {
      this.draw(ctx,'recharge_meter','frame',0,0,x,y,size/68,{loop:false,tint:'frame'});
      // Native SetPercent("recharge", p): the 361-frame source circle reveals
      // the item as charge rises. Keep that frame order and original blue tint.
      this.draw(ctx,'recharge_meter','recharge',p*360/30,0,x,y,size/68,{loop:false,tint:'cooldown'});
    } else if (completedSeconds!==null && completedSeconds>=0 && completedSeconds<12/30) {
      this.draw(ctx,'recharge_meter','frame_pst',completedSeconds,0,x,y,size/68,{loop:false});
    }
  }
  durations() {
    return Object.fromEntries(Object.entries(this.models).map(([id,m])=>{
      const durations={};
      // Match animation()'s first usable clip if two source packs define the
      // same name (leif has both an 8-frame and a 9-frame shock_pst).
      for (const anim of m.animations) if (anim.bank===m.defaultBank && !(anim.name in durations)) durations[anim.name]=anim.frames.length/anim.fps;
      return [id,durations];
    }));
  }
}
