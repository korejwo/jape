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
| JA2 1.13 release **v5** ([1dot13/source](https://github.com/1dot13/source) tag `v5`) | 185 | stats, traits, records |

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
- Inventory is not editable (items come from the mod's Items.xml).
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
- Number boxes accept digits only, clamped to the field: 0–127 for values the
  game stores as signed bytes (stats, energy, morale, item status – the original
  allowed up to 255, which the game reads as negative), 0–255 or 0–65535
  otherwise. Name/Nickname are limited to 30/10 characters and stored as real UTF-16.
- The character list follows Nickname edits; option lists use item ids, so
  duplicate names (Key, Syringe, Bloodcat Claws) are stored correctly.
- Item editing is disabled, with a note, for 1.13 saves (as in the original,
  which never supported it).
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
and reloads with valid checksums.

Verified on two JA2 1.0x saves (version 99, Polish release) and one JA2 1.13 v5
save (version 185). The 1.13 version 103 code path is a direct port of JAPE 0.41
but has not been run against a real save of that version.

## Files

- `js/codetables.js`, `js/items.js` – data tables generated from `JapeConst.java`
  and `ItemExemplar.java`
- `js/alg.js` – save cipher and checksums
- `js/fields.js`, `js/model.js` – field types, Actor / Mercenary / Item structures
- `js/savegame.js` – reading and writing the save file
- `js/savegame113.js` – JA2 1.13 v5 saves (version 185)
- `js/ui.js` – the interface (jQuery)
