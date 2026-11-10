#!/usr/bin/env node
/*
  Save game engine tests for the JAPE JavaScript port.

  Usage:
    node test/run.js [saves-dir] [--ref <dir>]

  For every .sav in saves-dir (default: ../saves next to the web folder):
    1. load it, save it without changes  -> must be byte-identical
    2. apply the edit script below, save, reload -> checksums must validate
  With --ref, also compares against output of the original Java program
  (java_dump_NN.txt, java_edit_NN.sav, java_edit_dump_NN.txt) in <dir>.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '..');
const SCRIPTS = ['codetables.js', 'items.js', 'alg.js', 'fields.js', 'weights.js', 'model.js', 'savegame.js', 'savegame113.js', 'items113_v5.js', 'items113.js'];

function loadEngine() {
  const ctx = vm.createContext({});
  for (const f of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.JAPE;
}

const J = loadEngine();

// ---- helpers ---------------------------------------------------------------------

/** Fields this port reads differently from JAPE 0.41 on purpose (left out of the Java comparison). */
const CHANGED_FROM_JAVA = ['Money Value'];   // UINT32 here, 2 bytes in the original

function withoutChanged(text) {
  return text.split('\n').filter((l) => !CHANGED_FROM_JAVA.some((n) => l.includes('.' + n + '='))).join('\n');
}

function dumpStruct(prefix, s, out) {
  Object.keys(s.fields).sort().forEach((n) => {
    let iv;
    try { iv = String(s.getInt(n)); } catch (e) { iv = 'NaN'; }
    out.push(prefix + n + '=' + s.get(n) + '|' + iv);
  });
}

function dump(game) {
  const out = [];
  out.push('version=' + game.version + ' table=' + game.codeTableIdx + '/' + game.codeTableSubIdx +
    ' actorOffset=' + game.actorOffset + ' mercOffset=' + game.mercOffset + ' mercCount=' + game.mercs.length);
  game.actors.forEach((a, i) => dumpStruct('A' + i + '.', a, out));
  game.mercs.forEach((m, i) => {
    dumpStruct('M' + i + '.', m, out);
    if (m.items) { m.items.forEach((it, k) => dumpStruct('M' + i + '.I' + k + '.', it, out)); }
  });
  return out.join('\n') + '\n';
}

function actorByNick(game, nick) {
  return game.actors.find((a) => a.get('Nickname') === nick) || null;
}

/** Keep in sync with RefDump.java used to produce the --ref files. */
function applyEdits(game) {
  const M = J.Mercenary;
  const qt = new J.Chain([game.getMercByNick('Qt'), actorByNick(game, 'Qt')]);
  const qtMerc = game.getMercByNick('Qt');
  qt.set('Strength', '99');
  qt.set('Health', '90');
  qt.set('Max Health', '100');
  qt.set('Marksmanship Inc', '7');
  qt.set('Kills', '1234');
  qt.set('Skill1', 'Night Ops');
  qt.set('Skill2', 'Auto Weapons');
  qt.set('Name', 'Test Name');
  qt.set('Energy', '55');
  qt.set('Morale', '88');
  const helm = qtMerc.items[M.HELMET];
  helm.set('Item ID', 'Kevlar Helmet');
  helm.set('Item 1 %', '97');
  const hand = qtMerc.items[M.RIGHT_HAND];
  hand.set('Ammo ID', '5.56mm Magazine');
  hand.set('Ammo Quantity', '30');
  hand.set('Attachment 1 ID', 'Sniper Scope');
  hand.set('Attachment 1 %', '100');
  const bp = qtMerc.items[M.BACKPACK_4_2];
  bp.set('Item ID', 'First Aid Kit');
  bp.set('Quantity', '1');
  bp.set('Item 1 %', '100');
  const sh = new J.Chain([game.getMercByNick('Shadow'), actorByNick(game, 'Shadow')]);
  sh.set('Level', '9');
  sh.set('Wisdom', '93');
  const fox = actorByNick(game, 'Fox');
  fox.set('Wisdom', '80');
  fox.set('Battles', '65535');
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; ++i) { if (a[i] !== b[i]) { return i; } }
  return a.length === b.length ? -1 : n;
}

function firstLineDiff(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); ++i) {
    if (la[i] !== lb[i]) { return 'line ' + (i + 1) + ':\n  java: ' + lb[i] + '\n  js:   ' + la[i]; }
  }
  return null;
}

// ---- unit checks -------------------------------------------------------------------

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : '\n     ' + detail));
  if (!ok) { failures++; }
}

(function unitTests() {
  const table = J.CODE_TABLES[1][7];
  const plain = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 0xFF);
  const back = J.Alg.decode(J.Alg.encode(plain, plain.length, table), plain.length, table);
  check('cipher round trip', firstDiff(plain, back) === -1);

  const d = new Uint8Array(40);
  const s = new J.StringField(0, 20);
  s.set(d, 'Zażółć');
  check('UTF-16 name keeps non-Latin characters', s.get(d) === 'Zażółć', s.get(d));
  s.set(d, 'ABCDEFGHIJKLMNOP');
  check('name truncated to field length', s.get(d) === 'ABCDEFGHIJ', s.get(d));

  const money = new J.Item(new Uint8Array(36));
  money.setInt('Item ID', 0xDB);
  money.set('Money Value', '100000');
  check('Money Value is a 4-byte amount', money.getInt('Money Value') === 100000 && money.get('Money Value') === '100000' &&
    Array.from(money.data.slice(8, 12)).join() === '160,134,1,0');
  const sh = new J.ShortField(0);
  sh.setInt(d, 65535);
  check('short field unsigned', sh.getInt(d) === 65535);
  let threw = false;
  try { new J.ByteField(0).set(d, 'x1'); } catch (e) { threw = e instanceof J.NumberFormatError; }
  check('byte field rejects non-numbers', threw);

  check('item table size', J.ITEMS.length === 302, String(J.ITEMS.length));
  check('Glock 17 ammo list', J.exemplar(1).ammoIds.join(',') === '71,73,75', J.exemplar(1).ammoIds.join(','));
  check('no extra ammo for guns (HEAP experiment removed)', J.gunAcceptsAmmo === undefined && J.EXTRA_AMMO_IDS === undefined &&
    J.exemplar(0x01).compatibleAmmoIds.indexOf(0x71) === -1 && J.exemplar(0x41).compatibleAmmoIds.indexOf(0x71) !== -1);
  check('ammo types corrected to the game data (4.7mm, 12 Gauge, minirockets AP/HE)',
    J.exemplar(0x68).ammoVariety === 3 && J.exemplar(0x6B).ammoVariety === 0 && J.exemplar(0x6F).ammoVariety === 3 &&
    J.exemplar(0x70).ammoVariety === 9 && J.exemplar(0x70).name === 'Minirockets, HE' && J.exemplar(0x71).ammoVariety === 10);
  const hex = (ids) => ids.map((x) => x.toString(16)).join(',');
  check('Glock 17 takes every 9mm magazine', hex(J.exemplar(0x01).compatibleAmmoIds) === '47,48,49,4a,4b,4c', hex(J.exemplar(0x01).compatibleAmmoIds));
  check('M24 takes 5- and 20-round 7.62 NATO', hex(J.exemplar(0x13).compatibleAmmoIds) === '64,65,66,67', hex(J.exemplar(0x13).compatibleAmmoIds));
  check('M24 default magazine is the 5-round one', J.exemplar(0x13).defaultAmmoId === 0x64);
  check('Ruger Mini-14 takes 5.56mm', hex(J.exemplar(0x16).compatibleAmmoIds) === '5e,5f', hex(J.exemplar(0x16).compatibleAmmoIds));
  check('.38 and .357 are different calibres', hex(J.exemplar(0x05).compatibleAmmoIds) === '4d,4e,4f');
  check('Grenade Launcher has no magazine', J.exemplar(0x28).compatibleAmmoIds.length === 0 && J.exemplar(0x28).defaultAmmoId === 0);
  check('two-handed: rifles, Thompson, LAW; not pistols, MP5K, P90',
    J.exemplar(0x16).twoHanded && J.exemplar(0x0B).twoHanded && J.exemplar(0x33).twoHanded &&
    !J.exemplar(0x01).twoHanded && !J.exemplar(0x09).twoHanded && !J.exemplar(0x0F).twoHanded);
  const handWeapons = J.ITEMS.filter((x) => x.handWeapon);
  check('hand weapons: guns + melee, no creature attacks or tank cannon',
    handWeapons.length === 51 && !J.exemplar(0x3C).handWeapon && !J.exemplar(0x2B).handWeapon &&
    J.exemplar(0x36).handWeapon && handWeapons.every((x) => x.category === J.CAT.WEAPON || x.category === J.CAT.MELEE_WEAPON),
    handWeapons.length);
  const noCalibre = J.ITEMS.filter((x) => x.category === J.CAT.WEAPON && x.ammoIds.some((id) => J.exemplar(id) && J.exemplar(id).category === J.CAT.AMMO) && x.compatibleAmmoIds.length === 0);
  check('every gun with magazines has a calibre', noCalibre.length === 0, noCalibre.map((x) => x.name).join(', '));
})();

// ---- save files ----------------------------------------------------------------------

const args = process.argv.slice(2);
let refDir = null;
const refIdx = args.indexOf('--ref');
if (refIdx !== -1) { refDir = args[refIdx + 1]; args.splice(refIdx, 2); }
const savesDir = path.resolve(args[0] || path.join(WEB, '..', 'saves'));

const files = fs.existsSync(savesDir) ? fs.readdirSync(savesDir).filter((f) => /\.sav$/i.test(f)).sort() : [];
if (files.length === 0) { console.log('SKIP no .sav files in ' + savesDir); }

for (const f of files) {
  const orig = new Uint8Array(fs.readFileSync(path.join(savesDir, f)));
  const tag = (f.match(/(\d+)\.sav$/i) || [])[1];

  let game;
  try {
    game = J.SaveGame.load(orig, f);
    check(f + ': loads (version ' + game.version + ', ' + game.mercs.length + ' soldiers)', true);
  } catch (e) {
    check(f + ': loads', false, e.message);
    continue;
  }

  const team = game.mercs.filter((m) => m.isOnPlayerTeam()).map((m) => m.get('Nickname'));
  console.log('     player team: ' + team.join(', '));

  check(f + ': unchanged save is byte-identical', firstDiff(game.save(), orig) === -1);

  if (refDir && tag && fs.existsSync(path.join(refDir, 'java_dump_' + tag + '.txt'))) {
    const javaDump = withoutChanged(fs.readFileSync(path.join(refDir, 'java_dump_' + tag + '.txt'), 'utf8').replace(/\r\n/g, '\n'));
    const jsDump = withoutChanged(dump(game));
    check(f + ': all fields match Java (' + javaDump.split('\n').length + ' lines)', jsDump === javaDump, firstLineDiff(jsDump, javaDump));
  }

  const edited = J.SaveGame.load(new Uint8Array(orig), f);
  if (edited.version <= 99) {
    applyEdits(edited);
    const out = edited.save();
    let reloaded = null;
    try { reloaded = J.SaveGame.load(out, f); } catch (e) { /* reported below */ }
    check(f + ': edited save reloads with valid checksums', reloaded !== null);
    if (reloaded) {
      const qt = reloaded.getMercByNick('Qt');
      check(f + ': edits persisted', qt.getInt('Strength') === 99 && qt.items[0].get('Item ID') === 'Kevlar Helmet' &&
        actorByNick(reloaded, 'Fox').getInt('Battles') === 65535);
    }
    if (refDir && tag && fs.existsSync(path.join(refDir, 'java_edit_' + tag + '.sav'))) {
      const javaOut = new Uint8Array(fs.readFileSync(path.join(refDir, 'java_edit_' + tag + '.sav')));
      const at = firstDiff(out, javaOut);
      check(f + ': edited save byte-identical to Java', at === -1, 'first difference at byte ' + at);
      if (reloaded) {
        const javaDump = withoutChanged(fs.readFileSync(path.join(refDir, 'java_edit_dump_' + tag + '.txt'), 'utf8').replace(/\r\n/g, '\n'));
        const jsEdited = withoutChanged(dump(reloaded));
        check(f + ': edited fields match Java', jsEdited === javaDump, firstLineDiff(jsEdited, javaDump));
      }
    }
    testFullDress(f, new Uint8Array(orig));
    testSupplyKits(f, new Uint8Array(orig), 0xCA, J.Mercenary.BACKPACK_4_3, 18);
    testSupplyKits(f, new Uint8Array(orig), 0xCD, J.Mercenary.BACKPACK_4_2, 1);
    testQuickItems(f, new Uint8Array(orig));
    testRepairReload(f, new Uint8Array(orig));
  } else if (edited.version === J.SaveGame113.VERSION) {
    test113(f, edited);
  }
}

/** JA2 1.0x: Full Dress on the first team member, save, reload. */
function testFullDress(f, bytes) {
  const game = J.SaveGame.load(bytes, f);
  const merc = game.mercs.find((m) => m.isOnPlayerTeam() && m.items);
  const otherItems = merc.items.slice(5).map((it) => Array.from(it.data).join());
  merc.fullDress();
  let back = null;
  try { back = J.SaveGame.load(game.save(), f); } catch (e) { check(f + ': Full Dress save reloads', false, e.message); return; }
  const items = back.mercs.find((m) => m.slot === merc.slot).items;
  const got = J.FULL_DRESS.map((p) => {
    const it = items[p.slot];
    return [it.get('Item ID'), it.getInt('Quantity'), it.getInt('Item 1 %'), it.getInt('Weight'),
      [1, 2, 3, 4].map((k) => it.getInt('Attachment ' + k + ' ID') + ':' + it.getInt('Attachment ' + k + ' %')).join(' ')].join('|');
  });
  const none = '0:0 0:0 0:0 0:0';
  const plates = '183:100 183:100 183:100 183:100';
  check(f + ': Full Dress reloads with valid checksums and the right items', JSON.stringify(got) === JSON.stringify([
    'Coated Spectra Helmet|1|100|13|' + none,
    'Coated Spectra Vest|1|100|77|' + plates,
    'Coated Spectra Leggings|1|100|35|' + none,
    'Night Vision Goggles|1|100|9|' + none,
    'Extended Ear|1|100|9|' + none]), got);
  check(f + ': single Full Dress leaves hands and pockets unchanged',
    items.slice(5).every((it, i) => Array.from(it.data).join() === otherItems[i]));
}

/** JA2 1.0x: team kits, without duplicates or overwritten items. */
function testSupplyKits(f, bytes, id, slot, weight) {
  const game = J.SaveGame.load(bytes, f);
  const team = game.mercs.filter((m) => m.isOnPlayerTeam() && m.items);
  const name = J.exemplar(id).name;
  team.forEach((m) => {
    m.items.forEach((it) => { if (it.getInt('Item ID') === id) it.data.fill(0); });
    m.items[slot].data.fill(0);
    m.fullDress();
  });
  const before = team.map((m) => m.items.map((it) => Array.from(it.data).join()));
  const supplied = team.map((m) => m.supplyKit(id));
  let back;
  try { back = J.SaveGame.load(game.save(), f); } catch (e) { check(f + ': ' + name + ' save reloads', false, e.message); return; }
  check(f + ': ' + name + ' for every team member survives save + reload', supplied.every(Boolean) && team.every((m) => {
    const it = back.mercs.find((b) => b.slot === m.slot).items[slot];
    return it.getInt('Item ID') === id && it.getInt('Quantity') === 1 &&
      it.getInt('Item 1 %') === 100 && it.getInt('Weight') === weight;
  }));
  check(f + ': supplying ' + name + ' preserves all other items',
    team.every((m, t) => m.items.every((it, i) => i === slot || Array.from(it.data).join() === before[t][i])));

  const merc = team[0];
  const kit = merc.items[slot];
  kit.setInt('Quantity', 2);
  kit.setInt('Item 1 %', 37);
  kit.setInt('Item 2 %', 52);
  const expected = merc.items.map((it) => new Uint8Array(it.data));
  expected[slot][4] = expected[slot][5] = 100;
  const refilled = merc.supplyKit(id) && merc.supplyKit(id);
  check(f + ': existing ' + name + ' refilled without duplicates or other changes', refilled &&
    merc.items.every((it, i) => firstDiff(it.data, expected[i]) === -1));

  merc.items.forEach((it) => it.data.fill(0));
  J.QUICK_ITEMS.aug.make(merc.items[J.Mercenary.RIGHT_HAND]);
  for (let s = J.Mercenary.BACKPACK_1_3; s <= slot; ++s) J.makeLawStack(merc.items[s], 1);
  const blocked = merc.items.map((it) => new Uint8Array(it.data));
  check(f + ': no free pocket: ' + name + ' respects pocket size, restricted slots and a blocked hand',
    merc.supplyKit(id) === false && merc.items.every((it, i) => firstDiff(it.data, blocked[i]) === -1));
  J.makeLoadedGun(merc.items[J.Mercenary.RIGHT_HAND], { id: 1, ammo: 0x47, ammoType: 0, rounds: 15, attachments: [] });
  check(f + ': ' + name + ' uses an unblocked left hand when suitable pockets are full',
    merc.supplyKit(id) && merc.items[J.Mercenary.LEFT_HAND].getInt('Item ID') === id);
}

/** JA2 1.0x: Repair all and Reload all on the whole team, save, reload. */
function testRepairReload(f, bytes) {
  const game = J.SaveGame.load(bytes, f);
  const team = game.mercs.filter((m) => m.isOnPlayerTeam() && m.items);
  const merc = team[0];
  const worn = merc.items.findIndex((it) => it.getInt('Item ID') &&
    [J.CAT.AMMO, J.CAT.WEAPON, J.CAT.MONEY].indexOf(J.exemplar(it.getInt('Item ID')).category) === -1);
  merc.items[worn].setInt('Item 1 %', 37);
  const raised = team.reduce((n, m) => n + m.repairAll(), 0);
  const firstGun = merc.items.findIndex((it) => { const ex = J.exemplar(it.getInt('Item ID'));
    return ex && ex.category === J.CAT.WEAPON && ex.defaultAmmoId && it.data[2] === 1; });
  // first gun: a magazine of another calibre and a jammed gun (negative ammo status)
  if (firstGun !== -1) { merc.items[firstGun].setInt('Ammo ID', 0x71); merc.items[firstGun].data[10] = 0xFB; }
  const isGun = (it) => { const ex = J.exemplar(it.getInt('Item ID'));
    return ex && ex.category === J.CAT.WEAPON && ex.defaultAmmoId && it.data[2] === 1; };
  const ammoBefore = team.map((m) => m.items.map((it) => it.getInt('Ammo ID')));
  const reloaded = team.reduce((n, m) => n + m.reloadAll(), 0);
  let back = null;
  try { back = J.SaveGame.load(game.save(), f); } catch (e) { check(f + ': repair/reload save reloads', false, e.message); return; }
  const items = back.mercs.find((m) => m.slot === merc.slot).items;
  check(f + ': Repair all raised statuses (' + raised + ')', raised >= 1 && items[worn].getInt('Item 1 %') === 100);
  let ok = true;
  let guns = 0;
  const notes = [];
  let kept = 0;
  back.mercs.filter((m) => m.isOnPlayerTeam() && m.items).forEach((m, t) => m.items.forEach((it, i) => {
    if (!isGun(it)) { return; }
    ++guns;
    const ex = J.exemplar(it.getInt('Item ID'));
    const fits = ex.compatibleAmmoIds.indexOf(it.getInt('Ammo ID')) !== -1;
    const was = ammoBefore[t][i];
    const sameMag = ex.compatibleAmmoIds.indexOf(was) !== -1 ? it.getInt('Ammo ID') === was : it.getInt('Ammo ID') === ex.defaultAmmoId;
    if (sameMag && it.getInt('Ammo ID') === was) { ++kept; }
    if (!(fits && sameMag && it.data[6] === 255 && it.data[5] === 8 && it.data[10] === 100 &&
      it.getInt('Weight') === J.objectWeight(it))) { ok = false; }
    notes.push(m.get('Nickname') + ' ' + ex.name + ' ' + it.get('Ammo ID') + ' ' + it.data[6] + ' type ' + it.data[5]);
  }));
  if (firstGun !== -1) {
    const ex = J.exemplar(items[firstGun].getInt('Item ID'));
    check(f + ': Reload all: wrong calibre -> default magazine, jam cleared',
      items[firstGun].getInt('Ammo ID') === ex.defaultAmmoId && items[firstGun].data[10] === 100);
  }
  check(f + ': Reload all: every gun 255 rounds, 100%, type 8, magazine kept (' + guns + ' guns, ' + kept + ' kept, ' +
    reloaded + ' changed)', ok && guns > 0 && kept >= 1 && reloaded === guns, notes);
}

/** JA2 1.0x: LAW x6, Auto Rocket Rifle and Steyr AUG from the quick buttons, save, reload. */
function testQuickItems(f, bytes) {
  const game = J.SaveGame.load(bytes, f);
  const merc = game.mercs.find((m) => m.isOnPlayerTeam() && m.items);
  const free = merc.items.map((it, i) => (it.getInt('Item ID') === 0 && i > 6 ? i : -1)).filter((i) => i !== -1);
  if (free.length < 4) { check(f + ': four free pockets for the quick items', false); return; }
  J.QUICK_ITEMS.law.make(merc.items[free[0]]);
  J.QUICK_ITEMS.rifle.make(merc.items[free[1]]);
  J.QUICK_ITEMS.aug.make(merc.items[free[2]]);
  J.QUICK_ITEMS.dragunov.make(merc.items[free[3]]);
  let back = null;
  try { back = J.SaveGame.load(game.save(), f); } catch (e) { check(f + ': quick items save reloads', false, e.message); return; }
  const items = back.mercs.find((m) => m.slot === merc.slot).items;
  const hex = (it) => Array.from(it.data.slice(0, 0x22), (b) => b.toString(16).padStart(2, '0')).join('');
  // usItem 0x33, 6 objects, bStatus[0..5] = 100, bGunAmmoStatus 100, ubImprintID 200, ubWeight 21
  check(f + ': LAW x6 bytes', hex(items[free[0]]) === '33000600646464646464640000000000' + '0000000000000000' + '00000000' + '000000c8' + '1500', hex(items[free[0]]));
  // usItem 0x41, status 100, HEAT (10), 255 rounds, minirockets HEAP 0x71, ammo 100%,
  // Laser Scope 0xF1 and Sniper Scope 0xD0 at 100%, imprint 200, weight 40 + 10 + 4 + 9 = 63
  check(f + ': Auto Rocket Rifle bytes', hex(items[free[1]]) === '41000100640aff007100640000000000' +
    'f100d00000000000' + '64640000' + '000000c8' + '3f00', hex(items[free[1]]));
  // usItem 0x14 (Steyr AUG), status 100, HP (1), 255 rounds, 5.56mm HP 0x5F, ammo 100%,
  // Laser Scope and Sniper Scope at 100%, imprint 200, weight 36 + 5 + 4 + 9 = 54
  check(f + ': Steyr AUG bytes', hex(items[free[2]]) === '140001006401ff005f00640000000000' +
    'f100d00000000000' + '64640000' + '000000c8' + '3600', hex(items[free[2]]));
  // usItem 0x12 (Dragunov), status 100, AP (2), 255 rounds, 7.62mm WP 10 0x60 (default), ammo 100%,
  // Laser Scope and Sniper Scope at 100%, imprint 200, weight 43 + 3 + 4 + 9 = 59
  check(f + ': Dragunov bytes', hex(items[free[3]]) === '120001006402ff006000640000000000' +
    'f100d00000000000' + '64640000' + '000000c8' + '3b00', hex(items[free[3]]));
  check(f + ': quick items readable', items[free[0]].get('Item ID') === 'LAW' && items[free[0]].getInt('Quantity') === 6 &&
    items[free[1]].get('Ammo ID') === 'Minirockets, HEAP' && items[free[1]].getInt('Ammo Quantity') === 255 &&
    items[free[2]].get('Item ID') === 'Steyr AUG' && items[free[2]].get('Ammo ID') === '5.56mm Magazine, HP' &&
    items[free[2]].get('Attachment 2 ID') === 'Sniper Scope' && items[free[2]].getInt('Attachment 3 ID') === 0);
}

/** JA2 1.13 v5: edit a team member (soldier + profile) and a profile, save, reload. */
function test113(f, game) {
  check(f + ': 255 profiles, all checksums valid', game.actors.length === 255);
  const team = game.mercs.filter((m) => m.isOnPlayerTeam());
  check(f + ': team members are linked to their profiles by number',
    team.length > 0 && team.every((m) => game.actorMercs[m.getInt('ubProfile')] === m));
  const merc = team[0];
  const index = merc.getInt('ubProfile');
  const both = new J.Chain([merc, game.actors[index]]);
  const traitId = game.traits.valueOf('Doctor') !== undefined ? game.traits.valueOf('Doctor') : 3;
  both.set('Strength', '95');
  both.set('Max Health', '99');
  both.set('Health', '99');
  both.set('Marksmanship', '127');
  both.set('Level', '7');
  both.setInt('Skill3', traitId);
  both.set('Energy', '88');
  both.set('Morale', '77');
  both.set('Kills', '1234');
  both.set('Agility Inc', '3');
  both.set('Nickname', 'Tester');
  const other = game.actors.findIndex((a, i) => !game.actorMercs[i] && a.get('Nickname') === 'Fox');
  if (other !== -1) { game.actors[other].set('Wisdom', '81'); }

  const out = game.save();
  check(f + ': edited save keeps its size', out.length === game.bytes.length);
  let back = null;
  try { back = J.SaveGame.load(out, f); } catch (e) { check(f + ': edited save reloads', false, e.message); return; }
  check(f + ': edited save reloads with valid checksums', true);
  const m2 = back.actorMercs[index];
  const p2 = back.actors[index];
  check(f + ': soldier edits persisted', m2 && m2.getInt('Strength') === 95 && m2.getInt('Marksmanship') === 127 &&
    m2.getInt('Level') === 7 && m2.getInt('Skill3') === traitId && m2.getInt('Energy') === 88 &&
    m2.getInt('Morale') === 77 && m2.get('Nickname') === 'Tester');
  check(f + ': profile edits persisted', p2.getInt('Strength') === 95 && p2.getInt('Kills') === 1234 &&
    p2.getInt('Agility Inc') === 3 && p2.get('Nickname') === 'Tester' && p2.getInt('Health') === 99);
  if (other !== -1) { check(f + ': unhired profile edit persisted', back.actors[other].getInt('Wisdom') === 81); }
  const changed = [];
  for (let i = 0; i < out.length; ++i) { if (out[i] !== game.bytes[i]) { changed.push(i); } }
  const inside = (o, rec) => o >= rec.offset && o < rec.offset + (rec.length || rec.data.length);
  const touched = [merc, game.actors[index]].concat(other !== -1 ? [game.actors[other]] : []);
  check(f + ': only the edited records changed (' + changed.length + ' bytes)',
    changed.length > 0 && changed.every((o) => touched.some((rec) => inside(o, rec))));

  testSwap113(f, J.SaveGame.load(new Uint8Array(game.bytes), f));
}

/** JA2 1.13 v5: replace items (gun, armour with an attachment), reload, compare. */
function testSwap113(f, game) {
  const db = J.Items113.db();
  check(f + ': v5 item data loaded', db && db.list.length > 1700);
  const merc = game.mercs.find((m) => m.isOnPlayerTeam() && new J.Items113.Inventory(m, game, db).slot(5));
  if (!merc) { check(f + ': a team member holds something in the hand', false); return; }
  const inv = new J.Items113.Inventory(merc, game, db);
  const hand = inv.slot(5);
  const gun = db.group('gun').find((i) => !i.twoHanded && i.defaults.length > 0 && i.id !== hand.id &&
    db.weapon(i.id).calibre !== (db.weapon(hand.id) || {}).calibre);
  const twoHanded = db.group('gun').find((i) => i.twoHanded);
  if (inv.slot(6)) {
    check(f + ': two-handed gun refused while the second hand is busy', /second hand/.test(inv.check(5, twoHanded.id) || ''));
  }
  const s1 = inv.replace(5, gun.id);
  const mag = db.magazineOf(db.defaultMagazine(gun.id));
  check(f + ': gun replaced with factory attachments and default magazine',
    inv.slot(5).id === gun.id && JSON.stringify(inv.slot(5).attachments) === JSON.stringify(gun.defaults.map((d) => db.name(d))) &&
    inv.slot(5).ammo.item === mag.itemId && inv.slot(5).ammo.shots === mag.magSize && /^loaded /.test(s1.ammo));
  const sameCalibre = db.group('gun').find((i) => i.id !== gun.id && !i.twoHanded &&
    db.weapon(i.id).calibre === db.weapon(gun.id).calibre);
  if (sameCalibre) {
    inv.replace(5, sameCalibre.id);
    check(f + ': same calibre keeps the loaded magazine', inv.slot(5).ammo.item === mag.itemId &&
      inv.slot(5).ammo.shots === Math.min(mag.magSize, db.weapon(sameCalibre.id).magSize));
  }
  const withAttachment = inv.slots().find((s) => s.attachments.length && s.item && db.groupOf(s.item));
  if (withAttachment) {
    const other = inv.options(withAttachment.index).items.find((i) => i.id !== withAttachment.id && !i.defaults.length);
    const s2 = inv.replace(withAttachment.index, other.id);
    check(f + ': attachments removed on replace', s2.removed.length > 0 && inv.slot(withAttachment.index).attachments.length === 0);
  }
  const before = inv.slots().map((s) => s.index + ':' + s.id + ':' + s.attachments.join('+'));

  const out = game.save();
  let back = null;
  try { back = J.SaveGame.load(out, f); } catch (e) { check(f + ': save with replaced items reloads', false, e.message); return; }
  check(f + ': save with replaced items reloads with valid checksums', true);
  const merc2 = back.mercs.find((m) => m.slot === merc.slot);
  const after = new J.Items113.Inventory(merc2, back, db).slots().map((s) => s.index + ':' + s.id + ':' + s.attachments.join('+'));
  check(f + ': replaced items survive the reload', JSON.stringify(after) === JSON.stringify(before), after);
  const others = game.mercs.filter((m) => m !== merc);
  check(f + ': other soldiers unchanged', others.every((m) => {
    const a = m.encode();
    const b = back.mercs.find((x) => x.slot === m.slot).encode();
    return a.length === b.length && a.every((v, k) => v === b[k]);
  }));
  const tail = 4096;
  check(f + ': rest of the file unchanged', out.subarray(out.length - tail).every((v, k) => v === game.bytes[game.bytes.length - tail + k]));
}

console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
