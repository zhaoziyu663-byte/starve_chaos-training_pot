"""Extract selected original DST audio samples, never writing to the game tree.

vgmstream r2168 decodes FSB5 Vorbis -> PCM; libsndfile encodes browser Ogg Vorbis.
The manifest keeps sample provenance. FMOD event layering is represented as
separate browser events; this is not a full FMOD DSP/randomisation emulator.
"""
from pathlib import Path
import hashlib
import json
import re
import struct
import subprocess
import sys
import ctypes
import os
import time
from concurrent.futures import ThreadPoolExecutor

BASE = Path(__file__).resolve().parents[1]
GAME = Path("E:/steam/steamapps/common/Don't Starve Together")
SOUND = GAME / "data/sound"
OUT = BASE / "dist/assets/audio"
CACHE = BASE / "tools/audio_cache"
EXE = BASE / "tools/vgmstream/vgmstream-cli.exe"
# Reuse the verified portable decoder without copying or writing its directory.
READONLY_TOOLS = Path('E:/DST-Combat-Trainer/tools')
if not EXE.exists():
    EXE = READONLY_TOOLS / 'vgmstream/vgmstream-cli.exe'
sys.dont_write_bytecode = True
sys.path.insert(0, str(BASE / 'tools/audio_python' if (BASE / 'tools/audio_python').exists() else READONLY_TOOLS / 'audio_python'))
import numpy as np
import soundfile as sf


def bank_samples(bank):
    data = (SOUND / (bank + '.fsb')).read_bytes()
    assert data[:4] == b'FSB5'
    version, count, header_size, name_size = struct.unpack_from('<4I', data, 4)
    start = (60 if version == 1 else 64) + header_size
    names = []
    for i in range(count):
        off = struct.unpack_from('<I', data, start + i * 4)[0]
        end = data.index(b'\0', start + off)
        names.append({'index': i + 1, 'name': data[start + off:end].decode('utf-8')})
    return names


# key, bank, sample-name regular expression, number of variants, gain,
# corresponding script event (where identified), playback trigger frames.
SFX = [
    ('player_swing','sfx',r'^attack_whoosh_weapon_\d+$',4,.48,'dontstarve/wilson/attack_weapon',0),
    ('player_hit','sfx',r'^Impact_bloody_short_\d+$',4,.55,'dontstarve/wilson/hit_animal',8),
    ('player_hit_insect','sfx',r'^impact_insect_sharp_\d+$',4,.55,'dontstarve/impacts/impact_insect_sharp',8),
    ('player_hit_wood','sfx',r'^hit_wood_\d+$',3,.55,'dontstarve/wilson/hit_wood',8),
    ('player_hit_metal','sfx',r'^impact_mech_sharp_\d+$',3,.55,'dontstarve/impacts/impact_mech_sharp',0),
    ('player_dash_prepare','common',r'^twirl_lava_weapons_01$',1,.48,'dontstarve/common/twirl',4),
    ('player_dash','meta3',r'^wigfrid_electric_spear_lunge_v2_DST-\d+$',4,.58,'meta3/wigfrid/spear_lighting_lunge',0),
    ('player_dash_thunder','meta3',r'^wigfrid_spear_thunderclap_DST_-\d+$',4,.55,'meta3/wigfrid/spear_lighting_lunge_thunder',0),
    ('player_electric_hit','wx78',r'^wx78_spark_\d+$',4,.45,'dontstarve/characters/wx78/spark',0),
    ('player_hurt','wathgrithr',r'^wathgrithr_hurt_\d+$',4,.58,'dontstarve/characters/wathgrithr/hurt',None),
    ('player_step','sfx',r'^footstep_grass_\d+$',4,.26,'dontstarve/movement/run_grass',None),
    ('player_step_dirt','sfx',r'^footstep_dirt_\d+$',4,.26,'dontstarve/movement/run_dirt',None),
    ('hound_attack','hound',r'^Hound_attack_\d+$',4,.55,'dontstarve/creatures/hound/attack',14),
    ('hound_hurt','hound',r'^Hound_hurt_\d+$',4,.52,'dontstarve/creatures/hound/hurt',None),
    ('hound_death','hound',r'^Hound_death_\d+$',3,.55,'dontstarve/creatures/hound/death',None),
    ('hound_idle','hound',r'^Hound_pant_\d+$',3,.28,'dontstarve/creatures/hound/pant',None),
    ('hound_bark','hound',r'^Hound_bark_\d+$',4,.45,'dontstarve/creatures/hound/bark',[13,24]),
    ('spider_attack','spider',r'^Spider_attack_\d+$',5,.50,'dontstarve/creatures/spider/attack_grunt',10),
    ('spider_hurt','sfx',r'^Impact_bloody_short_\d+$',4,.45,'dontstarve/creatures/spider/hit_response',None),
    ('spider_death','spider',r'^Spider_death_\d+$',3,.52,'dontstarve/creatures/spider/die',None),
    ('spider_idle','spider',r'^Spider_scream_\d+$',3,.38,'dontstarve/creatures/spider/scream',None),
    ('spider_step','spider',r'^Spider_step_\d+$',3,.18,'dontstarve/creatures/spider/walk_spider',None),
    ('tallbird_attack','tallbird',r'^tallbird_headbut_\d+$',1,.55,'dontstarve/creatures/tallbird/attack',10),
    ('tallbird_hurt','tallbird',r'^tallbird_hurt_\d+$',4,.52,'dontstarve/creatures/tallbird/hurt',None),
    ('tallbird_death','tallbird',r'^tallbird_death_\d+$',1,.55,'dontstarve/creatures/tallbird/death',None),
    ('tallbird_idle','tallbird',r'^tallbird_chirp_\d+$',3,.32,'dontstarve/creatures/tallbird/chirp',None),
    ('leif_attack','leif',r'^Leif_VO_attack_\d+$',4,.52,'dontstarve/creatures/leif/attack_VO',5),
    ('leif_hurt','leif',r'^Leif_VO_hurt_\d+$',3,.50,'dontstarve/creatures/leif/hurt_VO',None),
    ('leif_death','forest',r'^tree_fall_1$',1,.55,'dontstarve/forest/treeFall',None),
    ('leif_idle','leif',r'^Leif_VO_walk_\d+$',3,.28,'dontstarve/creatures/leif/walk_vo',None),
    ('leif_step','leif',r'^Leif_step_\d+$',3,.30,'dontstarve/creatures/leif/footstep',None),
    ('leif_foley','leif',r'^Leif_branchfoley_\d+$',3,.28,'dontstarve/creatures/leif/foley',[0,22]),
    ('tentacle_attack','tentacle',r'^Tentacle_attack_\d+$',4,.52,'dontstarve/tentacle/tentacle_attack',[2,15]),
    ('tentacle_hurt','tentacle',r'^Tentacle_voice_hurt_\d+$',3,.50,'dontstarve/tentacle/tentacle_hurt_VO',None),
    ('tentacle_death','tentacle',r'^Tentacle_voice_death_\d+$',3,.55,'dontstarve/tentacle/tentacle_death_VO',None),
    ('tentacle_emerge','tentacle',r'^Tentacle_breakGround$',1,.45,'dontstarve/tentacle/tentacle_emerge',None),
    ('tentacle_emerge_voice','tentacle',r'^Tentacle_voice_appear_\d+$',3,.32,'dontstarve/tentacle/tentacle_emerge_VO',20),
    ('tentacle_disappear','tentacle',r'^Tentacle_dissappear$',1,.38,'dontstarve/tentacle/tentacle_disappear',0),
    ('tentacle_idle','tentacle',r'^Tentacle_voice_appear_\d+$',3,.32,'dontstarve/tentacle/tentacle_emerge_VO',None),
    ('killerbee_attack','bee',r'^bee_attack_\d+$',4,.48,'dontstarve/bee/killerbee_attack',10),
    ('killerbee_hurt','bee',r'^bee_attack_\d+$',4,.4,'dontstarve/bee/killerbee_hurt',0),
    ('killerbee_death','bee',r'^Bee_death_\d+$',2,.48,'dontstarve/bee/killerbee_death',0),
    ('killerbee_taunt','bee',r'^bee_takeoff_\d+$',2,.35,'dontstarve/bee/killerbee_takeoff',0),
    ('knight_attack','chess',r'^knight_attacklean_\d+$',4,.55,'dontstarve/creatures/knight/attack',14),
    ('knight_hurt','chess',r'^knight_land_\d+$',4,.46,'dontstarve/creatures/knight/hurt',0),
    ('knight_death','chess',r'^knight_hitgroundhard_1$',1,.55,'dontstarve/creatures/knight/death',0),
    ('knight_taunt','chess',r'^knight_voice_\d+$',3,.4,'dontstarve/creatures/knight/voice',0),
    ('knight_paw','chess',r'^knight_pawground_\d+$',3,.3,'dontstarve/creatures/knight/pawground',[10,28]),
    ('werepig_attack','pig',r'^werepig_attack_\d+$',4,.55,'dontstarve/creatures/werepig/attack',15),
    ('werepig_swing','bearger',r'^bearger_swhoosh_\d+$',4,.38,'dontstarve_DLC001/creatures/bearger/swhoosh',10),
    ('werepig_hurt','pig',r'^werepig_hurt_\d+$',4,.48,'dontstarve/creatures/werepig/hurt',0),
    ('werepig_death','pig',r'^werepig_grunt_\d+$',4,.48,'dontstarve/creatures/werepig/grunt',0),
    ('werepig_howl','pig',r'^werepig_howl_',4,.42,'dontstarve/creatures/werepig/howl',20),
    ('werepig_idle','pig',r'^werepig_idle_\d+$',3,.3,'dontstarve/creatures/werepig/idle',0),
    ('bird_ambient','forest_stream',r'^AMB_birds_[123]$',3,.22,'ambient birds (selected source samples)',None),
]
TRACKS = [
    ('ambient','forest_stream','AMB_grassland_LP',.18,'grassland environmental loop'),
    ('calm','music','Working_Remix_V1_172bpm_DST',.19,'dontstarve/music/music_work'),
    ('combat','together','Danger_Remix_V3_1_172bpm_DST',.25,'dontstarve/music/music_danger'),
    ('combat_alt','together','Danger_Remix_V3_2_172bpm_DST',.25,'dontstarve/music/music_danger'),
    ('boss','music',"Don't Starve - EFS 4_4 160bpm",.25,'dontstarve/music/music_epicfight'),
]

# Event paths and cue frames audited in the corresponding stock Lua graphs.
# Resolve their actual sample families with the stock FMOD event reader in
# NOSOUND mode; this is a bounded extraction audit, not a browser FMOD emulator.
NATIVE_AUDIO = []
def native(key, path, bank, frames=0):
    NATIVE_AUDIO.append((key, path, bank, frames))
for kind in ['pigman', 'pigguard']:
    for suffix, name in [('attack','attack'),('hurt','oink'),('death','grunt')]: native(kind+'_'+suffix,'dontstarve/pig/'+name,'pig')
native('punch_whoosh','dontstarve/wilson/attack_whoosh','sfx')
for suffix,name,frame in [('attack','attack',0),('bite','bite',13),('hurt','hurt',0),('death','death',0)]: native('bunnyman_'+suffix,'dontstarve/creatures/bunnyman/'+name,'bunnyman',frame)
for kind,prefix,bank in [('merm','dontstarve/creatures/merm/','merm'),('mermguard','dontstarve/characters/wurt/merm/warrior/','wurt')]:
    for suffix,name in [('attack','attack'),('hurt','hit' if kind=='mermguard' else 'hurt'),('death','death')]:native(kind+'_'+suffix,prefix+name,bank)
for kind,prefix,bank in [('beefalo','dontstarve/beefalo/','beefalo'),('koalefant_summer','dontstarve/creatures/koalefant/','koalefant'),('koalefant_winter','dontstarve/creatures/koalefant/','koalefant')]:
    native(kind+'_attack',prefix+'angry',bank);native(kind+'_death',prefix+'yell',bank)
for kind,folder in [('spider_warrior','spiderwarrior'),('spider_hider','cavespider'),('spider_dropper','spiderwarrior')]:
    prefix='dontstarve/creatures/'+folder+'/'
    for suffix,name,frame in [('attack','attack_grunt',10),('swipe','Attack',10),('hurt','hit_response',0),('death','die',0),('taunt','scream',0),('pounce','attack_grunt',0),('jump','Jump',0),('pounce_swipe','Attack',9)]:native(kind+'_'+suffix,prefix+name,'spider',frame)
for suffix,name,frame in [('attack','bite',8),('flap','flap',10),('hurt','hurt',1),('death','death',1),('taunt','taunt',1)]:native('bat_'+suffix,'dontstarve/creatures/bat/'+name,'bat',frame)
for suffix,name,frame in [('attack','attack_voice',20),('spit','attack_spit',20),('hurt','grunt',0),('death','die',0)]:native('frog_'+suffix,'dontstarve/frog/'+name,'frog',frame)
for suffix,name,frame in [('attack','attack',10),('hurt','hurt',0),('death','death',0),('taunt','takeoff',0)]:native('bee_'+suffix,'dontstarve/bee/bee_'+name,'bee',frame)
for suffix,name,frame in [('attack','attack',10),('hurt','hurt',0),('death','death',0),('burst','explo',0)]:native('mosquito_'+suffix,'dontstarve/creatures/mosquito/mosquito_'+name,'bee',frame)
for suffix,name,frame in [('attack','attack',0),('death','death',0),('taunt','taunt',[0,2,22])]:native('penguin_'+suffix,'dontstarve/creatures/pengull/'+name,'pengull',frame)
for suffix,name,frame in [('attack','swipe',5),('swipe','swipe_whoosh',9),('pounce','attack',5),('jump','jump',14),('hurt','hurt',0),('death','death',1),('taunt','hiss',19)]:native('catcoon_'+suffix,'dontstarve_DLC001/creatures/catcoon/'+name,'catcoon',frame)
for suffix,name,frame in [('attack','attack',0),('swipe','kick_whoosh',14),('hurt','hurt',0),('death','death',0),('taunt','taunt',0)]:native('krampus_'+suffix,'dontstarve/creatures/krampus/'+name,'krampus',frame)
for suffix,name,frame in [('attack','headbutt',9),('hurt','hurt',0),('death','death',0),('taunt','taunt',5),('charged','shocked_electric',0),('charge_voice','shocked_bleet',0),('horn','jacobshorn',1)]:native('lightninggoat_'+suffix,'dontstarve_DLC001/creatures/lightninggoat/'+name,'lightninggoat',frame)
for suffix,name,frame in [('attack','bite',9),('death','death',1),('taunt','taunt',[7,20,33]),('hide','hide',1),('emerge','emerge',1)]:native('slurtle_'+suffix,'dontstarve/creatures/slurtle/'+name,'slurtle',frame)
for suffix,name,frame in [('attack','attack',0),('swipe','swipe',34),('hurt','hurt',0),('death','death',0),('taunt','taunt_grrr',4),('howl','taunt_howl',16),('ice','ice_small',0)]:native('deerclops_'+suffix,'dontstarve/creatures/deerclops/'+name,'deerclops',frame)
native('freeze','dontstarve/common/freezecreature','common')
native('thaw','dontstarve/common/freezethaw','common')
native('breakfreeze','dontstarve/common/break_iceblock','common')
native('inventory_click','dontstarve/HUD/click_object','common')
native('inventory_negative','dontstarve/HUD/click_negative','common')
native('inventory_equip','dontstarve/wilson/equip_item','wilson')
native('inventory_pickup','dontstarve/HUD/collect_resource','sfx')
native('inventory_pickup_grass','aqol/new_test/vegetation_grassy','aqol')
native('inventory_drop','dontstarve/common/dropGeneric','common')


def resolve_native_samples():
    cache_path=BASE/'research/native-audio-selection.json'
    cache=json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}
    missing={path:bank for _,path,bank,_ in NATIVE_AUDIO if cache.get(path,{}).get('mapping')!='compressed-prefix-exact'}
    if not missing:return cache
    candidates={}
    prefixes={}
    for file in SOUND.glob('*.fsb'):
        data=file.read_bytes()
        if data[:4]!=b'FSB5':continue
        version,count,header_size,name_size=struct.unpack_from('<4I',data,4)
        cursor=60 if version==1 else 64
        payload=cursor+header_size+name_size
        names=bank_samples(file.stem)
        for sample in names:
            packed=struct.unpack_from('<Q',data,cursor)[0];cursor+=8;more=packed&1
            while more:
                chunk=struct.unpack_from('<I',data,cursor)[0];cursor+=4;more=chunk&1;cursor+=(chunk>>1)&0xffffff
            candidates.setdefault(packed>>34,[]).append({'bank':file.stem,**sample})
            offset=payload+((packed>>6)&0xfffffff)*16
            prefixes.setdefault(data[offset:offset+512],[]).append({'bank':file.stem,**sample})
    C=ctypes;P=C.c_void_p;PP=C.POINTER(P);I=C.c_int;U=C.c_uint;S=C.c_char_p
    with os.add_dll_directory(str(GAME/'bin64')):
        event=C.WinDLL(str(GAME/'bin64/fmod_event64.dll'));core=C.WinDLL(str(GAME/'bin64/fmodex64.dll'))
        def api(lib,name,args):
            f=getattr(lib,name);f.argtypes=args;f.restype=I;return f
        create=api(event,'FMOD_EventSystem_Create',[PP]);getsys=api(event,'FMOD_EventSystem_GetSystemObject',[P,PP])
        output=api(core,'FMOD_System_SetOutput',[P,I]);init=api(event,'FMOD_EventSystem_Init',[P,I,U,P,U])
        media=api(event,'FMOD_EventSystem_SetMediaPath',[P,S]);load=api(event,'FMOD_EventSystem_Load',[P,S,P,PP])
        get=api(event,'FMOD_EventSystem_GetEvent',[P,S,U,PP]);start=api(event,'FMOD_Event_Start',[P])
        update=api(event,'FMOD_EventSystem_Update',[P]);stop=api(event,'FMOD_Event_Stop',[P,I]);release=api(event,'FMOD_EventSystem_Release',[P])
        channel=api(core,'FMOD_System_GetChannel',[P,I,PP]);playing=api(core,'FMOD_Channel_IsPlaying',[P,C.POINTER(I)])
        sound=api(core,'FMOD_Channel_GetCurrentSound',[P,PP]);length=api(core,'FMOD_Sound_GetLength',[P,C.POINTER(U),U])
        lock=api(core,'FMOD_Sound_Lock',[P,U,U,PP,PP,C.POINTER(U),C.POINTER(U)])
        unlock=api(core,'FMOD_Sound_Unlock',[P,P,P,U,U])
        es=P();system=P();project=P()
        assert create(C.byref(es))==0;assert getsys(es,C.byref(system))==0;assert output(system,2)==0
        assert init(es,64,0,None,0)==0;assert media(es,(str(SOUND)+'/').encode())==0
        try:
            for name in ['dontstarve.fev','dontstarve_DLC001.fev','meta3.fev','aqol.fev']:
                assert load(es,name.encode(),None,C.byref(project))==0
            for path,preferred in missing.items():
                ev=P();result=get(es,path.encode(),0,C.byref(ev))
                if result:raise RuntimeError(f'Native event missing: {path}: {result}')
                seen={}
                for take in range(5):
                    assert start(ev)==0
                    for _ in range(3):
                        update(es);time.sleep(.006)
                        for j in range(64):
                            ch=P();active=I();snd=P();size=U()
                            if channel(system,j,C.byref(ch)) or playing(ch,C.byref(active)) or not active.value or sound(ch,C.byref(snd)):continue
                            p1=P();p2=P();n1=U();n2=U()
                            if lock(snd,0,512,C.byref(p1),C.byref(p2),C.byref(n1),C.byref(n2))==0:
                                raw=C.string_at(p1,n1.value)
                                unlock(snd,p1,p2,n1,n2)
                                matches=prefixes.get(raw,[])
                                if not matches:raise RuntimeError(f'No compressed sample match: {path}')
                                chosen=next((x for x in matches if x['bank']==preferred),next((x for x in matches if x['bank']=='sfx'),matches[0]))
                                seen[hashlib.sha256(raw).hexdigest()]={'sample':chosen,'matches':matches}
                    stop(ev,1);update(es)
                selected=[];evidence={}
                for fingerprint,match in sorted(seen.items()):
                    selected.append(match['sample']);evidence[fingerprint]=match['matches']
                if not selected:raise RuntimeError(f'No compressed sample match: {path}')
                cache[path]={'samples':selected,'compressedPrefixMatches':evidence,'mapping':'compressed-prefix-exact'}
                cache_path.write_text(json.dumps(cache,indent=2),encoding='utf-8')
        finally:release(es)
    return cache


def main():
    # Explicit path containment: generated files can only live under our project.
    for path in [OUT, CACHE]:
        assert path.resolve().is_relative_to(BASE)
        assert not path.resolve().is_relative_to(GAME.resolve())
        path.mkdir(parents=True, exist_ok=True)
    native_samples=resolve_native_samples()
    banks = {r[1] for r in SFX + TRACKS} | {s['bank'] for x in native_samples.values() for s in x['samples']}
    inv = {bank: bank_samples(bank) for bank in banks}
    events = {}
    jobs = {}
    for key, bank, regex, count, volume, event, frames in SFX:
        selected = [x for x in inv[bank] if re.match(regex, x['name'])][:count]
        assert selected, (key, regex)
        files = []
        for s in selected:
            filename = f'{bank}_{s["index"]:04d}.ogg'
            files.append('assets/audio/' + filename)
            jobs[filename] = (bank, s)
        events[key] = {'files':files,'volume':volume,'loop':False,'kind':'sfx',
                       'scriptEvent':event,'triggerFrames':frames}
    for key, bank, sample, volume, event in TRACKS:
        s = next(x for x in inv[bank] if x['name']==sample)
        filename = key + '.ogg'
        jobs[filename] = (bank, s)
        events[key] = {'files':['assets/audio/' + filename], 'volume':volume,
                       'loop':True,'kind':'ambient' if key=='ambient' else 'music',
                       'scriptEvent':event,'fadeSeconds':1.2}
    for key,path,preferred,frames in NATIVE_AUDIO:
        files=[]
        for sample in native_samples[path]['samples']:
            bank=sample['bank'];filename=f'{bank}_{sample["index"]:04d}.ogg'
            if 'assets/audio/'+filename in files:continue
            files.append('assets/audio/'+filename);jobs[filename]=(bank,sample)
        events[key]={'files':files,'volume':.48,'loop':False,'kind':'sfx','scriptEvent':path,'triggerFrames':frames,'mapping':'native-event exact compressed sample prefix'}
    for kind in ['beefalo','koalefant_summer','koalefant_winter','penguin','slurtle']:
        events[kind+'_hurt']={'files':[],'volume':0,'loop':False,'kind':'sfx','triggerFrames':0,'note':'Stock hit state has no dedicated voice; weapon material impact remains audible.'}
    previous_path=OUT/'manifest.json'
    previous=json.loads(previous_path.read_text(encoding='utf-8')) if previous_path.exists() else {}
    hashes={bank+'.fsb':hashlib.sha256((SOUND/(bank+'.fsb')).read_bytes()).hexdigest() for bank in sorted(banks)}
    reused=[]

    def convert(job):
        filename, (bank, sample) = job
        source = SOUND / (bank + '.fsb')
        wav = CACHE / (filename + '.wav')
        output = OUT / filename
        old=previous.get('clips',{}).get(filename)
        if old and output.exists() and old['sampleName']==sample['name'] and old['subsong']==sample['index'] and previous.get('sources',{}).get(bank+'.fsb')==hashes[bank+'.fsb']:
            info=sf.info(output)
            if abs(info.duration-old['duration'])<.00001:
                reused.append(filename)
                return filename,old
        result = subprocess.run([str(EXE),'-i','-s',str(sample['index']),'-o',str(wav),str(source)],
                                capture_output=True,text=True,check=True,
                                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        # Use bounded writes: a single multi-million-frame Vorbis write can
        # crash libsndfile on Windows. Independent short blocks are reliable.
        peak=0.0
        frames=0
        with sf.SoundFile(wav) as inp:
            rate=inp.samplerate
            channels=inp.channels
            with sf.SoundFile(output,'w',samplerate=rate,channels=channels,
                              format='OGG',subtype='VORBIS') as dest:
                for data in inp.blocks(blocksize=16384,dtype='float32',always_2d=True):
                    assert np.isfinite(data).all()
                    peak=max(peak,float(np.abs(data).max()))
                    frames+=len(data)
                    dest.write(data)
        assert frames>0 and peak>0.00001, (filename,'silent')
        info=sf.info(output)
        assert info.samplerate==rate and abs(info.frames-frames)<=1
        wav.unlink()
        return filename, {'bank':bank+'.fsb','subsong':sample['index'],
                          'sampleName':sample['name'],'duration':round(frames/rate,6),
                          'sampleRate':rate,'channels':channels,
                          'peak':round(peak,6),'bytes':output.stat().st_size}

    with ThreadPoolExecutor(max_workers=4) as pool:
        clips=dict(pool.map(convert,jobs.items()))
    # Remove superseded generated samples only inside this project's audio dir.
    for output in OUT.glob('*.ogg'):
        if output.name not in clips and re.match(r'^[a-z_]+_\d{4}\.ogg$', output.name):
            assert output.resolve().parent == OUT.resolve()
            output.unlink()
    # Common frontend aliases; all point to existing original audio clips.
    events['treeguard_attack']=events['leif_attack']
    events['treeguard_hurt']=events['leif_hurt']
    events['treeguard_death']=events['leif_death']
    events['treeguard_idle']=events['leif_idle']
    events['treeguard_step']=events['leif_step']
    manifest={'version':2,'gameVersion':(GAME/'version.txt').read_text().strip(),
              'format':'ogg-vorbis','events':events,'clips':clips,
              'sources':hashes,
              'notes':['Original local game samples; no generated replacement audio.',
                       'Gains are browser mix defaults, not recovered FMOD attenuation values.',
                       'Sample selection uses bank names and Lua events; full FEV DSP, layering and randomisation are not emulated.',
                       'Music uses complete original source tracks with browser looping and crossfades; source tracks are not guaranteed sample-perfect loop boundaries.',
                       'AudioContext must be unlocked by the user start gesture.']}
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    report={'events':len(events),'clips':len(clips),'reusedClips':len(reused),'totalBytes':sum(x['bytes'] for x in clips.values()),
            'tracks':{k:clips[events[k]['files'][0].split('/')[-1]] for k,*_ in TRACKS}}
    (BASE/'research/audio-extraction-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
