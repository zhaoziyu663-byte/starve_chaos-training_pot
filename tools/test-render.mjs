import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Sprites} from '../dist/sprites.js';

// A recording Canvas checks geometry and actual draw counts, without timing a
// browser or claiming that draw-count reduction is a measured FPS improvement.
class Context {
  constructor(canvas) {this.canvas=canvas; this.m=[1,0,0,1,0,0]; this.stack=[]; this.draws=[];}
  save(){this.stack.push([...this.m]);}
  restore(){this.m=this.stack.pop(); assert.ok(this.m);}
  transform(a,b,c,d,x,y){
    const [A,B,C,D,X,Y]=this.m;
    this.m=[A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*x+C*y+X,B*x+D*y+Y];
  }
  setTransform(...m){this.m=m;}
  getTransform(){const [a,b,c,d,e,f]=this.m; return {a,b,c,d,e,f};}
  translate(x,y){this.transform(1,0,0,1,x,y);}
  scale(x,y){this.transform(x,0,0,y,0,0);}
  clearRect(){}
  drawImage(image,...args){this.draws.push({image,args,m:[...this.m]});}
}
class Canvas {
  constructor(w,h){this.width=w; this.height=h; this.ctx=new Context(this);}
  getContext(){return this.ctx;}
}
const ids=['player','hound','spider','tallbird','leif','tentacle','spear','spear_lightning'];
const sprites=new Sprites({createCanvas:(w,h)=>new Canvas(w,h)});
for(const id of ids){
  const data=JSON.parse(fs.readFileSync(new URL(`../dist/assets/${id}.json`,import.meta.url),'utf8'));
  data.textures=data.atlases.map(a=>({src:a.src})); sprites.models[id]=data;
}
const started=performance.now(); sprites.prepare(); const compileMs=performance.now()-started;
let checkedFrames=0, checkedCorners=0;
for(const model of Object.values(sprites.models)) for(const [anim,variants] of model.compiledAnimations){
  assert.equal(anim.fps,30);
  for(let i=0;i<variants.length;i++) for(const packet of Object.values(variants[i])){
    checkedFrames++;
    if(!packet.bounds){assert.equal(packet.commands.length,0); continue;}
    const [left,top,w,h]=packet.bounds;
    assert.ok([left,top,w,h].every(Number.isFinite)); assert.ok(w>=0 && h>=0);
    for(const command of packet.commands){
      const [a,b,c,d,tx,ty]=command.matrix;
      for(const [atlas,sx,sy,sw,sh,x,y,pw,ph] of command.pieces){
        assert.ok(command.textures[atlas]); assert.ok(sw>0 && sh>0);
        for(const [px,py] of [[x,y],[x+pw,y],[x,y+ph],[x+pw,y+ph]]){
          const X=a*px+c*py+tx, Y=b*px+d*py+ty;
          assert.ok(X>=left-1e-5 && X<=left+w+1e-5 && Y>=top-1e-5 && Y<=top+h+1e-5);
          checkedCorners++;
        }
      }
    }
  }
}

// New packet commands must retain the original rendering order, UVs and matrix.
const hidden=/^(HAT|HEAD_HAT|HEAD_HAT_NOHELM|HAT_HAIR|HAT_HAIR_FRONT|HAT_HAIR_BACK|HAIR_HAT|ARM_normal|ARM_normal_lower|ARM_normal_upper)$/;
for(const id of ['player','hound','spider','tallbird','leif','tentacle']){
  const model=sprites.models[id];
  for(const anim of model.animations) for(let fi=0;fi<anim.frames.length;fi++){
    for(const weapon of (id==='player' ? ['spear','spear_wathgrithr_lightning'] : [null])){
      const original=[];
      for(const e of [...anim.frames[fi].elements].reverse()){
        let [name,n,layer,...matrix]=e; matrix=matrix.slice(0,6);
        if(id==='tallbird' && layer==='beakfull') continue;
        if(id==='player' && (name==='headbase_hat'||hidden.test(layer)))continue;
        let source=model;
        if(id==='player'&&name==='swap_object'){
          source=sprites.models[weapon==='spear'?'spear':'spear_lightning'];
          name=weapon==='spear'?'swap_spear':'swap_spear_wathgrithr_lightning';
        }
        const f=source.symbols[name]?.find(f=>n>=f.frame && n<f.frame+f.duration);
        for(const p of f?.pieces||[]) if(p[3]>0&&p[4]>0) original.push([source.textures[p[0]].src,matrix,p.slice(1)]);
      }
      const variants=model.compiledAnimations.get(anim)[fi];
      const packet=variants.default||variants[weapon==='spear'?'spear':'lightning'];
      const compiled=packet.commands.flatMap(c=>c.pieces.map(p=>[c.textures[p[0]].src,c.matrix,p.slice(1)]));
      assert.deepEqual(compiled,original,`${id}/${anim.name}/${fi}/${weapon}`);
    }
  }
}

// All source corners fit in the physically allocated bitmap, including padding.
for(const id of ['player','hound','spider','tallbird','leif','tentacle']){
  const model=sprites.models[id];
  const anim=model.animations.find(a=>a.name==='atk')||model.animations.find(a=>a.name==='atk_loop');
  for(const variant of model.compiledAnimations.get(anim)) for(const packet of Object.values(variant)){
    const bitmap=sprites.cachedFrame(packet,.57); if(!bitmap)continue;
    for(const call of bitmap.surface.ctx.draws){
      const [sx,sy,sw,sh,x,y,w,h]=call.args, [a,b,c,d,tx,ty]=call.m;
      for(const [px,py] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]){
        const X=a*px+c*py+tx,Y=b*px+d*py+ty;
        assert.ok(X>=1.9 && X<=bitmap.surface.width-1.9 && Y>=1.9 && Y<=bitmap.surface.height-1.9);
      }
    }
  }
}

sprites.clearCache();
for(const name of ['hits','misses','builds','sourceDraws','compositeDraws','evictions'])sprites.stats[name]=0;
const ctx=new Canvas(1280,720).ctx; ctx.setTransform(2,0,0,2,0,0);
let oldSourceDraws=0;
for(let tick=0;tick<600;tick++)for(let n=0;n<12;n++){
  const time=tick/60+n/30, facing=n%2 ? Math.PI : 0;
  const {anim}=sprites.animation(sprites.models.hound,'run_loop',facing);
  const frameIndex=Math.floor(time*anim.fps+1e-7)%anim.frames.length;
  const packet=sprites.models.hound.compiledAnimations.get(anim)[frameIndex].default;
  oldSourceDraws+=packet.commands.reduce((sum,c)=>sum+c.pieces.length,0);
  assert.strictEqual(sprites.draw(ctx,'hound','run_loop',time,facing,n*50,300,.285),anim.frames[frameIndex].bounds);
}
const crowd=sprites.diagnostics();
assert.equal(crowd.builds,8); assert.equal(crowd.compositeDraws,7200); assert.equal(crowd.hits,7192);
assert.ok(crowd.sourceDraws+crowd.compositeDraws < oldSourceDraws*.1);
assert.equal(ctx.stack.length,0); assert.deepEqual(ctx.m,[2,0,0,2,0,0]);

// Frame selection remains 30 fps. Final frames clamp instead of wrapping.
const player=sprites.models.player, atk=sprites.animation(player,'atk',0).anim;
assert.strictEqual(sprites.draw(ctx,'player','atk',999,0,0,0,.285,{loop:false}),atk.frames.at(-1).bounds);
const before=sprites.stats.builds;
sprites.draw(ctx,'player','atk',999,0,0,0,.285,{loop:false,weapon:'spear_wathgrithr_lightning'});
assert.equal(sprites.stats.builds,before+1,'weapons cannot reuse stale composited pixels');

sprites.clearCache(); sprites.maxCacheEntries=2;
const surfaces=[];
for(let i=0;i<5;i++){
  sprites.draw(ctx,'hound','run_loop',i/30,0,0,0,.285);
  surfaces.push([...sprites.frameCache.values()].at(-1).surface);
  assert.ok(sprites.frameCache.size<=2 && sprites.cacheBytes<=sprites.maxCacheBytes);
}
assert.equal(surfaces[0].width,0,'eviction releases backing storage');
sprites.clearCache(); sprites.maxCacheBytes=100;
const direct=sprites.stats.directFrames;
sprites.draw(ctx,'leif','atk',0,0,0,0,.285);
assert.equal(sprites.stats.directFrames,direct+1); assert.equal(sprites.cacheBytes,0);
console.log(JSON.stringify({passed:true,compileMs:Math.round(compileMs),checkedFrames,checkedCorners,crowd:{oldSourceDraws,...crowd,newTotalDraws:crowd.sourceDraws+crowd.compositeDraws,drawCallReductionPercent:+(100*(1-(crowd.sourceDraws+crowd.compositeDraws)/oldSourceDraws)).toFixed(2)}},null,2));
