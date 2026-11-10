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
| JA2 1.0x | 95–99 | stats and inventory |
| JA2 1.13, 2008 builds | 103 | stats |
| JA2 1.13 release **v5** ([1dot13/source](https://github.com/1dot13/source) tag `v5`) | 185 | stats, traits, records, replacing items |

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
  JAPE table has no such information.
- Ammo lists every magazine of the gun's calibre. Changing a gun to one whose
  loaded magazine has another calibre loads its default magazine, full.
- Attachments: weapons get weapon attachments, grenades and detonators; body
  armor gets Ceramic Plates. The item format has exactly 4 attachment slots.
- A value already in the save that breaks these rules is still shown, so it is
  never changed silently.
- Choosing an attachment sets its status to 100%; setting it back to None sets
  the status to 0%.
- Ammo types of four magazines are corrected to the JA2 1.12 data (the original
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
  Full Dress, Add AUG, Add LAW, Add rifle and Add dragunov for the selected
  merc, then (after a gap) Repair all, Reload all and Full Dress all for the
  whole team.
- **Full Dress** puts on Coated
  Spectra Helmet, Coated Spectra Vest with 4 Ceramic Plates, Coated Spectra
  Leggings, Night Vision Goggles and Extended Ear, all at 100%, replacing what
  is in those five slots. The stored weight is set as the game computes it
  (item + attachments, JA2 1.12 weights). The game uses one plate at a time and
  removes a plate when it is destroyed, so the next one takes over.
- JA2 1.0x saves: **Add LAW** creates 6 LAWs stacked in one slot, **Add rifle**
  an Auto Rocket Rifle loaded with 255 HEAP minirockets, **Add AUG** a Steyr AUG
  loaded with 255 rounds of 5.56mm HP, **Add dragunov** a Dragunov loaded with
  255 rounds of its default magazine, 7.62mm WP Magazine (AP); all three guns
  get Laser Scope and Sniper Scope attached at 100%, no silencer (the game applies attachment bonuses by
  looking the attachment up on the gun). They go into the first
  empty slot searching from the last one (small pockets first), skipping slots
  the slot rules forbid (armour and head gear slots, a hand blocked by a
  two-handed weapon). They are built the way the game creates items
  (`CreateGun`/`CreateItems`): status 100, not fingerprint-locked (the rifle
  locks to the first merc who uses it), weight as the game computes it.
  The game itself allows one LAW per slot and only in big pockets or hands;
  firing a LAW turns the whole object in the hand into one discarded LAW, so
  fire LAWs one at a time, not from the stack of 6.
- JA2 1.0x saves, whole team (every merc marked `*`, whoever is selected):
  **Repair all** raises every item and attachment status below 100% to 100%
  (magazines are left alone: their "status" is the rounds); **Reload all** loads
  every single magazine-fed gun with 255 rounds (the most the game's
  ubGunShotsLeft holds; a gun holding a magazine of another calibre gets its
  default magazine, HEAP minirockets are kept) and updates its weight; **Full Dress all**
  is Full Dress for everyone.
- Experimental, JA2 1.0x saves: every gun's Ammo list also offers
  **Minirockets, HEAP**; choosing it sets the ammo type to 10 (HEAT). The game
  decides what a shot does from the gun's ammo type, not from its calibre, so
  such a gun pierces armour like AP, does HE damage, can hurt tanks and shows an
  explosion on impact. Reloading in the game still needs magazines of the gun's
  own calibre; once the loaded rounds are gone the effect is gone too.
- Money Value is the full 4-byte amount (`uiMoneyAmount`); the original edited
  only the low 2 bytes, so amounts above 65,535 were cut. The game itself keeps
  at most 20,000 per slot (10,000 in a small pocket).
- Object weights are computed as the game does (item + attachments + loaded
  magazine) from the JA2 1.12 item weights in `js/weights.js`.
- Added: Save As..., status bar, unsaved-changes warning when closing the tab.

## Tests

```
node test/run.js [saves-dir]
```

Loads every `.sav` in `saves-dir` (default `../saves`), checks that an unchanged
save is written back byte-identical, applies an edit script and checks the result
reloads with valid checksums. With `--ref <dir>` it also compares every field and
the edited file byte-for-byte with output of the original Java program.

For JA2 1.13 v5 saves it checks that all 255 profiles load, team members are
linked, and that editing a team member and a profile changes only those records
and reloads with valid checksums. It also replaces a gun (factory attachments,
default magazine, same-calibre magazine kept) and an item with an attachment,
then checks that the file reloads, the items survive, and every other soldier
and the rest of the file stay byte-identical.

Verified on two JA2 1.0x saves (version 99, Polish release) and one JA2 1.13 v5
save (version 185). The 1.13 version 103 code path is a direct port of JAPE 0.41
but has not been run against a real save of that version.

## Files

- `js/codetables.js`, `js/items.js` – data tables generated from `JapeConst.java`
  and `ItemExemplar.java`
- `js/weights.js` – JA2 1.12 item weights (generated from the JA2 Stracciatella data)
- `js/alg.js` – save cipher and checksums
- `js/fields.js`, `js/model.js` – field types, Actor / Mercenary / Item structures
- `js/savegame.js` – reading and writing the save file
- `js/savegame113.js` – JA2 1.13 v5 saves (version 185)
- `js/items113_v5.js` – JA2 1.13 v5 item data (generated, see above)
- `js/items113.js` – 1.13 item rules: replacement options, building new objects
- `js/ui.js` – the interface (jQuery)
