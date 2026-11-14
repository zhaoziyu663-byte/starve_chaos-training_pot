# Combat catalog — local DST build 762172

Source was read from the installed `data/databundles/scripts.zip` without modifying the game. This trainer starts creatures already engaged with the player. Seasonal aggression, food, followers, structures, boats, armour and world survival are not simulated. Default merms have no king or Wurt follower upgrades; the guard therefore uses PUNY_MERM values and the small guard build. Beefalo is wild/default, goat starts uncharged, elephants are normal summer/winter variants.

| Added creature | HP / damage / cooldown (s) | Damage frame after attack entry | Distinct combat behavior / source |
|---|---|---|---|
| pigman | 250 / 33 / 3 | 13 | SGpig 249–274 releases busy+attack at 13; pigbrain retreats 5→8 in cooldown |
| pigguard | 600 / 33 / 1.5 | 13 | Same SGpig, pigguardbrain own cooldown and retreat |
| bunnyman | 200 / 40 / 2 | 13 | SGbunnyman 200–227, 537–563 hop movement; brain flees under .333 HP; 5 s regeneration |
| merm | 500 / 30 / 3 | 13 | SGmerm 992–1058; attack stays busy until animation ends; retreat 5→8 |
| mermguard | 200 / 20 / 3 | 13 | merm.lua 481–508: no king uses PUNY_MERM; retreat, no trident/skill buff |
| beefalo | 1000 / 34 / 4 | 15 | SGBeefalo 604–626; combat default period 4; melee outside attack can repeatedly flinch |
| koalefant_summer | 1000 / 50 / 4 | 15 | SGkoalefant 119–141; radius .75, identical summer/winter combat |
| koalefant_winter | 1000 / 50 / 4 | 15 | Same source, different build |
| spider_warrior | 400 / 20 / randomized 4–6 | 25 melee; 19 leap | SGspider 335–371: distance >3 selects warrior_atk, motor 20 at 8f–20f, then taunt |
| spider_dropper | 400 / 20 / randomized 4–6 | 25 / 19 | spider.lua 878–895 creates spider_warrior tag; same leap, different build |
| spider_hider | 225 / 20 / 3 | 25 | spiderbrain shield threshold >50; 3 s without hits; SGspider 529–558 absorbs .75 |
| bat | 50 / 20 / 1 | 10 | SGbat 870–953 motor changes 0/5/10/11/12/13f; hit range1 and 120° arc; ghost collision |
| frog | 100 / 10 / 1 | 25 | SGfrog hop only 5–20f; current user-selected training rule drops one free grass unit per hit and preserves all gear |
| bee | 100 / 10 / 2 | 15 | SGbee; worker bee retreat 6→10 differs from killer bee 3→6 |
| mosquito | 100 / 3 / 7 | 15 | mosquitobrain retreat4→8; drinks starts1, fourth successful bite kills it; SGmosquito 58–85 burst11f, radius3.5, damage34 |
| penguin | 150 / 33 / 3 | 15 stationary; 1 sliding | SGpenguin 432–461 vs 514–536 retains slide velocity; .75 waddle/6 slide |
| catcoon | 150 / 25 / 2 | 16 swipe; 19 pounce | SGcatcoon 25–38, 432–481: beyond3 chooses jump_atk, motor12 at6–20f |
| krampus | 300 / 50 / 1.2 | 18 | SGkrampus 53–75; attack has no busy tag and can be interrupted subject to hit recovery |
| lightninggoat | 700 / 25 / 2 | 12 | SGlightninggoat; walk4/run8 on2–14f; electric hit charges, later melee reflects37.5, charged attacks37.5 before player absorption |
| slurtle | 1200 / 25 / 4 | 9 | slurtlebrain >150 threshold, 2 s without hits; SGslurtle shield absorbs.95; walk only13–21f |

Values originate in `tuning.lua`, corresponding `prefabs/*.lua`, `brains/*.lua` and `stategraphs/SG*.lua`. Weapon target radius and host attack timing remain unchanged. Animation lengths come from the extracted local animation metadata, including direction-specific overrides supplied by the renderer.

## Items, electricity and ice

- **Current training override:** the unique infinite `cutgrass` source starts in slot15 and can be moved to another slot or the cursor. Frog hits create one grass unit without consuming it or moving any gear. Manually dropping the source also emits only one unit and keeps the source on the cursor. At most32 recent grass piles exist; pickups merge into the unique infinite source. This is the user-requested convenience rule, not original DST infinite supply.
- **Original-game research, superseded for frog theft here:** `inventory.lua:623–635` searches bag then active cursor for theft, not equips. Dropped items retain their unique ID, damage and recharge deadline. Ground positions represent settled drops; ballistic toss physics is not simulated. Pickup uses locomotor .15 + player radius .5 + item radius .5 = 1.15 on land; `SGwilson:8027–8063` transfers at6f and returns idle at10f.
- `spear_wathgrithr.lua:46–64,87–109` means a fully charged spear discharges for3s when equipped; an unfinished cooldown is preserved. Recharge is item-owned and continues in bag/on ground during simulation.
- Living merms have the permanent wet tag (`merm.lua:1065–1066`), so both variants take the lightning spear wet multiplier. Merm, beefalo and bunnyman native regeneration ticks are retained.
- `lightninggoat.lua:109–158` charges after the first electric attack, then reflects subsequent non-ranged attacks. Its shocked animation differs from generic electrocution. `SGwilson:3405–3499` uses shock+shock_pst and releases busy at shock length+4f.
- Generic supported monsters use0.8s shock plus their own shock_pst, with repeat-shock cooldown. Goat, knight, submerged tentacle and Deerclops have their dedicated exceptions. Electricity chain-fork effects and environmental burning are outside this arena model.
- Ordinary Deerclops is implemented in `deerclops.js`, with its own source audit and tests: ice spawns31f, first possible hit34f, separate radius1 spikes sharing a per-swing hit set. Player coldness/freezing and break recovery are modeled. NPC ice-spike damage is modeled; NPC-specific frozen states are not.

## Validation

`test-extra-monsters.mjs` independently checks all20 initial damage events and HP, retreat, both spider attacks, both shell absorptions, bunny retreat/regeneration, both penguin attacks, pounce motion, frog hopping, mosquito bursting, charged goat reflection, and actual CombatWorld Deerclops/freeze hooks. `test-ground-items.mjs` checks the explicit grass-only frog rule, movable infinite supply, non-equippable grass, bounded drop count, no duplicate source on pickup, timed gear approach/pickup, persistent item identity/cooldown and restart recovery. Existing combat/range/inventory/skill tests remain regression coverage.
