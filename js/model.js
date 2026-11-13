/*
  JAPE - Jagged Alliance 2 Person Editor, JavaScript port.
  Original Java version written 1999-2008 by Douglas Greiman.

  This software may be used and distributed according to the terms
  of the GNU Public License, incorporated herein by reference.

  Port of Skill.java, ItemExemplar.java, Item.java, Actor.java and
  Mercenary.java: the game data structures and their field layouts.
*/
(function (J) {
  'use strict';

  var CAT = J.CAT;

  // ---- Skills ------------------------------------------------------------------

  J.SKILL_NAMES = [
    'None', 'Lockpicking', 'Hand to Hand', 'Electronics', 'Night Ops',
    'Throwing', 'Teaching', 'Heavy Weapons', 'Auto Weapons', 'Stealthy',
    'Ambidextrous', 'Thief', 'Martial Arts', 'Knifing', 'Roof Bonus',
    'Camouflaged'
  ];
  J.SkillTable = new J.NameTable(J.SKILL_NAMES.map(function (n, i) { return [i, n]; }));

  // ---- Item exemplars (item types) ---------------------------------------------

  /** One item type from the static item table (ItemExemplar). */
  function ItemExemplar(row) {
    this.id = row[0];
    this.name = row[1];
    this.category = row[2];
    this.ammoIds = [];
    this.ammoVariety = 0;
    this.ammoCapacity = 0;
    if (this.category === CAT.WEAPON) {
      this.ammoIds = row.slice(3, 7).filter(function (id) { return id !== 0; });
    } else if (this.category === CAT.AMMO) {
      this.ammoVariety = row[3];
      this.ammoCapacity = row[4];
    }
  }

  var ATTACHMENT_CATS = [CAT.WEAPON_ATTACHMENT, CAT.ARMOR_ATTACHMENT, CAT.GRENADE, CAT.DETONATOR];

  J.ITEMS = J.ITEM_ROWS.map(function (row) { return new ItemExemplar(row); });
  J.ITEM_BY_ID = {};
  J.ITEMS.forEach(function (ex) { J.ITEM_BY_ID[ex.id] = ex; });

  /**
   * Corrections to the original JAPE item table (items.js is a faithful
   * conversion of it). Ammo types (ubAmmoType, set as "Ammo Variety" when a
   * magazine is chosen) of the JA2 1.12 magazine data, as published by the
   * JA2 Stracciatella project; the other 40 magazines already match.
   * 0 regular, 3 super AP, 9 HE. The 0x70 minirockets are HE, not HP.
   */
  var AMMO_TYPE_FIXES = { 0x68: 3, 0x6B: 0, 0x6F: 3, 0x70: 9 };
  Object.keys(AMMO_TYPE_FIXES).forEach(function (id) {
    J.ITEM_BY_ID[id].ammoVariety = AMMO_TYPE_FIXES[id];
  });
  J.ITEM_BY_ID[0x70].name = 'Minirockets, HE';

  /**
   * Calibre of a magazine, read from its name ("7.62mm NATO Magazine, 20"
   * -> "7.62mm NATO"). The game accepts any magazine of the gun's calibre,
   * whatever its size, while the original table lists only the magazines
   * of the gun's own size (e.g. M24: 5-round magazines only).
   */
  var CALIBRE = /^(\.\d+|\d+(?:\.\d+)?mm(?: WP| NATO)?|12 Gauge|CAWS|Minirockets|Tranquilizer Dart)/;
  J.ITEMS.forEach(function (ex) {
    if (ex.category === CAT.AMMO) {
      var m = CALIBRE.exec(ex.name);
      ex.calibre = m ? m[1] : ex.name;
    }
  });
  J.ITEMS.forEach(function (ex) {
    if (ex.category !== CAT.WEAPON) { return; }
    var calibres = ex.ammoIds
      .map(function (id) { return J.ITEM_BY_ID[id]; })
      .filter(function (a) { return a && a.category === CAT.AMMO; })
      .map(function (a) { return a.calibre; });
    /** Magazine loaded into a new gun of this type. */
    ex.defaultAmmoId = 0;
    for (var i = 0; i < ex.ammoIds.length; ++i) {
      var a = J.ITEM_BY_ID[ex.ammoIds[i]];
      if (a && a.category === CAT.AMMO) { ex.defaultAmmoId = a.id; break; }
    }
    /** Every magazine of the gun's calibre(s). */
    ex.compatibleAmmoIds = J.ITEMS
      .filter(function (a) { return a.category === CAT.AMMO && calibres.indexOf(a.calibre) !== -1; })
      .map(function (a) { return a.id; });
  });

  /**
   * Two-handed weapons (bTwoHanded in the JA2 1.12 item data, as published
   * by the JA2 Stracciatella project in assets/externalized/weapons.json).
   * The original JAPE table has no such information.
   */
  var TWO_HANDED_IDS = [
    0x0B, 0x0C, 0x0D, 0x0E, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
    0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24,
    0x28, 0x29, 0x33, 0x37, 0x41
  ];
  /** Creature and vehicle attacks: "weapons" a merc cannot hold. */
  var NON_PLAYER_WEAPON_IDS = [0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x34, 0x35, 0x39, 0x3A, 0x3B, 0x3C];

  J.ITEMS.forEach(function (ex) {
    ex.twoHanded = TWO_HANDED_IDS.indexOf(ex.id) !== -1;
    /** Firearm or melee weapon a merc can hold in the hand. */
    ex.handWeapon = (ex.category === CAT.WEAPON || ex.category === CAT.MELEE_WEAPON) &&
      NON_PLAYER_WEAPON_IDS.indexOf(ex.id) === -1;
  });
  J.ItemNameTable = new J.NameTable(J.ITEMS.map(function (ex) { return [ex.id, ex.name]; }));

  /** Lists used by the original choice boxes (all start with None). */
  J.ITEM_LIST = J.ITEMS.slice();
  J.AMMO_LIST = J.ITEMS.filter(function (ex) { return ex.id === 0 || ex.category === CAT.AMMO; });
  J.ATTACHMENT_LIST = J.ITEMS.filter(function (ex) {
    return ex.id === 0 || ATTACHMENT_CATS.indexOf(ex.category) !== -1;
  });

  J.exemplar = function (id) {
    return Object.prototype.hasOwnProperty.call(J.ITEM_BY_ID, id) ? J.ITEM_BY_ID[id] : null;
  };

  // ---- Item (OBJECTTYPE, 0x24 bytes, JA2 1.0x only) ------------------------------

  var B = function (o) { return new J.ByteField(o); };
  /** INT8 in the game (stats, item status): input limited to 0-127. */
  var B7 = function (o) { return new J.ByteField(o, 127); };
  var S = function (o) { return new J.ShortField(o); };
  var ITEM_CHOICE = function (o) { return new J.ChoiceField(new J.ShortField(o), J.ItemNameTable); };

  var ITEM_FIELDS = {
    'Item ID': ITEM_CHOICE(0x00),
    'Quantity': S(0x02),
    'Item 1 %': B7(0x04),
    'Item 2 %': B7(0x05),
    'Item 3 %': B7(0x06),
    'Item 4 %': B7(0x07),
    'Item 5 %': B7(0x08),
    'Item 6 %': B7(0x09),
    // uiMoneyAmount is a UINT32 (the original JAPE edited only its low 2 bytes)
    'Money Value': new J.UIntField(0x08),
    'Ammo Variety': B(0x05),
    'Ammo Quantity': S(0x06),
    'Ammo ID': ITEM_CHOICE(0x08),
    'Ammo %': B7(0x0A),
    'Attachment 1 ID': ITEM_CHOICE(0x10),
    'Attachment 2 ID': ITEM_CHOICE(0x12),
    'Attachment 3 ID': ITEM_CHOICE(0x14),
    'Attachment 4 ID': ITEM_CHOICE(0x16),
    'Attachment 1 %': B7(0x18),
    'Attachment 2 %': B7(0x19),
    'Attachment 3 %': B7(0x1A),
    'Attachment 4 %': B7(0x1B),
    'Unknown 1': B(0x1C),
    'Unknown 2': B(0x1D),
    'Unknown 3': B(0x1E),
    'Unknown 4': B(0x1F),           // ubImprintID: merc a gun is fingerprint-locked to
    'Weight': S(0x20)
  };

  /** An inventory slot. `data` is a live view into the soldier's data. */
  function Item(data) { J.Structure.call(this, ITEM_FIELDS, data); }
  Item.prototype = Object.create(J.Structure.prototype);
  Item.LENGTH = 0x24;
  Item.prototype.exemplar = function () { return J.exemplar(this.getInt('Item ID')); };

  // ---- Actor (MERCPROFILESTRUCT) -------------------------------------------------

  /**
   * A character profile. `raw` is the record as stored in the file
   * (encrypted for save versions <= 99).
   */
  function Actor(raw, version, table) {
    this.version = version;
    if (version <= 99) {
      this.data = J.Alg.decode(raw, raw.length, table);
    } else {
      this.data = new Uint8Array(raw);
    }

    var agi = version <= 99 ? 0x195 : 0x195 - 19 * 2;
    var mec = version <= 99 ? 0x19b : 0x19b - 19 * 2;
    var checksum = version <= 99 ? 0x2b8 : 0x2b8 - 19 * 4 - 4;

    this.fields = {
      'Name': new J.StringField(0x0, 0x3c),
      'Nickname': new J.StringField(0x3c, 0x14),
      'Medical': B7(0x105),
      'Strength': B7(0x128),
      'Max Health': B7(0x129),
      'Level Inc': B7(0x12a),
      'Health Inc': B7(0x12b),
      'Agility Inc': B7(0x12c),
      'Dexterity Inc': B7(0x12d),
      'Wisdom Inc': B7(0x12e),
      'Marksmanship Inc': B7(0x12f),
      'Medical Inc': B7(0x130),
      'Mechanical Inc': B7(0x131),
      'Explosives Inc': B7(0x132),
      'Strength Inc': B7(0x133),
      'Leadership Inc': B7(0x134),
      'Kills': S(0x136),
      'Assists': S(0x138),
      'Shots Fired': S(0x13a),
      'Shots Hit': S(0x13c),
      'Battles': S(0x13e),
      'Wounds': S(0x140),
      'Health': B7(0x14e),
      'Dexterity': B7(0x14f),
      'Personality': B(0x150),
      'Skill1': new J.ChoiceField(B(0x151), J.SkillTable),
      'Explosives': B7(0x153),
      'Skill2': new J.ChoiceField(B(0x154), J.SkillTable),
      'Leadership': B7(0x155),
      'Level': B7(0x160),
      'Marksmanship': B7(0x161),
      'Wisdom': B7(0x163),
      'Agility': B7(agi),
      'Mechanical': B7(mec),
      'Checksum': new J.IntField(checksum)
    };
  }
  Actor.prototype = Object.create(J.Structure.prototype);

  /** Offset of the inventory size in a version 103 profile record. */
  Actor.INVSIZE_OFFSET_103 = 0x278;

  Actor.prototype.computeChecksum = function () {
    if (this.version <= 99) { return J.Alg.actorChecksum(this.data); }
    return statChecksum(this) + this.inventoryChecksum103() | 0;
  };
  Actor.prototype.inventoryChecksum103 = function () {
    var base = Actor.INVSIZE_OFFSET_103;
    var size = new J.IntField(base).getInt(this.data);
    var sum = 0;
    for (var i = 0; i < size; ++i) {
      var offset = base + 4 + i * 12;
      sum = (sum + new J.IntField(offset).getInt(this.data)) | 0;
      sum = (sum + new J.IntField(offset + 8).getInt(this.data)) | 0;
    }
    return sum;
  };
  Actor.prototype.validateChecksum = function () {
    var checksum = this.computeChecksum();
    var saved = this.getInt('Checksum');
    if (checksum !== saved) {
      throw new J.FormatError('Invalid checksum (0x' + hex(checksum) + ' vs 0x' + hex(saved) +
        ") in MERCPROFILESTRUCT for '" + this.get('Name') + "'");
    }
  };
  Actor.prototype.recomputeChecksum = function () { this.setInt('Checksum', this.computeChecksum()); };

  /** Record bytes ready to be written back to the file. */
  Actor.prototype.encode = function (table) {
    this.recomputeChecksum();
    if (this.version <= 99) { return J.Alg.encode(this.data, this.data.length, table); }
    return new Uint8Array(this.data);
  };

  /**
   * Stat part of the version 103 checksum, shared by Actor and Mercenary.
   * Java int arithmetic: products wrap at 32 bits.
   */
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

  // ---- Mercenary (SOLDIERTYPE) ---------------------------------------------------

  var MERC_CIPHERTEXT_OFFSET = 1;
  var MERC_CIPHERTEXT_LENGTH = 0x918;
  var FIRST_ITEM_OFFSET = 0x0c;
  var ITEM_COUNT = 19;
  var STATS_OFFSET_103 = 428;

  /**
   * A soldier present in the game world.
   * `raw`: ubActive byte + SOLDIERTYPE + trailing data, as in the file.
   * `slot`: index in the game's soldier array (0-19 = the player's team).
   */
  function Mercenary(raw, version, trailingOffset, inventorySum, table, slot) {
    this.version = version;
    this.trailingOffset = trailingOffset;
    this.inventorySum = inventorySum;
    this.slot = slot;
    this.allData = new Uint8Array(raw);
    this.items = null;

    if (version <= 99) {
      var ciphertext = raw.subarray(MERC_CIPHERTEXT_OFFSET, MERC_CIPHERTEXT_OFFSET + MERC_CIPHERTEXT_LENGTH);
      this.data = J.Alg.decode(ciphertext, MERC_CIPHERTEXT_LENGTH, table);
      this.items = [];
      for (var i = 0; i < ITEM_COUNT; ++i) {
        var off = FIRST_ITEM_OFFSET + i * Item.LENGTH;
        this.items.push(new Item(this.data.subarray(off, off + Item.LENGTH)));
      }
    } else {
      this.data = new Uint8Array(raw.subarray(1));
    }

    var v99 = version <= 99;
    var t = trailingOffset;
    var st = function (rel) { return t + rel + STATS_OFFSET_103; };
    this.fields = {
      'Energy': B7(v99 ? 0x2c7 : 45),
      'Max Energy': B7(v99 ? 0x2c8 : 46),
      'Nickname': new J.StringField(v99 ? 0x2da : 2, 20),
      'Skill1': new J.ChoiceField(B(v99 ? 0x340 : st(8)), J.SkillTable),
      'Skill2': new J.ChoiceField(B(v99 ? 0x341 : st(9)), J.SkillTable),
      'Dexterity': B7(v99 ? 0x348 : st(10)),
      'Wisdom': B7(v99 ? 0x349 : st(11)),
      'Level': B7(v99 ? 0x351 : st(2)),
      'Health': B7(v99 ? 0x364 : st(0)),
      'Agility': B7(v99 ? 0x370 : st(3)),
      'Strength': B7(v99 ? 0x376 : st(4)),
      'Leadership': B7(v99 ? 0x37f : st(14)),
      'Mechanical': B7(v99 ? 0x394 : st(5)),
      'Max Health': B7(v99 ? 0x395 : st(1)),
      'Medical': B7(v99 ? 0x55c : st(12)),
      'Marksmanship': B7(v99 ? 0x561 : st(6)),
      'Explosives': B7(v99 ? 0x562 : st(7)),
      'Morale': B7(v99 ? 0x6c8 : t + 204),
      'ubProfile': B(717),
      'Checksum': new J.IntField(v99 ? 0x8a0 : 972)
    };
  }
  Mercenary.prototype = Object.create(J.Structure.prototype);

  Mercenary.HELMET = 0;
  Mercenary.BODY_ARMOR = 1;
  Mercenary.LEG_ARMOR = 2;
  Mercenary.HEADGEAR_1 = 3;
  Mercenary.HEADGEAR_2 = 4;
  Mercenary.RIGHT_HAND = 5;
  Mercenary.LEFT_HAND = 6;
  Mercenary.BACKPACK_1_3 = 7;
  Mercenary.BACKPACK_2_3 = 8;
  Mercenary.BACKPACK_3_3 = 9;
  Mercenary.BACKPACK_4_3 = 10;
  Mercenary.BACKPACK_1_1 = 11;
  Mercenary.BACKPACK_2_1 = 12;
  Mercenary.BACKPACK_3_1 = 13;
  Mercenary.BACKPACK_4_1 = 14;
  Mercenary.BACKPACK_1_2 = 15;
  Mercenary.BACKPACK_2_2 = 16;
  Mercenary.BACKPACK_3_2 = 17;
  Mercenary.BACKPACK_4_2 = 18;

  /** Soldier array slots 0-19 belong to OUR_TEAM (the player's mercs). */
  Mercenary.OUR_TEAM_SIZE = 20;

  Mercenary.prototype.isOnPlayerTeam = function () {
    return this.slot >= 0 && this.slot < Mercenary.OUR_TEAM_SIZE;
  };

  Mercenary.prototype.computeChecksum = function () {
    if (this.version <= 99) { return J.Alg.mercChecksum(this.data); }
    var c = statChecksum(this);
    c = (c + this.getInt('ubProfile') + 1) | 0;
    c = (c + this.inventorySum) | 0;
    return c;
  };
  Mercenary.prototype.validateChecksum = function () {
    var checksum = this.computeChecksum();
    var saved = this.getInt('Checksum');
    if (checksum !== saved) {
      throw new J.FormatError('Invalid checksum (0x' + hex(checksum) + ' vs 0x' + hex(saved) +
        ") in SOLDIERTYPE for '" + this.get('Nickname') + "'");
    }
  };
  Mercenary.prototype.recomputeChecksum = function () { this.setInt('Checksum', this.computeChecksum()); };

  /** Record bytes ready to be written back to the file. */
  Mercenary.prototype.encode = function (table) {
    // Items are live views into this.data, so they need no copying back.
    this.recomputeChecksum();
    var raw = new Uint8Array(this.allData);
    if (this.version <= 99) {
      raw.set(J.Alg.encode(this.data, MERC_CIPHERTEXT_LENGTH, table), MERC_CIPHERTEXT_OFFSET);
    } else {
      raw.set(this.data, 1);
    }
    return raw;
  };

  // ---- Full Dress --------------------------------------------------------------------

  /**
   * "Full Dress": the best JA2 1.0x armour and head gear, put into the
   * armour and head slots (replacing what is there).
   */
  J.FULL_DRESS = [
    { slot: Mercenary.HELMET, id: 0xB6 },                                   // Coated Spectra Helmet
    { slot: Mercenary.BODY_ARMOR, id: 0xA9, attachments: [0xB7, 0xB7, 0xB7, 0xB7] }, // Coated Spectra Vest, 4 Ceramic Plates
    { slot: Mercenary.LEG_ARMOR, id: 0xAF },                                // Coated Spectra Leggings
    { slot: Mercenary.HEADGEAR_1, id: 0xD3 },                               // Night Vision Goggles
    { slot: Mercenary.HEADGEAR_2, id: 0xD2 }                                // Extended Ear
  ];

  // ---- Weight ----------------------------------------------------------------------

  /** Item weight (0.1 kg) of the JA2 1.12 data (js/weights.js); 0 if unknown. */
  J.itemWeight = function (id) {
    var w = J.WEIGHTS_112 && J.WEIGHTS_112[id];
    return w ? w[0] : 0;
  };
  function perPocket(id) {
    var w = J.WEIGHTS_112 && J.WEIGHTS_112[id];
    return w ? w[1] : 0;
  }

  /**
   * The weight the game stores in an object (CalculateObjectWeight): the
   * item's weight; for items that do not stack (ubPerPocket <= 1) plus the
   * attachments and, for a loaded gun, its magazine.
   */
  J.objectWeight = function (item) {
    var id = item.getInt('Item ID');
    var weight = J.itemWeight(id);
    if (perPocket(id) <= 1) {
      for (var k = 1; k <= 4; ++k) { weight += J.itemWeight(item.getInt('Attachment ' + k + ' ID')); }
      var ex = J.exemplar(id);
      if (ex && ex.category === CAT.WEAPON && ex.compatibleAmmoIds.length && item.data[6] > 0) {
        weight += J.itemWeight(item.getInt('Ammo ID'));   // ubGunShotsLeft > 0
      }
    }
    return weight;
  };

  var NO_PROFILE = 200;
  var DRAGUNOV = 0x12;
  var STEYR_AUG = 0x14;
  var LAW = 0x33;
  var AUTO_ROCKET_RIFLE = 0x41;
  var MORTAR_SHELL = 0x8C;
  var CLIP556_HP = 0x5F;
  var CLIP762W_10 = 0x60;
  var MINIROCKETS_HEAP = 0x71;
  var AMMO_HP = 1;
  var AMMO_AP = 2;
  var AMMO_HEAT = 10;
  var SNIPER_SCOPE = 0xD0;
  var LASER_SCOPE = 0xF1;

  /**
   * A stack of LAWs, built like the game's CreateItems(): CreateGun(LAW)
   * (status 100, one rocket, not fingerprint-locked), then the status of each
   * further LAW in bStatus[1..]. Those bytes share space with the gun data,
   * exactly as when the game itself stacks guns. Weight is that of one LAW,
   * as CreateItem() computes it.
   */
  J.makeLawStack = function (item, count) {
    item.data.fill(0);
    item.setInt('Item ID', LAW);
    item.setInt('Item 1 %', 100);              // bGunStatus
    item.setInt('Ammo Quantity', 1);           // ubGunShotsLeft
    item.setInt('Ammo %', 100);                // bGunAmmoStatus
    item.setInt('Unknown 4', NO_PROFILE);     // ubImprintID
    item.setInt('Quantity', 1);
    item.setInt('Weight', J.objectWeight(item));   // weight of one LAW, before stacking
    for (var k = 2; k <= count; ++k) { item.setInt('Item ' + k + ' %', 100); }
    item.setInt('Quantity', count);
  };

  /**
   * A loaded gun with attachments (CreateGun: status 100, not
   * fingerprint-locked, so a rocket rifle locks to the first merc who uses
   * it), attachments at 100%. The game applies attachment bonuses by looking
   * the attachment up on the gun. Weight: gun + attachments + magazine, as
   * the game computes it.
   * @param gun {id, ammo, ammoType, rounds, attachments}
   */
  J.makeLoadedGun = function (item, gun) {
    item.data.fill(0);
    item.setInt('Item ID', gun.id);
    item.setInt('Quantity', 1);
    item.setInt('Item 1 %', 100);              // bGunStatus
    item.setInt('Ammo Variety', gun.ammoType); // ubGunAmmoType
    item.setInt('Ammo Quantity', gun.rounds);  // ubGunShotsLeft (UINT8)
    item.setInt('Ammo ID', gun.ammo);          // usGunAmmoItem
    item.setInt('Ammo %', 100);                // bGunAmmoStatus
    item.setInt('Unknown 4', NO_PROFILE);     // ubImprintID
    gun.attachments.forEach(function (id, k) {
      item.setInt('Attachment ' + (k + 1) + ' ID', id);
      item.setInt('Attachment ' + (k + 1) + ' %', 100);
    });
    item.setInt('Weight', J.objectWeight(item));
  };

  /** Auto Rocket Rifle, 255 HEAP minirockets, Laser Scope and Sniper Scope. */
  J.ROCKET_RIFLE = {
    id: AUTO_ROCKET_RIFLE, ammo: MINIROCKETS_HEAP, ammoType: AMMO_HEAT, rounds: 255,
    attachments: [LASER_SCOPE, SNIPER_SCOPE]
  };
  /** Steyr AUG, 255 rounds of 5.56mm HP, Laser Scope and Sniper Scope. */
  J.STEYR_AUG = {
    id: STEYR_AUG, ammo: CLIP556_HP, ammoType: AMMO_HP, rounds: 255,
    attachments: [LASER_SCOPE, SNIPER_SCOPE]
  };
  /** Dragunov, 255 rounds of 7.62mm WP (its default magazine, AP), Laser Scope and Sniper Scope. */
  J.DRAGUNOV = {
    id: DRAGUNOV, ammo: CLIP762W_10, ammoType: AMMO_AP, rounds: 255,
    attachments: [LASER_SCOPE, SNIPER_SCOPE]
  };

  J.QUICK_ITEMS = {
    law: { id: LAW, label: 'LAW ×6', make: function (item) {
      J.makeLawStack(item, 6);
      item.setInt('Weight', 0);
    } },
    mortarShell: { id: MORTAR_SHELL, label: 'Mortar Shell ×6', make: function (item) {
      item.data.fill(0);
      item.setInt('Item ID', MORTAR_SHELL);
      item.setInt('Quantity', 6);
      for (var k = 1; k <= 6; ++k) { item.setInt('Item ' + k + ' %', 100); }
      item.setInt('Weight', 0);
    } },
    rifle: { id: AUTO_ROCKET_RIFLE, label: 'Auto Rocket Rifle', make: function (item) { J.makeLoadedGun(item, J.ROCKET_RIFLE); } },
    aug: { id: STEYR_AUG, label: 'Steyr AUG', make: function (item) { J.makeLoadedGun(item, J.STEYR_AUG); } },
    dragunov: { id: DRAGUNOV, label: 'Dragunov', make: function (item) { J.makeLoadedGun(item, J.DRAGUNOV); } }
  };

  /** Puts on the Full Dress set: new items, 100%, plates attached at 100%. */
  Mercenary.prototype.fullDress = function () {
    var items = this.items;
    J.FULL_DRESS.forEach(function (piece) {
      var item = items[piece.slot];
      item.data.fill(0);                       // a fresh object, like CreateItem
      item.setInt('Item ID', piece.id);
      item.setInt('Quantity', 1);
      item.setInt('Item 1 %', 100);
      (piece.attachments || []).forEach(function (id, k) {
        item.setInt('Attachment ' + (k + 1) + ' ID', id);
        item.setInt('Attachment ' + (k + 1) + ' %', 100);
      });
      item.setInt('Weight', J.objectWeight(item));
    });
  };

  /** Refills existing kits of the given type or creates one; false if no allowed slot is free. */
  Mercenary.prototype.supplyKit = function (id) {
    var found = false;
    this.items.forEach(function (item) {
      if (item.getInt('Item ID') !== id) { return; }
      found = true;
      var count = Math.min(8, Math.max(1, item.data[2]));
      for (var k = 0; k < count; ++k) { item.data[4 + k] = 100; }
    });
    if (found) { return true; }

    var right = this.items[Mercenary.RIGHT_HAND].exemplar();
    // Items with ubPerPocket = 0 cannot use small pockets.
    var lastSlot = perPocket(id) > 0 ? this.items.length - 1 : Mercenary.BACKPACK_4_3;
    for (var s = lastSlot; s >= Mercenary.LEFT_HAND; --s) {
      var item = this.items[s];
      if (item.getInt('Item ID') !== 0) { continue; }
      if (s === Mercenary.LEFT_HAND && right && right.twoHanded) { continue; }
      item.data.fill(0);
      item.setInt('Item ID', id);
      item.setInt('Quantity', 1);
      item.setInt('Item 1 %', 100);
      item.setInt('Weight', J.objectWeight(item));
      return true;
    }
    return false;
  };

  // ---- Repair / reload -------------------------------------------------------------

  function status(b) { return (b << 24) >> 24; }   // INT8

  /**
   * Restores Health to Max Health (also in the profile, when supplied) and
   * raises the status of every item and attachment below 100% to 100%.
   * Which bytes are statuses depends on the item (the OBJECTTYPE union):
   * a magazine's "status" is its rounds (left alone), money and a single gun
   * have one status byte followed by other data, keys have six.
   * @return number of statuses raised
   */
  Mercenary.prototype.repairAll = function (actor) {
    var maxHealth = this.getInt('Max Health');
    if (this.getInt('Health') < maxHealth) {
      new J.Chain([this, actor]).setInt('Health', maxHealth);
    }
    var raised = 0;
    this.items.forEach(function (item) {
      var ex = J.exemplar(item.getInt('Item ID'));
      if (!ex || ex.id === 0) { return; }
      var count = Math.max(1, item.data[2]);    // ubNumberOfObjects
      var statuses;
      if (ex.category === CAT.AMMO) {
        statuses = 0;
      } else if (ex.category === CAT.MONEY || (ex.category === CAT.WEAPON && count === 1)) {
        statuses = 1;
      } else if (ex.category === CAT.KEY) {
        statuses = Math.min(count, 6);
      } else {
        statuses = Math.min(count, 8);          // bStatus[MAX_OBJECTS_PER_SLOT]
      }
      for (var k = 0; k < statuses; ++k) {
        if (status(item.data[4 + k]) < 100) { item.data[4 + k] = 100; ++raised; }
      }
      for (var a = 0; a < 4; ++a) {             // usAttachItem[4] at 0x10, bAttachStatus[4] at 0x18
        if (item.getInt('Attachment ' + (a + 1) + ' ID') && status(item.data[0x18 + a]) < 100) {
          item.data[0x18 + a] = 100;
          ++raised;
        }
      }
    });
    return raised;
  };

  /**
   * Renews the magazine of every magazine-fed gun (single, not a stack):
   * RELOAD_ROUNDS rounds, the most ubGunShotsLeft (UINT8) holds, ammo
   * status 100 (a negative status is a jammed gun, so this also unjams it)
   * and ammo type RELOAD_AMMO_TYPE. The loaded magazine is kept; a gun with
   * no magazine, or one of another calibre, gets its default magazine.
   * Weight is updated.
   * @return number of guns changed
   */
  var RELOAD_ROUNDS = 255;
  J.RELOAD_ROUNDS = RELOAD_ROUNDS;
  /**
   * AMMO_KNIFE. The game takes the effect of a shot from the gun's ammo type
   * (ubGunAmmoType), not from its magazine: knife rounds are not stopped by
   * vests and leggings (helmets and Ceramic Plates still count) and a hit to
   * the head or torso of an enemy who has not noticed the shooter may kill
   * outright. They do not hurt tanks. Reloading in the game resets the type
   * to that of the new magazine.
   */
  var RELOAD_AMMO_TYPE = 8;
  J.RELOAD_AMMO_TYPE = RELOAD_AMMO_TYPE;
  Mercenary.prototype.reloadAll = function () {
    var reloaded = 0;
    this.items.forEach(function (item) {
      var ex = J.exemplar(item.getInt('Item ID'));
      if (!ex || ex.category !== CAT.WEAPON || !ex.defaultAmmoId || item.data[2] !== 1) { return; }
      var before = Array.prototype.slice.call(item.data).join();
      if (ex.compatibleAmmoIds.indexOf(item.getInt('Ammo ID')) === -1) {
        item.setInt('Ammo ID', ex.defaultAmmoId);
      }
      item.data[6] = RELOAD_ROUNDS;                  // ubGunShotsLeft
      item.setInt('Ammo %', 100);                    // bGunAmmoStatus
      item.setInt('Ammo Variety', RELOAD_AMMO_TYPE); // ubGunAmmoType
      item.setInt('Weight', J.objectWeight(item));
      if (Array.prototype.slice.call(item.data).join() !== before) { ++reloaded; }
    });
    return reloaded;
  };

  /** Repairs, reloads, dresses and supplies a merc, restoring Health and Energy. */
  Mercenary.prototype.prepareAll = function (actor) {
    var before = new Uint8Array(this.data);
    var health = this.getInt('Health');
    var result = {
      repaired: this.repairAll(actor),
      reloaded: this.reloadAll(),
      healed: this.getInt('Health') > health,
      energized: this.getInt('Energy') !== 100 || this.getInt('Max Energy') !== 100,
      missingKits: [],
      changed: false
    };
    this.setInt('Energy', 100);
    this.setInt('Max Energy', 100);
    this.fullDress();
    [0xCA, 0xCD].forEach(function (id) {
      if (!this.supplyKit(id)) { result.missingKits.push(id); }
    }, this);
    for (var i = 0; i < this.data.length; ++i) {
      if (this.data[i] !== before[i]) { result.changed = true; break; }
    }
    return result;
  };

  J.ItemExemplar = ItemExemplar;
  J.Item = Item;
  J.Actor = Actor;
  J.Mercenary = Mercenary;
})(this.JAPE = this.JAPE || {});
