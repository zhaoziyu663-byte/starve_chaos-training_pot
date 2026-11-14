"""Extract a small, reproducible set of original UI and terrain images."""
from convert_assets import *

def main():
    ui_path=OUT/'ui.json'
    result=json.loads(ui_path.read_text()) if ui_path.exists() else {}
    selected={
       'images/hud.xml':['inventory_corner.tex','inventory_bg_arrow.tex','inventory_bg.tex','inventory_bg_cover.tex','inventory_filler.tex','inv_slot.tex','stat_bar.tex','equip_slot.tex','equip_slot_body.tex','equip_slot_head.tex','equip_slot_hud.tex','equip_slot_body_hud.tex','equip_slot_head_hud.tex','slot_select.tex'],
       'images/frontend.xml':['button_square.tex','button_square_highlight.tex','button_long.tex','button_long_highlight.tex','button_long_down.tex','button_xlong.tex'],
       'images/global_redux.xml':['status_health.tex','progressbar_wxplarge_frame.tex','progressbar_wxplarge_fill.tex'],
       'images/inventoryimages3.xml':['spear.tex','spear_wathgrithr_lightning.tex','spear_wathgrithr_lightning_charged.tex'],
       'images/inventoryimages1.xml':['cane.tex','cutgrass.tex'],
       'images/inventoryimages2.xml':['itemtile_lightning.tex'],
    }
    with ZipFile(GAME/'data/databundles/images.zip') as z:
        for filename,wanted in selected.items():
            root=ET.fromstring(z.read(filename)); texname=root.find('Texture').attrib['filename']; path='images/'+texname
            data=z.read(path) if path in z.namelist() else (GAME/'data'/path).read_bytes()
            im=tex_image(data)
            for e in root.findall('.//Element'):
                if e.attrib['name'] not in wanted:continue
                at=e.attrib;u1,u2,v1,v2=[float(at[n]) for n in ['u1','u2','v1','v2']]
                box=(math.floor(u1*im.width),math.floor((1-v2)*im.height),math.ceil(u2*im.width),math.ceil((1-v1)*im.height))
                crop=im.crop(box); id=Path(at['name']).stem; output='ui-'+id+'.png';crop.save(OUT/output)
                result[id]={'src':'assets/'+output,'width':crop.width,'height':crop.height,'source':filename+':'+at['name']}
    for n in ['Ground_noise','Ground_noise_grass_detail','mini_forest_noise','mini_grass_noise']:
        path=GAME/'data/levels/textures'/f'{n}.tex'
        if not path.exists():continue
        im=tex_image(path.read_bytes());output='ground-'+n.lower()+'.png';im.save(OUT/output)
        result[n]={'src':'assets/'+output,'width':im.width,'height':im.height,'source':str(path.relative_to(GAME))}
    epic=Path(r'E:\steam\steamapps\workshop\content\322330\1185229307\images\hud')
    if (epic/'epichealthbar.xml').exists():
        root=ET.fromstring((epic/'epichealthbar.xml').read_bytes());im=tex_image((epic/'epichealthbar.tex').read_bytes())
        for e in root.findall('.//Element'):
            at=e.attrib;u1,u2,v1,v2=[float(at[n]) for n in ['u1','u2','v1','v2']]
            box=(math.floor(u1*im.width),math.floor((1-v2)*im.height),math.ceil(u2*im.width),math.ceil((1-v1)*im.height))
            crop=im.crop(box);id='epic-'+Path(at['name']).stem;output='ui-'+id+'.png';crop.save(OUT/output)
            result[id]={'src':'assets/'+output,'width':crop.width,'height':crop.height,'source':'workshop-1185229307:epichealthbar.xml:'+at['name']}
    # Durability uses Text(NUMBERFONT,42), not a separate meter texture. Preserve
    # the original digit and percent glyphs for a faithful small UI canvas.
    with ZipFile(GAME/'data/databundles/fonts.zip') as z:
        with ZipFile(BytesIO(z.read('fonts/stint-ucr50.zip'))) as font:
            meta=ET.fromstring(font.read('font.fnt'));im=tex_image(font.read('font.tex'))
            wanted=set('0123456789%/');glyphs={};x=0
            chars=[c.attrib for c in meta.findall('.//char') if chr(int(c.attrib['id'])) in wanted]
            strip=Image.new('RGBA',(sum(int(c['width'])+2 for c in chars),max(int(c['height']) for c in chars)))
            for c in chars:
                gx,gy,w,h=[int(c[k]) for k in ['x','y','width','height']]
                strip.paste(im.crop((gx,gy,gx+w,gy+h)),(x,0))
                glyphs[chr(int(c['id']))]={'x':x,'y':0,'width':w,'height':h,'xoffset':int(c['xoffset']),'yoffset':int(c['yoffset']),'xadvance':int(c['xadvance'])};x+=w+2
            strip.save(OUT/'ui-numberfont.png')
            result['numberfont']={'src':'assets/ui-numberfont.png','width':strip.width,'height':strip.height,'size':int(meta.find('info').attrib['size']),'lineHeight':int(meta.find('common').attrib['lineHeight']),'glyphs':glyphs,'source':'fonts/stint-ucr50.zip'}
    ui_path.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
    # A contact sheet exposes bad UV orientation or cropping immediately.
    sheet=Image.new('RGBA',(1000,math.ceil(len(result)/4)*180),(67,67,51,255))
    for i,(id,cfg) in enumerate(result.items()):
        im=Image.open(PROJECT/'dist'/cfg['src']);im.thumbnail((230,140));x=(i%4)*250;y=(i//4)*180
        sheet.alpha_composite(im,(x,y+25));ImageDraw.Draw(sheet).text((x+5,y+5),id,fill='white')
    sheet.save(PROJECT/'tools/ui-contact-sheet.png')

if __name__=='__main__':main()
