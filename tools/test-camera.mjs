import assert from 'node:assert/strict';
import { FollowCamera } from '../dist/camera.js';

const tests=[];
const test=(name,run)=>tests.push([name,run]);
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const contained=(camera,player,width,height)=>{
  const p=camera.project(player.x,player.z);
  assert(Math.abs(p.x-width*.5)<=Math.min(40,width*.04)+1e-8);
  assert(Math.abs(p.y-height*.56)<=Math.min(22,height*.035)+1e-8);
};

test('Long movement in every direction keeps the player in the central screen band',()=>{
  for(const [width,height,scale] of [[1280,720,45],[1920,1080,49],[390,844,18],[844,390,18]])
    for(const hz of [15,30,60,144])for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[Math.SQRT1_2,Math.SQRT1_2]]){
      const camera=new FollowCamera(),player={x:-4,z:1.4};
      camera.resize(width,height,scale);camera.reset(player);
      for(let i=0;i<hz*60;i++){
        player.x+=dx*7.5/hz;player.z+=dz*7.5/hz;
        camera.follow(player,1/hz);contained(camera,player,width,height);
      }
    }
});
test('Movement has small visible lag and stopping smoothly recenters',()=>{
  const c=new FollowCamera(),p={x:0,z:0};c.resize(1280,720,45);
  for(let i=0;i<60;i++){p.x+=7.5/60;c.follow(p,1/60);}
  const moving=c.project(p.x,p.z).x-640;assert(moving>5&&moving<=40);
  let previous=moving;
  for(let i=0;i<90;i++){c.follow(p,1/60);const offset=c.project(p.x,p.z).x-640;assert(offset<=previous+1e-8);previous=offset;}
  assert(previous<.01);
});
test('Dash displacement and viewport shrink cannot put the player at a screen edge',()=>{
  const c=new FollowCamera(),p={x:500,z:-500};c.resize(1920,1080,49);c.reset(p);
  for(const [dx,dz] of [[6.5,0],[-6.5,0],[0,6.5],[0,-6.5]]){
    p.x+=dx;p.z+=dz;c.follow(p,0);contained(c,p,1920,1080);
  }
  c.resize(320,480,18);c.follow(p,0);contained(c,p,320,480);
});
test('Reset centers immediately and a paused camera does not drift',()=>{
  const c=new FollowCamera();c.resize(1280,720,45);c.reset({x:-4,z:1.4});
  near(c.project(-4,1.4).x,640);near(c.project(-4,1.4).y,403.2);
  const p={x:-3.8,z:1.4};c.follow(p,1/60);const before={x:c.x,z:c.z};
  for(let i=0;i<60;i++)c.follow(p,0);
  assert.deepEqual({x:c.x,z:c.z},before);
  c.reset({x:10000,z:-10000});near(c.project(10000,-10000).x,640);
});
test('Click and dash aiming use the same projection as the moving camera',()=>{
  const c=new FollowCamera();c.resize(1280,720,29);
  for(let i=0;i<100;i++){
    c.follow({x:i*6.5,z:-i*3},1/30);
    const target={x:i*6.5+4,z:-i*3-2},screen=c.project(target.x,target.z),back=c.unproject(screen.x,screen.y);
    near(target.x,back.x);near(target.z,back.z);
    const pointer={x:730,y:320},world=c.unproject(pointer.x,pointer.y),roundTrip=c.project(world.x,world.z);
    near(pointer.x,roundTrip.x);near(pointer.y,roundTrip.y);
  }
});
for(const [name,run] of tests){run();console.log(`PASS ${name}`);}
console.log(`${tests.length}/${tests.length} camera checks passed`);
