# Original DST assets: conversion and rendering

All source ZIP/TEX/XML inputs are read-only. Outputs are in the independent
`E:\DST-Combat-Trainer\dist\assets` directory. No game installation, mods,
settings, save files, or launcher files are changed.

Run `python tools/convert_assets.py`, then `python tools/extract_ui.py` from the
project. Pillow and NumPy are required. `python tools/verify_assets.py` produces
a contact sheet outside the game directory for visual checks.

## Format

`manifest.json` maps the entity IDs to their JSON paths (paths relative to dist).
Every entity JSON contains:

- `atlases`: `{src,width,height}` image descriptors. PNGs use straight alpha.
- `symbols`: symbol-name keys, each with an array of symbol frames. Select the
  frame where `frame <= requestedFrame < frame + duration`.
- Each symbol frame has `pieces`, an array of
  `[atlasIndex,sx,sy,sw,sh,dx,dy,dw,dh]`. These are the arguments for
  `drawImage(atlas,sx,sy,sw,sh,dx,dy,dw,dh)`; the tiled pieces preserve the original
  build geometry, including trimmed transparent regions and original pivots.
- `animations`: records with `name,bank,facings,fps,frames`. Animation frames
  contain `bounds` and `elements`. An element is
  `[symbolName,symbolFrame,layerName,a,b,c,d,tx,ty,z]`.

**The native matrix has the same argument order as Canvas:**
`ctx.transform(a,b,c,d,tx,ty)`. Do not transpose b and c.
Draw elements from the end of the array to its beginning (z descending).
Drawing forward hides faces behind heads. Canvas's global coordinate origin
should be the ground contact point; source y coordinates extend upward.

Facing masks: `1=right,2=up,4=left,8=down,16=up-right,32=up-left,
64=down-right,128=down-left,255=all`. Standard entity packs provide 5 (both side
facings), 8 (front), 2 (back). The side sprite faces right; mirror it for left.
Facings 8 and 2 were verified visually on player and hound.

## Layer visibility and weapon replacement

- Player uses `wathgrithr` build and shared original player animations. Hide
  `ARM_normal`, `HEAD_HAT`, `HAT`, `HAT_HAIR`, `HAT_HAIR_FRONT`, `HAT_HAIR_BACK`,
  `HAIR_HAT` layers and `headbase_hat` symbol when unhelmeted and holding a spear.
  Missing optional symbols (skins, beard, hats, frozen FX) are skipped.
- Replace player `swap_object` with weapon symbol `swap_spear` from `spear.json`,
  or `swap_spear_wathgrithr_lightning` from `spear_lightning.json`. Use weapon
  frame 0 for these basic held forms; the raw player frame index is not a weapon
  frame index. Keep the player's attachment matrix.
- Tallbird must hide layer `beakfull`, as the original prefab does.
- No other essential hidden layers were found in the five selected monster
  prefabs. Their special optional frozen/skin symbols are intentionally omitted.

## Assets and validation

Eight packs are included: player, hound, spider, tallbird, leif, tentacle, spear,
spear_lightning. All original exported animation clips run at 30 fps. The complete
sets include attack, idle, movement, hit, and death clips; player also includes
optional shared actions for compatibility. Their frame counts are retained.

`ui.json` lists selected original HUD and weapon icon crops, original terrain
noise, and Epic Healthbar texture crops. Ground noise is intended to be combined
with a base ground color; the `mini_*` terrain images are map textures. Epic
frame/fill are neutral tints, to be tinted by the renderer as the mod does.

`asset-contact-sheet.png` verifies all six entity compositions, matrices, weapons,
alpha unpremultiplication, and layer order. `ui-contact-sheet.png` verifies UV
cropping for UI assets. No game engine executable or mod compiler is invoked.

Binary format reference: Klei's `ds_mod_tools` `buildanimation.py` documents
ANIM v4 and BILD v6: https://github.com/kleientertainment/ds_mod_tools
The decoder is implemented directly in Python for those layouts. TEX BC1/BC2/BC3
pixels are decoded by Pillow via a generated in-memory DDS header; nothing is
written back to TEX or game ZIP files.
