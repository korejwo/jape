# JAPE – JavaScript port

Jagged Alliance 2 save game editor, ported from JAPE 0.41 (Java, Douglas Greiman,
GPL – see `LICENSE`) to plain HTML + JavaScript + jQuery 4.0.0. No build step.

## Running

Open `index.html` in a browser (double-click works, no server needed), then
**File › Open...** and pick `SavedGames\SaveGameNN.sav`.

| Browser | Open / Save |
|---|---|
| Chrome, Edge | Save overwrites the opened file (the browser asks for permission once). Save As... writes a new file. |
| Firefox, Safari | Save downloads the modified file under the same name; copy it back into `SavedGames`. |

Shortcuts: Ctrl+O open, Ctrl+S save, Ctrl+Shift+S save as. In the character list:
arrow keys, PgUp/PgDn, Home/End, or a letter to jump to a nickname.

Supported saves:

| Game | Save version | What can be edited |
|---|---|---|
| JA2 Classic / 1.0x | 95–99 | stats and inventory, Classic item catalog |
| JA2 Wildfire **6.04**, `Build 25.10.05` | 99 | stats and inventory, Wildfire item catalog |
| JA2 1.13, 2008 builds | 103 | stats |
| JA2 1.13 release **v5** ([1dot13/source](https://github.com/1dot13/source) tag `v5`) | 185 | stats, traits, records, replacing items |

## Reference sources and current game

[JA2 Stracciatella](https://github.com/ja2-stracciatella/ja2-stracciatella)
provides source code used as a reference for classic JA2 mechanics. In the local
workspace, `..\tools\strac` contains source excerpts and `..\tools\ja2data`
contains externalized game data.

As of 2026-11-11, the user primarily plays the game installed at
`F:\SteamLibrary\steamapps\common\ja2_wildfire`. The directory name alone does
not identify the executable version or save format: verify these before
assuming that Stracciatella or JA2 1.13 v5 mechanics and layouts apply.

The main `WF6.exe` has now been verified: PE32/x86, file-version metadata
`6, 0, 0, 2`, Wildfire 6.04 artwork, and save-header build `Build 25.10.05`.
Its SHA-256 is
`aebfe1f4a4b4890fef6e1ec86585bd26879c27a022a74255ae3448162912a2f0`.
The separate `JA2Classic\ja2.exe` embeds `Build 99.09.22`; it is not the same game.

## Classic and Wildfire item catalogs

The save version alone cannot identify the item set: both Classic and Wildfire
can write version 99. The editor selects the Wildfire catalog **only** for
version 99 with the exact header build `Build 25.10.05`. Other 95–99 saves keep
the Classic catalog; version 185 keeps its separate 1.13 v5 catalog. Unknown
Wildfire builds and mods with changed items are not covered by this detection.

- Classic keeps its original 302 choices. Wildfire has 306, including **VSS**
  (`0x42`), **V-94** (`0x43`), **FN F2000** (`0x44`), **LAW Rocket** (`0xA0`)
  and **Discarded LAW** (`0xF7`). These extra choices never enter Classic lists.
- Existing IDs also differ: for example, `0x01` is Glock 17 in Classic but
  Calico M950 in Wildfire; `0x41` is Auto Rocket Rifle in Classic but AS VAL in
  Wildfire. Wildfire also remaps magazines, silencers and the red dot sight.
  Names, item categories, ammunition filters and defaults use the save's
  catalog, including after switching between games in the same browser tab.
- Wildfire V-94 takes the 12.7mm magazines `0x6F`–`0x71`, not Classic
  minirockets. VSS and AS VAL take 9x39mm magazines. Calibres, magazine
  capacities and ammo types come from the executable, not guesses based on
  names. Some AP-labelled Wildfire magazines use ammo type 3 (super AP), and
  the executable's nominal 100-round magazines actually hold 99.
- Wildfire weights, pocket sizes, armour classes and two-handed flags also
  come from its executable. The unfinished flamethrower fuel (`0x73`),
  unused IDs and unnamed placeholders are not offered. The non-inventory
  balance-display entry (`0x10C`) is also omitted from Wildfire's list.
- An unknown ID already present in a save is still displayed as
  `Unknown (id)` in its selected slot and preserved. It does not expand that
  game's catalog or become a choice in other slots.
- **Add rifle** creates AS VAL in Wildfire (Auto Rocket Rifle does not exist
  there). **Add AUG** still creates Steyr AUG and **Add dragunov** creates SVD,
  but with their Wildfire magazines: `0x5E` (5.56mm HP), `0x4E` (7.62x54mm AP)
  and `0x69` (9x39mm AP) for AS VAL. The existing 255-round and attachment
  customization remains; LAW and mortar-shell stacks remain weightless.
  Prepare all likewise reloads Wildfire guns with that game's magazines.
- **Add V-94** appears directly below **Add dragunov**, only for Wildfire
  soldiers with inventory; it is enabled only for a team member. It creates
  V-94 (`0x43`) with **255 rounds** of its default **12.7mm AP magazine**
  (`0x6F`, ammo type **3**, super AP), **Laser Scope** and **Sniper Scope**.
  The gun, ammo and both scopes are at 100%; it is not fingerprint-locked
  and weighs 14.0 kg including the magazine and scopes. It uses the first
  allowed empty slot searching from the last one, without replacing other
  items. The button is hidden and disabled for Classic and 1.13 saves.

`js/items_wildfire604.js` is generated by
`..\tools\gen_items_wildfire.py`, using the verified, unmodified analysis PE's
item/weapon/magazine/armour tables and `Data\BinaryData.slf`'s `ITEMDESC.edt`.
The generator verifies the executable, analysis image and archive hashes;
it reuses unchanged English Classic labels and translates localized Wildfire
labels where needed. Do not edit generated data by hand or substitute 1.13 data.

```
python ..\tools\gen_items_wildfire.py F:\SteamLibrary\steamapps\common\ja2_wildfire ..\tools\wf6\WF6_unpacked_for_IDA.pe js\items.js js\items_wildfire604.js
```

## JA2 1.13 v5 saves (version 185)

- Character profiles and soldiers are read with the layouts of the v5 sources
  (`Ja2/SaveLoadGame.cpp`); sizes and offsets were measured by compiling the v5
  headers with MSVC for Win32, the platform of the release build. Every profile
  and soldier checksum is verified on load and recomputed on save; only fixed
  fields inside existing records change, so the file keeps its size.
- The profiles are located by searching for 255 consecutive profiles with valid
  checksums, because the sections before them vary in size.
- Team members (`*`): soldiers of OUR_TEAM that are not vehicles, linked to
  their profile by profile number.
- Skill1–Skill3 are the first three trait slots, named after the trait system
  stored in the save (new or old 1.13 traits).
- Kills / Assists / Shots Fired / Shots Hit / Battles / Times Wounded map to the
  1.13 records 1.13 itself converts the classic values into: regular-army kills,
  merc assists, shots fired, shots hit, tactical battles, times wounded by shots.
- Inventory: the panel on the right lists the soldier's items; an item can be
  replaced with another of the same kind – gun with gun, melee weapon with the
  same melee type, armour with armour of the same class (helmet, vest,
  leggings, plate). LBE gear, ammo, grenades, kits and other items cannot be
  replaced. Item data (names, classes, calibres, factory attachments) is built
  in, from the data of the v5 release (`js/items113_v5.js`, generated from
  github.com/1dot13/gamedir commit dff4c929d5f9); mods that change items are not
  taken into account. Item names are the English ones from `Data-1.13`.
- Replacing follows the game's own item creation (`CreateItem`, `CreateGun`,
  `AttachDefaultAttachments` in the v5 sources):
  - the old item's attachments are removed and the new one gets its factory
    attachments (`DefaultAttachment`);
  - a gun keeps its loaded magazine if the calibre matches (rounds limited to
    the new magazine size), otherwise it gets its default magazine, full;
  - every object of a stack is replaced, status is kept;
  - a pocket only takes items no bigger than the one it held; a two-handed gun
    in the hand needs an empty second hand, and the second hand is locked while
    the hand holds a two-handed gun.
- With the new attachment system the attachment list is saved with just the
  factory attachments; the game sorts them into their slots when it loads the
  save, and an item without factory attachments gets its empty slots when its
  description is first opened. Because objects change size, the soldier
  section of the file is rebuilt; everything after it is copied unchanged.
- Only the v5 format is supported for version 185: development builds of the
  ExtraMercs branch also wrote "185" with a different soldier layout, and the
  current development version writes 187.

## Differences from the Java original

- Only characters on the player's team (soldier slots 0–19, marked `*`) can be
  edited. Other profiles, and NPCs present in the sector, are shown read-only.
- Helmet / Body armor / Leg armor slots (top right) and the two head gear slots
  (top left) only offer items of the matching category.
- The right hand (3rd row, left) only takes weapons a merc can hold: firearms,
  launchers, LAW and melee weapons (no creature attacks, no tank cannon).
- A two-handed weapon in the right hand locks the left hand (4th row). Choosing
  a two-handed weapon while the left hand holds something is refused with
  "Empty the left hand first". Two-handed flags come from the JA2 1.12 item data
  (`bTwoHanded`, as published by the JA2 Stracciatella project); the original
  JAPE table has no such information. Wildfire uses its own executable flags.
- Ammo lists every magazine of the gun's calibre. Changing a gun to one whose
  loaded magazine has another calibre loads its default magazine, full.
- Attachments: weapons get weapon attachments, grenades and detonators; body
  armor gets Ceramic Plates. The item format has exactly 4 attachment slots.
- A value already in the save that breaks these rules is still shown, so it is
  never changed silently.
- Choosing an attachment sets its status to 100%; setting it back to None sets
  the status to 0%.
- Classic ammo types of four magazines are corrected to the JA2 1.12 data (the original
  table had them wrong): 4.7mm and Minirockets AP are super AP (3), the regular
  12 Gauge magazine is regular (0), and the HP minirockets are really HE (9) and
  are named "Minirockets, HE".
- Number boxes accept digits only, clamped to the field: 0–127 for values the
  game stores as signed bytes (stats, energy, morale, item status – the original
  allowed up to 255, which the game reads as negative), 0–255 or 0–65535
  otherwise, 0–4,294,967,295 for Money Value. Name/Nickname are limited to 30/10 characters and stored as real UTF-16.
- The character list follows Nickname edits; option lists use item ids, so
  duplicate names (Key, Syringe, Bloodcat Claws) are stored correctly.
- Item editing is disabled, with a note, for 1.13 saves (as in the original,
  which never supported it).
- JA2 1.0x saves: Agility, Dexterity, Strength, Wisdom, Marksmanship,
  Explosives, Mechanical and Medical have **+1** and **+10** buttons. They raise
  the value, up to 100, and the increase in brackets by the same number of points.
- JA2 1.0x saves: the custom buttons sit in their own column right of the
  inventory slots (the window is therefore wider than the original, about 1040 px):
  Add AUG, Add LAW, Add mortar shell, Add rifle and Add dragunov for the selected
  merc, plus **Add V-94** directly below them for Wildfire, then **Prepare all**
  for the whole team. The separate Repair all,
  Reload all, Full Dress all and individual Full Dress buttons have been removed.
- Classic saves: **Add LAW** creates 6 weightless LAWs stacked in one slot,
  **Add rifle** an Auto Rocket Rifle loaded with 255 HEAP minirockets, **Add AUG** a Steyr AUG
  loaded with 255 rounds of 5.56mm HP, **Add dragunov** a Dragunov loaded with
  255 rounds of its default magazine, 7.62mm WP Magazine (AP); all three guns
  get Laser Scope and Sniper Scope attached at 100%, no silencer (the game applies attachment bonuses by
  looking the attachment up on the gun). They go into the first
  empty slot searching from the last one (small pockets first), skipping slots
  the slot rules forbid (armour and head gear slots, a hand blocked by a
  two-handed weapon). They are built the way the game creates items
  (`CreateGun`/`CreateItems`): status 100, not fingerprint-locked (the rifle
  locks to the first merc who uses it), weight as the game computes it, except
  for Add LAW, which deliberately stores weight 0.
  The game itself allows one LAW per slot and only in big pockets or hands;
  firing a LAW turns the whole object in the hand into one discarded LAW, so
  fire LAWs one at a time, not from the stack of 6.
- JA2 1.0x saves: **Add mortar shell** creates 6 weightless Mortar Shells at 100%
  stacked in one slot, in the first allowed empty slot searching from the last one.
- JA2 1.0x saves, whole team (every merc marked `*`, whoever is selected):
  **Prepare all** combines repair, reload and Full Dress in one click. It
  raises every item and attachment status below 100% to 100%
  (magazines are left alone: their "status" is the rounds) and restores each
  merc's Health to their existing Max Health, without changing Max Health or
  Health Inc. It also restores both Energy and Max Energy to 100, removing
  the lowered energy limit from fatigue. It renews the magazine of every single
  magazine-fed gun: 255 rounds (the most
  the game's ubGunShotsLeft holds), ammo status 100% (a negative status means a
  jammed gun, so this also clears a jam) and **Ammo Variety 8** (knife). The
  loaded magazine is kept; a gun with no magazine or one of another calibre
  gets its default magazine. The weight is updated. Everyone receives Coated
  Spectra Helmet, Coated Spectra Vest with 4 Ceramic Plates, Coated Spectra
  Leggings, Night Vision Goggles and Extended Ear at 100%, replacing the items
  in those five slots. Armour weights include attachments; the game uses one
  plate at a time and removes it when destroyed, so the next takes over.
  Prepare all also supplies a Medical Kit and a Camouflage Kit at 100%: existing
  kits are refilled without adding duplicates; otherwise a new kit is put in
  the first empty pocket that fits, searching from the last one, or an
  unblocked left hand. Medical Kits require big pockets; Camouflage Kits also
  fit small pockets. If no suitable slot is free, a message lists the mercs
  and the kits they could not receive; other inventory items are not overwritten.
  The selected merc's stats and inventory are refreshed; an already prepared
  team does not mark the save modified again.
- Ammo Variety (`ubGunAmmoType`) is what decides the effect of a shot, not the
  magazine in the Ammo field. Type 8 (knife) is not stopped by vests and
  leggings (helmets and Ceramic Plates still count), and a hit to the head or
  torso of an enemy who has not noticed the shooter may kill outright; it does
  not hurt tanks (only 10, HEAT, does). Reloading in the game resets the type to
  that of the new magazine.
- Money Value is the full 4-byte amount (`uiMoneyAmount`); the original edited
  only the low 2 bytes, so amounts above 65,535 were cut. The game itself keeps
  at most 20,000 per slot (10,000 in a small pocket).
- Object weights are computed as the game does (item + attachments + loaded
  magazine), using Classic's JA2 1.12 weights in `js/weights.js` or Wildfire's
  executable weights for a Wildfire save.
- Added: Save As..., status bar, unsaved-changes warning when closing the tab.

## Tests

```
node test/run.js [saves-dir]
```

Loads every `.sav` in `saves-dir` (default `../saves`), checks that an unchanged
save is written back byte-identical, applies an edit script and checks the result
reloads with valid checksums. With `--ref <dir>` it also compares every field and
the edited file byte-for-byte with output of the original Java program.
The two version-99 fixtures were identified as Wildfire, not Classic. Their
original headers exercise Wildfire detection, item selection and round trips.
Legacy Classic/Java checks use copies with an in-memory `Build 99.09.22` header;
Java reference headers are normalized the same way, and fixture files are never
changed. These are synthetic Classic-catalog checks, not genuine Classic saves.

For JA2 1.13 v5 saves it checks that all 255 profiles load, team members are
linked, and that editing a team member and a profile changes only those records
and reloads with valid checksums. It also replaces a gun (factory attachments,
default magazine, same-calibre magazine kept) and an item with an attachment,
then checks that the file reloads, the items survive, and every other soldier
and the rest of the file stay byte-identical.

UI tests drive headless Chrome (expected at
`C:/Program Files/Google/Chrome/Application/chrome.exe`) over the DevTools
protocol and write screenshots to `out-dir`:

```
node test/ui_test.js    . ../saves/SaveGame01.sav <out-dir>
node test/ui_test113.js . ../saves/QuickSave.sav  <out-dir>
```

They assume the content of the test saves (team mercs, items in given slots).
The version-99 UI suite tests the synthetic Classic catalog and the original
Wildfire catalog, including V-94 selection, the Wildfire-only Add V-94 button,
its ammunition and scopes, saving/reloading,
switching editions and preserving an existing unknown item.

Verified on two Wildfire saves (version 99, Polish build `25.10.05`), their
synthetic Classic-catalog variants, and one JA2 1.13 v5 save (version 185).
The 1.13 version 103 code path is a direct port of JAPE 0.41
but has not been run against a real save of that version.

## Files

- `js/codetables.js`, `js/items.js` – data tables generated from `JapeConst.java`
  and `ItemExemplar.java`
- `js/weights.js` – JA2 1.12 item weights (generated from the JA2 Stracciatella data)
- `js/items_wildfire604.js` – verified Wildfire 6.04 items, ammunition and weights (generated)
- `js/alg.js` – save cipher and checksums
- `js/fields.js`, `js/model.js` – field types, Actor / Mercenary / Item structures
- `js/savegame.js` – reading and writing the save file
- `js/savegame113.js` – JA2 1.13 v5 saves (version 185)
- `js/items113_v5.js` – JA2 1.13 v5 item data (generated, see above)
- `js/items113.js` – 1.13 item rules: replacement options, building new objects
- `js/ui.js` – the interface (jQuery)
