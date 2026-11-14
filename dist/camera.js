export const CAMERA_GROUND_Y = .56;

/** Follow the entire world position; screen-space lag stays small even on a dash. */
export class FollowCamera {
  constructor() { this.x=0; this.z=0; this.resize(1280,720,46); }
  resize(width,height,scale) {
    this.scale=scale; this.zScale=scale*.64;
    this.anchorX=width*.5; this.anchorY=height*CAMERA_GROUND_Y;
    this.maxX=Math.min(40,width*.04)/this.scale;
    this.maxZ=Math.min(22,height*.035)/this.zScale;
  }
  reset(target) { this.x=target.x; this.z=target.z; }
  follow(target,dt) {
    const blend=-Math.expm1(-8*Math.max(0,dt));
    this.x+=(target.x-this.x)*blend;
    this.z+=(target.z-this.z)*blend;
    this.x=Math.max(target.x-this.maxX,Math.min(target.x+this.maxX,this.x));
    this.z=Math.max(target.z-this.maxZ,Math.min(target.z+this.maxZ,this.z));
  }
  project(x,z) { return {x:this.anchorX+(x-this.x)*this.scale,y:this.anchorY+(z-this.z)*this.zScale}; }
  unproject(x,y) { return {x:(x-this.anchorX)/this.scale+this.x,z:(y-this.anchorY)/this.zScale+this.z}; }
}
