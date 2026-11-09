/*
  JAPE - Jagged Alliance 2 Person Editor, JavaScript port.

  This software may be used and distributed according to the terms
  of the GNU Public License, incorporated herein by reference.

  JA2 1.13 release "v5" saves (save game version 185,
  MERC_PROFILE_INSERTION_DATA, https://github.com/1dot13/source tag v5).

  Layouts come from the v5 sources: Ja2/SaveLoadGame.cpp (MERCPROFILESTRUCT::Save,
  SOLDIERTYPE::Save, Inventory/OBJECTTYPE/StackedObjectData/LBENODE::Save,
  SaveSoldierStructure) and offsets/sizes measured by compiling the v5 headers
  with MSVC for Win32, the platform of the release build.

  Only fixed-size values inside existing records are edited; record sizes never
  change, so the rest of the file is written back untouched.
*/
(function (J) {
  'use strict';

  var VERSION = 185;
  var HEADER_SIZE = 1324;             // sizeof(SAVED_GAME_HEADER)
  var NUM_PROFILES = 255;
  var TOTAL_SOLDIERS = 254;
  var NUM_INV_SLOTS = 55;
  var NO_PROFILE = 200;
  var OUR_TEAM = 0;
  var SOLDIER_VEHICLE = 0x00008000;

  // GAME_OPTIONS inside SAVED_GAME_HEADER
  var HEADER_GAME_OPTIONS = 303;
  var GO_NEW_TRAIT_SYSTEM = 12;

  // MERCPROFILESTRUCT: POD, then inventory (int count + count * 3 ints), then
  // STRUCT_Records (104), usBackground (2), ubSnitchExposedCooldown (1),
  // usDynamicOpinionFlagmask (6120), sDynamicOpinionLongTerm (255),
  // usVoiceIndex (4), Type (4), 11 growth modifiers (1 each).
  var PROFILE_POD = 844;
  var PROFILE_RECORDS_SIZE = 104;
  var PROFILE_TAIL = PROFILE_RECORDS_SIZE + 2 + 1 + 6120 + 255 + 4 + 4 + 11;
  var PROFILE_CHECKSUM = 820;

  // SOLDIERTYPE: POD, inventory, then fixed structs.
  var SOLDIER_POD = 1488;
  var SOLDIER_CHECKSUM = 1112;
  var SOLDIER_PROFILE = 813;
  var SOLDIER_TEAM = 31;
  var AIDATA_SIZE = 624;
  var AIDATA_MORALE = 328;
  var FLAGS_SIZE = 88;
  var FLAGS_STATUS = 80;
  var TIMECHANGES_SIZE = 44;
  var TIMECOUNTERS_SIZE = 40;
  var DRUGS_SIZE = 92;
  var STATS_SIZE = 43;
  var PATHING_SIZE = 92;
  var PATHST_SIZE = 20;
  var KEYRING_SIZE = 255 * 2;          // NUM_KEYS * sizeof(KEY_ON_RING)

  // OBJECTTYPE and friends
  var OBJECT_POD = 5;                   // usItem (2), ubNumberOfObjects (1), ...
  var OBJECTDATA_SIZE = 48;
  var OBJECTDATA_BLBE = 2;
  var OBJECTDATA_UNIQUEID = 4;
  var LBENODE_POD = 16;
  var LBENODE_UNIQUEID = 8;
  var MAX_STACK = 512;

  var OLD_TRAITS = ['None', 'Lockpicking', 'Hand to Hand', 'Electronics', 'Night Ops', 'Throwing',
    'Teaching', 'Heavy Weapons', 'Auto Weapons', 'Stealthy', 'Ambidextrous', 'Thief', 'Martial Arts',
    'Knifing', 'Sniper', 'Camouflaged', 'Expert'];
  var NEW_TRAITS = ['None', 'Auto Weapons', 'Heavy Weapons', 'Sniper', 'Ranger', 'Gunslinger',
    'Martial Arts', 'Squadleader', 'Technician', 'Doctor', 'Ambidextrous', 'Melee', 'Throwing',
    'Night Ops', 'Stealthy', 'Athletics', 'Bodybuilding', 'Demolitions', 'Teaching', 'Scouting',
    'Covert Ops', 'Radio Operator', 'Snitch', 'Survival'];

  function traitTable(names) {
    return new J.NameTable(names.map(function (n, i) { return [i, n]; }));
  }
  J.TRAITS_113_OLD = traitTable(OLD_TRAITS);
  J.TRAITS_113_NEW = traitTable(NEW_TRAITS);

  // ---- little-endian helpers -------------------------------------------------------

  function Reader(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  Reader.prototype.need = function (n) {
    if (this.pos + n > this.bytes.length) { throw new J.EOFError(); }
  };
  Reader.prototype.u8 = function () {
    this.need(1);
    return this.bytes[this.pos++];
  };
  Reader.prototype.i32 = function () {
    this.need(4);
    var v = i32(this.bytes, this.pos);
    this.pos += 4;
    return v;
  };
  Reader.prototype.skip = function (n) {
    this.need(n);
    this.pos += n;
  };

  function i32(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); }
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function s8(b, o) { return (b[o] << 24) >> 24; }

  function count(r, max, what) {
    var n = r.i32();
    if (n < 0 || n > max) { throw new J.FormatError('Invalid ' + what + ' ' + n + ' at offset ' + (r.pos - 4)); }
    return n;
  }

  /** JA2 stat checksum: Java/C 32-bit unsigned arithmetic on signed INT8 stats. */
  function statChecksum(s) {
    var c = 1;
    c = (c + s.getInt('Health') + 1) | 0;
    c = Math.imul(c, s.getInt('Max Health') + 1);
    c = (c + s.getInt('Agility') + 1) | 0;
    c = Math.imul(c, s.getInt('Dexterity') + 1);
    c = (c + s.getInt('Strength') + 1) | 0;
    c = Math.imul(c, s.getInt('Marksmanship') + 1);
    c = (c + s.getInt('Medical') + 1) | 0;
    c = Math.imul(c, s.getInt('Mechanical') + 1);
    c = (c + s.getInt('Explosives') + 1) | 0;
    c = Math.imul(c, s.getInt('Level') + 1);
    return c;
  }

  function hex(n) { return (n >>> 0).toString(16); }

  var S8 = function (o) { return new J.SByteField(o); };
  var U16 = function (o) { return new J.ShortField(o); };

  // ===========================================================================
  // Profile (MERCPROFILESTRUCT)
  // ===========================================================================

  function Profile113(record, offset, traits) {
    this.version = VERSION;
    this.offset = offset;
    this.data = new Uint8Array(record);
    this.inventoryCount = i32(this.data, PROFILE_POD);
    var rec = PROFILE_POD + 4 + this.inventoryCount * 12;
    this.fields = {
      'Name': new J.StringField(0, 60),
      'Nickname': new J.StringField(60, 20),
      'Medical': S8(261),
      'Strength': S8(296),
      'Max Health': S8(297),
      'Level Inc': S8(298),
      'Health Inc': S8(299),
      'Agility Inc': S8(300),
      'Dexterity Inc': S8(301),
      'Wisdom Inc': S8(302),
      'Marksmanship Inc': S8(303),
      'Medical Inc': S8(304),
      'Mechanical Inc': S8(305),
      'Explosives Inc': S8(306),
      'Strength Inc': S8(307),
      'Leadership Inc': S8(308),
      'Health': S8(322),
      'Dexterity': S8(323),
      'Skill1': new J.ChoiceField(new J.ByteField(325), traits),
      'Skill2': new J.ChoiceField(new J.ByteField(326), traits),
      'Skill3': new J.ChoiceField(new J.ByteField(327), traits),
      'Explosives': S8(356),
      'Leadership': S8(357),
      'Level': S8(368),
      'Marksmanship': S8(369),
      'Wisdom': S8(371),
      'Agility': S8(383),
      'Mechanical': S8(389),
      'Checksum': new J.IntField(PROFILE_CHECKSUM),
      // STRUCT_Records; the six classic counters map to the fields 1.13
      // itself converts the old values into (usKillsRegulars etc.).
      'Kills': U16(rec + 2),
      'Assists': U16(rec + 16),
      'Shots Fired': U16(rec + 22),
      'Shots Hit': U16(rec + 34),
      'Battles': U16(rec + 36),
      'Wounds': U16(rec + 46)
    };
  }
  Profile113.prototype = Object.create(J.Structure.prototype);

  Profile113.prototype.computeChecksum = function () {
    var c = statChecksum(this);
    for (var i = 0; i < this.inventoryCount; ++i) {
      var o = PROFILE_POD + 4 + i * 12;
      c = (c + i32(this.data, o)) | 0;          // item
      c = (c + i32(this.data, o + 8)) | 0;      // number
    }
    return c;
  };
  Profile113.prototype.validateChecksum = function () {
    var c = this.computeChecksum();
    var saved = this.getInt('Checksum');
    if (c !== saved) {
      throw new J.FormatError('Invalid checksum (0x' + hex(c) + ' vs 0x' + hex(saved) +
        ") in MERCPROFILESTRUCT for '" + this.get('Name') + "'");
    }
  };
  Profile113.prototype.encode = function () {
    this.setInt('Checksum', this.computeChecksum());
    return this.data;
  };

  /** MERCPROFILESTRUCT::GetChecksum straight from the bytes (used while searching). */
  function rawProfileChecksum(b, o, n) {
    var c = 1;
    c = (c + s8(b, o + 322) + 1) | 0;          // bLife
    c = Math.imul(c, s8(b, o + 297) + 1);      // bLifeMax
    c = (c + s8(b, o + 383) + 1) | 0;          // bAgility
    c = Math.imul(c, s8(b, o + 323) + 1);      // bDexterity
    c = (c + s8(b, o + 296) + 1) | 0;          // bStrength
    c = Math.imul(c, s8(b, o + 369) + 1);      // bMarksmanship
    c = (c + s8(b, o + 261) + 1) | 0;          // bMedical
    c = Math.imul(c, s8(b, o + 389) + 1);      // bMechanical
    c = (c + s8(b, o + 356) + 1) | 0;          // bExplosive
    c = Math.imul(c, s8(b, o + 368) + 1);      // bExpLevel
    for (var i = 0; i < n; ++i) {
      var at = o + PROFILE_POD + 4 + i * 12;
      c = (c + i32(b, at) + i32(b, at + 8)) | 0;
    }
    return c;
  }

  /** Length of the profile record at `offset`, or 0 if it is not a valid profile. */
  function profileLength(bytes, offset) {
    if (offset + PROFILE_POD + 4 > bytes.length) { return 0; }
    var n = i32(bytes, offset + PROFILE_POD);
    if (n < 0 || n > NUM_INV_SLOTS) { return 0; }
    var length = PROFILE_POD + 4 + n * 12 + PROFILE_TAIL;
    if (offset + length > bytes.length) { return 0; }
    return rawProfileChecksum(bytes, offset, n) === i32(bytes, offset + PROFILE_CHECKSUM) ? length : 0;
  }

  // ===========================================================================
  // Soldier (SOLDIERTYPE)
  // ===========================================================================

  /**
   * @param record bytes of the soldier record, from the POD to the key ring
   * @param layout offsets of the variable-position structs inside the record
   */
  function Soldier113(record, offset, slot, layout, traits) {
    this.version = VERSION;
    this.offset = offset;
    this.slot = slot;
    this.items = null;
    this.data = new Uint8Array(record);
    this.inventorySum = layout.inventorySum;
    var st = layout.stats;
    this.fields = {
      'Nickname': new J.StringField(2, 20),
      'Energy': S8(45),
      'Max Energy': S8(46),
      'Morale': S8(layout.aiData + AIDATA_MORALE),
      'Level': S8(st + 0),
      'Health': S8(st + 1),
      'Max Health': S8(st + 2),
      'Strength': S8(st + 3),
      'Agility': S8(st + 4),
      'Dexterity': S8(st + 5),
      'Wisdom': S8(st + 6),
      'Leadership': S8(st + 7),
      'Marksmanship': S8(st + 8),
      'Mechanical': S8(st + 9),
      'Explosives': S8(st + 10),
      'Medical': S8(st + 11),
      'Skill1': new J.ChoiceField(new J.ByteField(st + 13), traits),
      'Skill2': new J.ChoiceField(new J.ByteField(st + 14), traits),
      'Skill3': new J.ChoiceField(new J.ByteField(st + 15), traits),
      'ubProfile': new J.ByteField(SOLDIER_PROFILE),
      'Checksum': new J.IntField(SOLDIER_CHECKSUM)
    };
    this.team = s8(this.data, SOLDIER_TEAM);
    this.statusFlags = i32(this.data, layout.flags + FLAGS_STATUS);
  }
  Soldier113.prototype = Object.create(J.Structure.prototype);

  /** Player's mercs: OUR_TEAM, not a vehicle. */
  Soldier113.prototype.isOnPlayerTeam = function () {
    return this.team === OUR_TEAM && !(this.statusFlags & SOLDIER_VEHICLE);
  };
  Soldier113.prototype.computeChecksum = function () {
    var c = statChecksum(this);
    c = (c + this.getInt('ubProfile') + 1) | 0;
    return (c + this.inventorySum) | 0;
  };
  Soldier113.prototype.validateChecksum = function () {
    var c = this.computeChecksum();
    var saved = this.getInt('Checksum');
    if (c !== saved) {
      throw new J.FormatError('Invalid checksum (0x' + hex(c) + ' vs 0x' + hex(saved) +
        ") in SOLDIERTYPE for '" + this.get('Nickname') + "'");
    }
  };
  Soldier113.prototype.encode = function () {
    this.setInt('Checksum', this.computeChecksum());
    return this.data;
  };

  /** Skips one OBJECTTYPE (recursively); returns {usItem, ubNumberOfObjects}. */
  function readObject(r) {
    var b = r.bytes;
    r.need(OBJECT_POD);
    var usItem = u16(b, r.pos);
    var number = b[r.pos + 2];
    r.skip(OBJECT_POD);
    var stack = count(r, MAX_STACK - 1, 'object stack size');
    for (var x = 0; x < stack; ++x) {
      var objectData = r.pos;
      r.skip(OBJECTDATA_SIZE);
      var attachments = count(r, MAX_STACK - 1, 'attachment count');
      for (var a = 0; a < attachments; ++a) { readObject(r); }
      // An active LBE (load bearing equipment) item is followed by its
      // LBENODE. The game decides by item class (Items.xml); without it, the
      // node is recognised by carrying the same uniqueID as the item.
      if (usItem && number && s8(b, objectData + OBJECTDATA_BLBE) === -1 &&
          r.pos + LBENODE_POD <= b.length &&
          i32(b, r.pos + LBENODE_UNIQUEID) === i32(b, objectData + OBJECTDATA_UNIQUEID)) {
        r.skip(LBENODE_POD);
        var contents = count(r, MAX_STACK - 1, 'LBE content count');
        for (var k = 0; k < contents; ++k) { readObject(r); }
      }
    }
    return { usItem: usItem, number: number };
  }

  function readSoldier(r) {
    var start = r.pos;
    r.skip(SOLDIER_POD);
    var slots = count(r, NUM_INV_SLOTS, 'inventory size');
    var sum = 0;
    for (var i = 0; i < slots; ++i) {
      var obj = readObject(r);
      sum = (sum + obj.usItem + obj.number) | 0;
      r.skip(8);                          // bNewItemCount, bNewItemCycleCount
    }
    var layout = { inventorySum: sum, aiData: r.pos - start };
    r.skip(AIDATA_SIZE);
    layout.flags = r.pos - start;
    r.skip(FLAGS_SIZE + TIMECHANGES_SIZE + TIMECOUNTERS_SIZE + DRUGS_SIZE);
    layout.stats = r.pos - start;
    r.skip(STATS_SIZE + PATHING_SIZE);
    var nodes = count(r, 100000, 'path length');
    r.skip(nodes * PATHST_SIZE);
    var ring = r.u8();
    if (ring !== 0 && ring !== 1) { throw new J.FormatError('Invalid key ring flag ' + ring); }
    if (ring) { r.skip(KEYRING_SIZE); }
    layout.end = r.pos;
    return layout;
  }

  // ===========================================================================
  // Save game
  // ===========================================================================

  function SaveGame113(bytes, filename) {
    this.bytes = bytes;
    this.filename = filename;
    this.version = VERSION;
    this.formatLabel = 'JA2 1.13 v5';
    this.actors = [];
    this.mercs = [];
  }

  SaveGame113.VERSION = VERSION;

  SaveGame113.load = function (bytes, filename) {
    var game = new SaveGame113(bytes, filename);
    game.load();
    return game;
  };

  SaveGame113.prototype.load = function () {
    var bytes = this.bytes;
    if (bytes.length < HEADER_SIZE) { throw new J.EOFError(); }
    this.newTraitSystem = bytes[HEADER_GAME_OPTIONS + GO_NEW_TRAIT_SYSTEM] !== 0;
    this.traits = this.newTraitSystem ? J.TRAITS_113_NEW : J.TRAITS_113_OLD;

    var start = this.findProfiles();
    var r = new Reader(bytes);
    r.pos = start;
    for (var p = 0; p < NUM_PROFILES; ++p) {
      var length = profileLength(bytes, r.pos);
      var profile = new Profile113(bytes.subarray(r.pos, r.pos + length), r.pos, this.traits);
      profile.validateChecksum();
      this.actors.push(profile);
      r.skip(length);
    }
    this.profileEnd = r.pos;

    for (var slot = 0; slot < TOTAL_SOLDIERS; ++slot) {
      var active = r.u8();
      if (active === 0) { continue; }
      if (active !== 1) { throw new J.FormatError('ubActive = ' + active + ' for soldier ' + slot); }
      var at = r.pos;
      var layout = readSoldier(r);
      var soldier = new Soldier113(bytes.subarray(at, layout.end), at, slot, layout, this.traits);
      soldier.validateChecksum();
      this.mercs.push(soldier);
    }
    this.soldierEnd = r.pos;
    this.linkActorsToMercs();
  };

  /**
   * The profiles follow sections whose size depends on the campaign
   * (events, laptop data). The block is found as the first offset where all
   * 255 profiles follow each other with valid checksums.
   */
  SaveGame113.prototype.findProfiles = function () {
    var bytes = this.bytes;
    for (var at = HEADER_SIZE; at + PROFILE_POD < bytes.length; ++at) {
      if (!profileLength(bytes, at)) { continue; }
      var pos = at;
      var found = 0;
      while (found < NUM_PROFILES) {
        var length = profileLength(bytes, pos);
        if (!length) { break; }
        pos += length;
        ++found;
      }
      if (found === NUM_PROFILES) { return at; }
    }
    throw new J.FormatError('Character profiles not found in JA2 1.13 save');
  };

  /** Profile index -> soldier, matched by the soldier's profile number. */
  SaveGame113.prototype.linkActorsToMercs = function () {
    var byProfile = {};
    this.mercs.forEach(function (m) {
      var id = m.getInt('ubProfile');
      if (id !== NO_PROFILE && !Object.prototype.hasOwnProperty.call(byProfile, id)) { byProfile[id] = m; }
    });
    this.actorMercs = this.actors.map(function (a, i) {
      return Object.prototype.hasOwnProperty.call(byProfile, i) ? byProfile[i] : null;
    });
  };

  SaveGame113.prototype.save = function () {
    var out = new Uint8Array(this.bytes);
    this.actors.forEach(function (a) { out.set(a.encode(), a.offset); });
    this.mercs.forEach(function (m) { out.set(m.encode(), m.offset); });
    return out;
  };

  SaveGame113.prototype.commitSaved = function (bytes) {
    this.bytes = bytes;
  };

  J.SaveGame113 = SaveGame113;
})(this.JAPE = this.JAPE || {});
