"""Render contact sheet without the game engine, to verify binary conversion."""
from convert_assets import *

def load(id):
    o=json.loads((OUT/f'{id}.json').read_text())
    return o,[Image.open(PROJECT/'dist'/x['src']).convert('RGBA') for x in o['atlases']]

def render(id,anim='idle',frame=0,facing=5,scale=.5,reverse=True,swap='spear'):
    obj,images=load(id)
    available=[a for a in obj['animations'] if a['name']==anim]
    a=next((a for a in available if a['facings']&facing),available[0])
    f=a['frames'][frame%len(a['frames'])]
    dst=Image.new('RGBA',(560,500),(53,58,37,255));ox,oy=280,430
    sw,swimgs=load(swap)
    elements=list(f['elements'])
    if reverse:elements.reverse()
    for e in elements:
        sym,fr,layer,aa,bb,cc,dd,tx,ty,z=e
        if id=='tallbird' and layer=='beakfull':continue
        if id=='player' and (layer in ['ARM_normal','HEAD_HAT','HAT','HAT_HAIR','HAT_HAIR_FRONT','HAT_HAIR_BACK','HAIR_HAT'] or sym in ['headbase_hat']):continue
        src=obj;ims=images
        if id=='player' and sym=='swap_object':
            src=sw;ims=swimgs;sym='swap_spear' if swap=='spear' else 'swap_spear_wathgrithr_lightning';fr=0
        fs=src['symbols'].get(sym,[])
        sf=next((f for f in fs if f['frame']<=fr<f['frame']+f['duration']),None)
        if not sf:continue
        for p in sf['pieces']:
            ai,sx,sy,w,h,dx,dy,dw,dh=p
            if min(w,h,dw,dh)<=0:continue
            tile=ims[ai].crop((round(sx),round(sy),round(sx+w),round(sy+h)))
            m=np.array([[aa*dw/tile.width,cc*dh/tile.height,aa*dx+cc*dy+tx],
                        [bb*dw/tile.width,dd*dh/tile.height,bb*dx+dd*dy+ty],[0,0,1]])
            m[:2,:]*=scale;m[0,2]+=ox;m[1,2]+=oy
            try:inv=np.linalg.inv(m)
            except np.linalg.LinAlgError:continue
            dst.alpha_composite(tile.transform(dst.size,Image.Transform.AFFINE,tuple(inv[:2].flatten()),Image.Resampling.BICUBIC))
    ImageDraw.Draw(dst).text((10,10),f'{id} {anim} [{frame}] reverse={reverse}',fill='white')
    return dst

def main():
    cases=[('player','atk',8,.65),('hound','idle',0,.65),('spider','atk',14,.7),('tallbird','atk',8,.65),('leif','atk',25,.38),('tentacle','atk_loop',5,.55)]
    sheet=Image.new('RGBA',(560*3,500*2))
    for i,(id,anim,fr,s) in enumerate(cases):sheet.paste(render(id,anim,fr,scale=s),((i%3)*560,(i//3)*500))
    sheet.save(PROJECT/'tools'/'asset-contact-sheet.png')
    comp=Image.new('RGBA',(1120,500));comp.paste(render('player','atk',8,scale=.7,reverse=False),(0,0));comp.paste(render('player','atk',8,scale=.7,reverse=True),(560,0));comp.save(PROJECT/'tools'/'layer-order.png')

if __name__=='__main__': main()
