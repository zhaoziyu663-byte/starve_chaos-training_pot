"""Read-only DST asset conversion. All outputs live in this independent project.

Binary layout references: Klei's ds_mod_tools/buildanimation.py (ANIM v4/BILD v6),
and CN-DST-DEVELOPER/DstAnimTool. No game files are ever opened for writing.
"""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
import json, struct, hashlib, math, argparse
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw
import numpy as np

GAME = Path(r"E:\steam\steamapps\common\Don't Starve Together")
PROJECT = Path(__file__).resolve().parents[1]
OUT = PROJECT / 'dist/assets'
OUT.mkdir(parents=True, exist_ok=True)

class Reader:
    def __init__(self, data): self.f=BytesIO(data)
    def read(self, fmt):
        vals=struct.unpack('<'+fmt,self.f.read(struct.calcsize('<'+fmt)))
        return vals[0] if len(vals)==1 else vals
    def string(self): return self.f.read(self.read('I')).decode('utf-8')
    def hashes(self): return {self.read('I'):self.string() for _ in range(self.read('I'))}

def roundfloats(v):
    if isinstance(v,float): return round(v,5)
    if isinstance(v,list): return [roundfloats(x) for x in v]
    if isinstance(v,tuple): return [roundfloats(x) for x in v]
    if isinstance(v,dict): return {k:roundfloats(x) for k,x in v.items()}
    return v

def tex_image(data):
    assert data[:4]==b'KTEX'
    bits=struct.unpack_from('<I',data,4)[0]
    fmt=(bits>>4)&31; nmip=(bits>>13)&31
    width,height,pitch,length=struct.unpack_from('<HHHI',data,8)
    raw=data[8+10*nmip:8+10*nmip+length]
    if fmt in (0,1,2):
        fourcc=[b'DXT1',b'DXT3',b'DXT5'][fmt]
        header=struct.pack('<7I',124,0x81007,height,width,length,0,1)+bytes(44)
        header+=struct.pack('<II4s5I',32,4,fourcc,0,0,0,0,0)
        header+=struct.pack('<5I',0x1000,0,0,0,0)
        im=Image.open(BytesIO(b'DDS '+header+raw)).convert('RGBA')
    elif fmt in (4,5):
        im=Image.frombytes('RGB' if fmt==4 else 'RGBA',(width,height),raw).convert('RGBA')
    else: raise ValueError(f'Unsupported TEX format {fmt}')
    im=im.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    # Klei stores premultiplied colors. Browser PNG requires straight alpha.
    a=np.asarray(im).astype(np.float32)
    alpha=a[:,:,3:4]
    a[:,:,:3]=np.minimum(255,a[:,:,:3]*255/np.maximum(alpha,1))
    a[:,:,:3]=np.where(alpha>0,a[:,:,:3],0)
    return Image.fromarray(a.astype(np.uint8))

def parse_anim(data):
    r=Reader(data); assert r.f.read(4)==b'ANIM' and r.read('I')==4
    ne,nf,nev,na=r.read('4I'); anims=[]
    for _ in range(na):
        name=r.string(); facings=r.read('B'); bank=r.read('I'); fps=r.read('f'); n=r.read('I')
        frames=[]
        for _ in range(n):
            bounds=r.read('4f'); events=[r.read('I') for _ in range(r.read('I'))]
            elements=[list(r.read('3I7f')) for _ in range(r.read('I'))]
            frames.append({'bounds':bounds,'elements':elements})
        anims.append({'name':name,'bank':bank,'facings':facings,'fps':fps,'frames':frames})
    hashes=r.hashes()
    assert r.f.read()==b''
    for a in anims:
        a['bank']=hashes.get(a['bank'],str(a['bank']))
        for f in a['frames']:
            for e in f['elements']:
                e[0]=hashes.get(e[0],str(e[0]));e[2]=hashes.get(e[2],str(e[2]))
    return anims

def build(data,images):
    r=Reader(data);assert r.f.read(4)==b'BILD' and r.read('I')==6
    ns,nf=r.read('2I');name=r.string();atlases=[r.string() for _ in range(r.read('I'))];syms={}
    for _ in range(ns):
        sym=r.read('I');fs=[]
        for _ in range(r.read('I')):
            frame,duration=r.read('2I');bounds=r.read('4f');start,count=r.read('2I')
            fs.append({'frame':frame,'duration':duration,'bounds':bounds,'start':start,'count':count})
        syms[sym]=fs
    verts=[r.read('6f') for _ in range(r.read('I'))];hashes=r.hashes();assert not r.f.read()
    result={}
    for sym,frames in syms.items():
        for f in frames:
            start,count=f.pop('start'),f.pop('count');pieces=[]
            assert count%6==0
            for i in range(start,start+count,6):
                v=verts[i:i+6];ai=int(v[0][5]);w,h=images[ai].size
                x0=min(p[0] for p in v);y0=min(p[1] for p in v)
                x1=max(p[0] for p in v);y1=max(p[1] for p in v)
                u0=min(p[3] for p in v);u1=max(p[3] for p in v)
                v0=min(p[4] for p in v);v1=max(p[4] for p in v)
                sx,sy=u0*w,(1-v1)*h;sw,sh=(u1-u0)*w,(v1-v0)*h
                pieces.append([ai,sx,sy,sw,sh,x0,y0,x1-x0,y1-y0])
            f['pieces']=pieces
        result[hashes.get(sym,str(sym))]=frames
    return name,result

ENTITIES={
 'player':{'build':'wathgrithr','bank':'wilson','extra_builds':['player_lunge','frozen'],'symbol_aliases':{'swap_frozen':'frozen'},'anims':['player_basic','player_idles','player_attacks','player_actions','player_hit_darkness','player_lunge','player_frozen','player_shock',{'file':'player_actions_item','only':['item_in','item_out','pickup','pickup_pst']}]},
 'hound':{'build':'hound','anims':['hound_basic']},
 'spider':{'build':'spider_build','anims':['ds_spider_basic']},
 'tallbird':{'build':'ds_tallbird_basic','anims':['ds_tallbird_basic']},
 'leif':{'build':'leif_build','anims':['leif_actions','leif_attacks','leif_idles','leif_walking']},
 'tentacle':{'build':'tentacle','anims':['tentacle']},
 'spear':{'build':'swap_spear','anims':[]},
 'spear_lightning':{'build':'spear_wathgrithr_lightning','anims':['spear_wathgrithr_lightning']},
 'killerbee':{'build':'bee_angry_build','bank':'bee','anims':['bee']},
 'knight':{'build':'knight_build','bank':'knight','anims':['knight']},
 'werepig':{'build':'werepig_build','bank':'pigman','hide_layers':['hat','ARM_carry','ARM_carry_up'],'anims':['werepig_basic','werepig_actions',{'file':'ds_pig_actions','only':['hit','death','eat']},{'file':'ds_pig_basic','only':['shock_loop','shock_pst']}]},
 'elec_lunge_fx':{'build':'elec_lunge_fx','bank':'elec_lunge_fx','anims':['elec_lunge_fx']},
 'elec_hit_fx':{'build':'elec_hit_fx','bank':'elec_hit_fx','anims':['elec_hit_fx']},
 'cane':{'build':'swap_cane','bank':'cane','anims':['cane']},
 'reticuleline':{'build':'reticuleline','bank':'reticuleline','anims':['reticuleline'],'tints':{'gold':[1,.75,0,1],'invalid':[.5,0,0,1]}},
 'recharge_meter':{'build':'recharge_meter','bank':'recharge_meter','anims':['recharge_meter'],'tints':{'frame':[0,0,.3,.54],'cooldown':[0,0,.4,.64]}},
 'pigman':{'build':'pig_build','bank':'pigman','hide_layers':['hat','ARM_carry','ARM_carry_up'],'anims':['ds_pig_basic','ds_pig_actions','ds_pig_attacks','ds_pig_elite','merm_actions']},
 'pigguard':{'build':'pig_guard_build','bank':'pigman','hide_layers':['hat','ARM_carry','ARM_carry_up'],'anims':['ds_pig_basic','ds_pig_actions','ds_pig_attacks','ds_pig_elite','merm_actions']},
 'bunnyman':{'build':'manrabbit_build','bank':'manrabbit','render_scale':1.25,'hide_layers':['hat','ARM_carry','HAIR_HAT'],'anims':['manrabbit_basic','manrabbit_actions','manrabbit_attacks']},
 'merm':{'build':'merm_build','bank':'pigman','hide_layers':['hat','ARM_carry','ARM_carry_up'],'anims':['ds_pig_basic','ds_pig_actions','ds_pig_attacks','ds_pig_elite','merm_actions','merm_actions_skills']},
 'mermguard':{'build':'merm_guard_small_build','bank':'pigman','render_scale':.9,'hide_layers':['hat','ARM_carry','ARM_carry_up'],'anims':['ds_pig_basic','ds_pig_actions','ds_pig_attacks','ds_pig_elite','merm_actions','merm_actions_skills','merm_guard_transformation']},
 'beefalo':{'build':'beefalo_build','bank':'beefalo','hide_layers':['HEAT'],'anims':['beefalo_basic','beefalo_actions','beefalo_actions_domestic','beefalo_actions_quirky']},
 'koalefant_summer':{'build':'koalefant_summer_build','bank':'koalefant','anims':['koalefant_basic','koalefant_actions']},
 'koalefant_winter':{'build':'koalefant_winter_build','bank':'koalefant','anims':['koalefant_basic','koalefant_actions']},
 'spider_warrior':{'build':'spider_warrior_build','bank':'spider','anims':['ds_spider_basic','ds_spider_warrior']},
 'spider_hider':{'build':'ds_spider_caves','bank':'spider_hider','anims':['ds_spider_basic','ds_spider_caves']},
 'spider_dropper':{'build':'spider_white','bank':'spider','anims':['ds_spider_basic','ds_spider_warrior']},
 'bat':{'build':'bat_basic','bank':'bat','render_scale':.75,'anims':['bat_basic']},
 'frog':{'build':'frog','bank':'frog','anims':['frog']},
 'bee':{'build':'bee_build','bank':'bee','anims':['bee']},
 'mosquito':{'build':'mosquito','bank':'mosquito','hide_layers':['body_2','body_3','body_4'],'variants':{'drink2':'mosquito_drink2','drink3':'mosquito_drink3','drink4':'mosquito_drink4'},'anims':['mosquito']},
 'penguin':{'build':'penguin_build','bank':'penguin','anims':['penguin']},
 'catcoon':{'build':'catcoon_build','bank':'catcoon','anims':['catcoon_basic','catcoon_actions']},
 'krampus':{'build':'krampus_build','bank':'krampus','hide_layers':['ARM'],'anims':['krampus_basic']},
 'lightninggoat':{'build':'lightning_goat_build','bank':'lightning_goat','hide_layers':['fx'],'variants':{'charged':'lightninggoat_charged'},'anims':['lightning_goat_basic','lightning_goat_actions']},
 'lightninggoat_charged':{'build':'lightning_goat_shocked_build','bank':'lightning_goat','anims':['lightning_goat_basic','lightning_goat_actions']},
 'slurtle':{'build':'slurtle','bank':'slurtle','anims':['slurtle']},
 'deerclops':{'build':'deerclops_build','bank':'deerclops','render_scale':1.65,'hide_layers':['head_neutral'],'dependencies':['deerclops_ice'],'anims':['deerclops_basic','deerclops_actions']},
 'deerclops_ice':{'build':'deerclops_icespike','bank':'deerclops_icespike','anims':['deerclops_icespike']},
}
for _size in (2,3,4):
    ENTITIES[f'mosquito_drink{_size}']={'build':'mosquito','atlas_prefix':'mosquito','bank':'mosquito','hide_layers':[f'body_{i}' for i in (1,2,3,4) if i!=_size],'anims':['mosquito']}
for _id in ['pigman','pigguard','bunnyman','merm','mermguard','spider_warrior','spider_hider','spider_dropper','frog','bee','mosquito','mosquito_drink2','mosquito_drink3','mosquito_drink4','penguin','catcoon','krampus','lightninggoat','lightninggoat_charged','slurtle','deerclops','deerclops_ice']:
    ENTITIES[_id]['facing_mode']=4
for _id in ['beefalo','koalefant_summer','koalefant_winter','bat']:
    ENTITIES[_id]['facing_mode']=6

def metadata(obj,cfg):
    bank=obj.get('bank') or (obj['animations'][0]['bank'] if obj['animations'] else None)
    hidden=set(obj.get('hideLayers',[])); candidates=[]
    preferred=['idle_loop','idle','were_idle_loop','idle_angry','walk_loop','run_loop']
    for name in preferred:
        candidates=[a for a in obj['animations'] if a['name']==name and a['bank']==bank]
        if candidates:break
    if not candidates:candidates=obj['animations'][:1]
    top=0
    for anim in candidates:
        for frame in anim['frames']:
            for sym,fr,layer,a,b,c,d,tx,ty,*_ in frame['elements']:
                if layer in hidden or sym=='headbase_hat' or layer in ['beakfull']:continue
                sf=next((f for f in obj['symbols'].get(sym,[]) if f['frame']<=fr<f['frame']+f['duration']),None)
                if sf:
                    for _,sx,sy,sw,sh,x,y,w,h in sf['pieces']:
                        top=min(top,*(b*xx+d*yy+ty for xx,yy in [(x,y),(x+w,y),(x,y+h),(x+w,y+h)]))
    durations={}
    for anim in obj['animations']:
        if anim['bank']==bank:durations.setdefault(anim['name'],len(anim['frames'])/anim['fps'])
    variants=cfg.get('variants',{})
    deps=list(dict.fromkeys(cfg.get('dependencies',[])+list(variants.values())))
    return {'bank':bank,'renderScale':cfg.get('render_scale',1),'headHeight':max(30,math.ceil(-top)),
        'hideLayers':obj.get('hideLayers',[]),'dependencies':deps,'variants':variants,'animations':durations,'facingMode':cfg.get('facing_mode')}

def convert_entity(id,cfg):
    with ZipFile(GAME/'data/anim'/f"{cfg['build']}.zip") as z:
        names=sorted((n for n in z.namelist() if n.endswith('.tex')),key=lambda n:int(n.split('-')[1].split('.')[0]))
        images=[tex_image(z.read(n)) for n in names]
        bname,syms=build(z.read('build.bin'),images)
    # Shared player animations may contribute their own FX build. Merge only
    # explicitly listed builds; retain atlas indices and do not overwrite body.
    for extra in cfg.get('extra_builds',[]):
        with ZipFile(GAME/'data/anim'/f'{extra}.zip') as z:
            names=sorted((n for n in z.namelist() if n.endswith('.tex')),key=lambda n:int(n.split('-')[1].split('.')[0]))
            extra_images=[tex_image(z.read(n)) for n in names]
            _,extra_symbols=build(z.read('build.bin'),extra_images)
            offset=len(images)
            for symbol,frames in extra_symbols.items():
                assert symbol not in syms, (id,extra,symbol,'unexpected symbol collision')
                for frame in frames:
                    for piece in frame['pieces']:piece[0]+=offset
                syms[symbol]=frames
            images.extend(extra_images)
    for target,source in cfg.get('symbol_aliases',{}).items():
        syms[target]=syms[source]
    at=[]
    tinted_atlases={}
    for n,im in enumerate(images):
        filename=f"{cfg.get('atlas_prefix',id)}-atlas-{n}.png";buf=BytesIO();im.save(buf,format='PNG',optimize=True)
        output=OUT/filename
        if not output.exists() or output.read_bytes()!=buf.getvalue():output.write_bytes(buf.getvalue())
        at.append({'src':'assets/'+filename,'width':im.width,'height':im.height})
        for tint_name,mult in cfg.get('tints',{}).items():
            pixels=np.asarray(im).astype(np.float32)*np.array(mult,dtype=np.float32)
            tinted=Image.fromarray(pixels.astype(np.uint8));buf=BytesIO();tinted.save(buf,format='PNG',optimize=True)
            tint_file=f'{id}-{tint_name}-atlas-{n}.png';output=OUT/tint_file
            if not output.exists() or output.read_bytes()!=buf.getvalue():output.write_bytes(buf.getvalue())
            tinted_atlases.setdefault(tint_name,[]).append({'src':'assets/'+tint_file,'width':im.width,'height':im.height})
    anims=[]
    for source in cfg['anims']:
        name=source if isinstance(source,str) else source['file']
        with ZipFile(GAME/'data/anim'/f'{name}.zip') as z:
            parsed=parse_anim(z.read('anim.bin'))
            if isinstance(source,dict) and 'only' in source:parsed=[a for a in parsed if a['name'] in source['only']]
            anims+=parsed
    banks=set(a['bank'] for a in anims)
    bank=cfg.get('bank') or (next(iter(banks)) if len(banks)==1 else None)
    if bank:anims=[a for a in anims if a['bank']==bank]
    assert bank or not anims, (id,'ambiguous animation bank',banks)
    seen=set()
    for a in anims:
        key=(a['bank'],a['name'],a['facings'])
        # Existing leif banks contain identical shock clips in two source files;
        # keep all source data and let bank-aware playback select the first.
        seen.add(key)
    obj={'id':id,'build':bname,'bank':bank,'hideLayers':cfg.get('hide_layers',[]),'atlases':at,'symbols':syms,'animations':anims,'sources':cfg}
    if tinted_atlases:obj['tintedAtlases']=tinted_atlases
    obj['metadata']=metadata(obj,cfg)
    (OUT/f'{id}.json').write_text(json.dumps(roundfloats(obj),separators=(',',':')),encoding='utf-8')
    print(id,bname,len(syms),'symbols',len(anims),'animations',[(a['name'],a['facings'],len(a['frames'])) for a in anims[:12]],flush=True)
    return obj,images

def main():
    parser=argparse.ArgumentParser(description='Convert selected DST entities without writing to the game installation.')
    parser.add_argument('entities',nargs='*',choices=sorted(ENTITIES))
    args=parser.parse_args()
    manifest_path=OUT/'manifest.json'
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'version':1,'entities':{}}
    manifest['gameVersion']=(GAME/'version.txt').read_text().strip()
    for id in (args.entities or ENTITIES):
        cfg=ENTITIES[id]
        convert_entity(id,cfg);manifest['entities'][id]='assets/'+id+'.json'
    manifest['metadata']={}
    for id,path in manifest['entities'].items():
        obj=json.loads((PROJECT/'dist'/path).read_text())
        manifest['metadata'][id]=metadata(obj,ENTITIES.get(id,{}))
    manifest_path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')

if __name__=='__main__': main()
