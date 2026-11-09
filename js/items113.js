/*
  JAPE - Jagged Alliance 2 Person Editor, JavaScript port.

  This software may be used and distributed according to the terms
  of the GNU Public License, incorporated herein by reference.

  JA2 1.13 v5: item database (J.DATA113_V5) and replacing an inventory item
  with another of the same kind (gun -> gun, melee -> melee, armour -> armour
  of the same class).

  New objects are built the way the game creates items (Tactical/Items.cpp
  in the v5 sources): CreateGun / CreateItem, then AttachDefaultAttachments.
  The replaced item's attachments are dropped. With the new attachment
  system (NAS) the attachment list holds only the default attachments; the
  game sorts them into slots when it loads the save, and an empty list gets
  its slots when the item description is first opened.
*/
(function (J) {
  'use strict';

  var IC = {
    GUN: 0x2, BLADE: 0x4, THROWING_KNIFE: 0x8, LAUNCHER: 0x10, PUNCH: 0x80,
    AMMO: 0x400, ARMOUR: 0x800, LBEGEAR: 0x20000
  };
  var MONSTERCLASS = 7;
  var NO_PROFILE = 200;
  var GS_CARTRIDGE_IN_CHAMBER = 0x01;
  var OBJECT_UNDROPPABLE = 0x01;
  var HANDPOS = 5;
  var SECONDHANDPOS = 6;

  // ObjectData (48 bytes), offsets measured with MSVC x86 on the v5 headers
  var OD = {
    status: 0, ammoType: 2, shots: 4, ammoItem: 6, ammoStatus: 8, gunState: 10,
    imprint: 14, temperature: 16, repairThreshold: 30, objectFlag: 40
  };

  var ARMOUR_CLASS_NAMES = ['helmet', 'vest', 'leggings', 'plate'];
  var MELEE_NAMES = {};
  MELEE_NAMES[IC.BLADE] = 'blade';
  MELEE_NAMES[IC.THROWING_KNIFE] = 'throwing knife';
  MELEE_NAMES[IC.PUNCH] = 'punching weapon';

  var SLOTS_NIV = ['Helmet', 'Vest', 'Leg armor', 'Head 1', 'Head 2', 'Hand', 'Second hand',
    'Vest (LBE)', 'Left thigh (LBE)', 'Right thigh (LBE)', 'Combat pack', 'Backpack',
    'Gun sling', 'Knife'];
  var i;
  for (i = 1; i <= 7; ++i) { SLOTS_NIV.push('Big pocket ' + i); }
  for (i = 1; i <= 4; ++i) { SLOTS_NIV.push('Medium pocket ' + i); }
  for (i = 1; i <= 30; ++i) { SLOTS_NIV.push('Small pocket ' + i); }
  var SLOTS_OIV = ['Helmet', 'Vest', 'Leg armor', 'Head 1', 'Head 2', 'Hand', 'Second hand'];
  for (i = 1; i <= 4; ++i) { SLOTS_OIV.push('Big pocket ' + i); }
  for (i = 1; i <= 8; ++i) { SLOTS_OIV.push('Small pocket ' + i); }

  // ---- byte helpers ----------------------------------------------------------------

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function s16(b, o) { return (u16(b, o) << 16) >> 16; }
  function put16(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; }
  function put32(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; b[o + 2] = (v >>> 16) & 0xFF; b[o + 3] = (v >>> 24) & 0xFF; }
  function int32Bytes(v) { var b = new Uint8Array(4); put32(b, 0, v); return b; }
  function concat(parts) {
    var out = new Uint8Array(parts.reduce(function (n, p) { return n + p.length; }, 0));
    var at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  // ===========================================================================
  // Item database
  // ===========================================================================

  function ItemDB(data) {
    var self = this;
    this.source = data.source;
    this.byId = {};
    this.list = data.items.map(function (r) {
      var defaults = [];
      for (var k = 0; k < r[7].length && r[7][k] !== 0; ++k) { defaults.push(r[7][k]); }
      var item = {
        id: r[0], name: r[1], longName: r[2] || r[1], cls: r[3], classIndex: r[4], size: r[5],
        twoHanded: !!(r[6] & 1), undroppable: !!(r[6] & 2), food: !!(r[6] & 4), random: !!(r[6] & 8),
        defaults: defaults, armourClass: r[8]
      };
      self.byId[item.id] = item;
      return item;
    });
    this.weapons = data.weapons;
    this.magazines = data.magazines;
    this.ammoTypes = data.ammoTypes;
    this.calibres = data.calibres;
    this.groupCache = {};
  }

  ItemDB.prototype.item = function (id) {
    return Object.prototype.hasOwnProperty.call(this.byId, id) ? this.byId[id] : null;
  };
  ItemDB.prototype.name = function (id) {
    var it = this.item(id);
    return it ? it.name : 'Unknown item #' + id;
  };
  ItemDB.prototype.weapon = function (id) {
    var w = this.weapons[id];
    return w ? { calibre: w[0], magSize: w[1], weaponClass: w[2], burst: w[3], autofire: w[4] } : null;
  };
  /** Magazine data of an ammo item (Magazine[Item[id].ubClassIndex]). */
  ItemDB.prototype.magazineOf = function (id) {
    var it = this.item(id);
    if (!it || it.cls !== IC.AMMO) { return null; }
    var m = this.magazines[it.classIndex];
    return m ? { calibre: m[0], magSize: m[1], ammoType: m[2], itemId: m[3] } : null;
  };
  ItemDB.prototype.calibreName = function (c) { return this.calibres[c] || 'calibre ' + c; };
  ItemDB.prototype.ammoTypeName = function (t) { return this.ammoTypes[t] ? this.ammoTypes[t][0] : 'type ' + t; };

  /** Port of DefaultMagazine(): the magazine a new gun is loaded with (0 if none). */
  ItemDB.prototype.defaultMagazine = function (gunId) {
    var it = this.item(gunId);
    var w = this.weapon(gunId);
    if (!it || !(it.cls & IC.GUN) || !w) { return 0; }
    var best = 0;
    var bestSize = 9999;
    for (var k = 0; k < this.magazines.length; ++k) {
      var m = this.magazines[k];
      if (m[0] === 0) { break; }                       // NOAMMO ends the table
      var type = this.ammoTypes[m[2]];
      if (m[0] !== w.calibre || !type || !type[1]) { continue; }   // standardIssue
      if (!w.burst && !w.autofire && type[2]) { continue; }         // no tracers in single-shot guns
      if (m[1] === w.magSize) { return m[3]; }
      if (m[1] > w.magSize && m[1] < bestSize) {
        best = m[3];
        bestSize = m[1];
      }
    }
    return best;
  };

  /**
   * Which items an item may be replaced with: a key, or null when the item
   * cannot be replaced (LBE gear, ammo, grenades, kits, ...).
   */
  ItemDB.prototype.groupOf = function (it) {
    if (!it || it.id === 0 || it.random || !it.name) { return null; }
    if (it.cls === IC.GUN) {
      var w = this.weapon(it.id);
      if (!w || w.weaponClass === MONSTERCLASS || w.calibre === 0) { return null; }
      // The game cannot create a gun without a default magazine.
      return this.magazineOf(this.defaultMagazine(it.id)) ? 'gun' : null;
    }
    if (MELEE_NAMES[it.cls]) { return 'melee:' + it.cls; }
    if (it.cls === IC.ARMOUR && it.armourClass >= 0 && it.armourClass < ARMOUR_CLASS_NAMES.length) {
      return 'armour:' + it.armourClass;
    }
    return null;
  };
  ItemDB.prototype.groupLabel = function (group) {
    if (group === 'gun') { return 'gun'; }
    var parts = group.split(':');
    return parts[0] === 'armour' ? ARMOUR_CLASS_NAMES[+parts[1]] : MELEE_NAMES[+parts[1]];
  };
  ItemDB.prototype.group = function (group) {
    if (!this.groupCache[group]) {
      var self = this;
      this.groupCache[group] = this.list
        .filter(function (it) { return self.groupOf(it) === group; })
        .sort(function (a, b) { return a.name.localeCompare(b.name) || a.id - b.id; });
    }
    return this.groupCache[group];
  };

  // ===========================================================================
  // Building objects (CreateItem / CreateGun / AttachDefaultAttachments)
  // ===========================================================================

  /** ObjectData of a new gun (CreateGun). Returns null if it has no magazine. */
  function newGunData(db, gunId, status) {
    var d = new Uint8Array(48);
    put16(d, OD.status, status);
    d[OD.imprint] = NO_PROFILE;
    put16(d, OD.repairThreshold, Math.trunc((200 + status) / 3));
    var mag = db.magazineOf(db.defaultMagazine(gunId));
    if (!mag) { return null; }
    put16(d, OD.ammoItem, mag.itemId);
    d[OD.ammoType] = mag.ammoType;
    put16(d, OD.ammoStatus, 100);
    put16(d, OD.shots, mag.magSize);
    d[OD.gunState] |= GS_CARTRIDGE_IN_CHAMBER;
    return d;
  }

  /** ObjectData of any other new item (CreateItem). */
  function newItemData(it, status) {
    var d = new Uint8Array(48);
    put16(d, OD.status, status);
    put16(d, OD.repairThreshold, it.cls === IC.ARMOUR ? Math.trunc((200 + status) / 3) : 100);
    return d;
  }

  function objectBytes(itemId, number, mission, flags, entries) {
    var pod = new Uint8Array(5);
    put16(pod, 0, itemId);
    pod[2] = number;
    pod[3] = mission;
    pod[4] = flags;
    var parts = [pod, int32Bytes(entries.length)];
    entries.forEach(function (e) {
      parts.push(e.data, int32Bytes(e.attachments.length));
      e.attachments.forEach(function (a) { parts.push(a); });
    });
    return concat(parts);
  }

  /** Default attachments of an item, each created like CreateItem does. */
  function defaultAttachments(db, it, status, nas) {
    if (!nas) { return []; }
    var out = [];
    it.defaults.forEach(function (id) {
      var bytes = createItem(db, id, status, nas);
      if (bytes) { out.push(bytes); }
    });
    return out;
  }

  /** Serialized new object with one item, or null if the game could not create it. */
  function createItem(db, id, status, nas) {
    var it = db.item(id);
    if (!it) { return null; }
    var data = it.cls === IC.GUN ? newGunData(db, id, status) : newItemData(it, status);
    if (!data) { return null; }
    return objectBytes(id, 1, 0, it.undroppable ? OBJECT_UNDROPPABLE : 0,
      [{ data: data, attachments: defaultAttachments(db, it, status, nas) }]);
  }

  // ===========================================================================
  // A soldier's inventory
  // ===========================================================================

  /**
   * @param soldier J.SaveGame113 soldier record
   * @param game    the J.SaveGame113 it belongs to
   */
  function Inventory113(soldier, game, db) {
    this.soldier = soldier;
    this.db = db;
    this.nas = game.attachmentSystem !== 0;
    this.slotNames = game.inventorySystem ? SLOTS_NIV : SLOTS_OIV;
    this.firstPocket = game.inventorySystem ? 14 : 7;
  }

  Inventory113.prototype.slotName = function (index) {
    return this.slotNames[index] || 'Slot ' + (index + 1);
  };

  /** Description of one slot, or null if it is empty. */
  Inventory113.prototype.slot = function (index) {
    var s = this.soldier.inventory[index];
    if (!s || !s.node.usItem || !s.node.number) { return null; }
    var db = this.db;
    var node = s.node;
    var it = db.item(node.usItem);
    var first = node.stacks[0];
    var info = {
      index: index,
      slotName: this.slotName(index),
      id: node.usItem,
      item: it,
      name: db.name(node.usItem),
      number: node.number,
      status: first ? s16(s.bytes, first.data + OD.status) : 0,
      lbe: node.stacks.some(function (e) { return e.lbe; }),
      attachments: [],
      ammo: null
    };
    node.stacks.forEach(function (e) {
      e.attachments.forEach(function (a) {
        if (a.usItem && a.number) { info.attachments.push(db.name(a.usItem)); }
      });
    });
    if (it && it.cls === IC.GUN && first) {
      var ammoItem = u16(s.bytes, first.data + OD.ammoItem);
      var mag = db.magazineOf(ammoItem);
      info.ammo = {
        item: ammoItem,
        name: ammoItem ? db.name(ammoItem) : 'none',
        shots: u16(s.bytes, first.data + OD.shots),
        calibre: mag ? db.calibreName(mag.calibre) : '',
        type: db.ammoTypeName(s.bytes[first.data + OD.ammoType])
      };
    }
    return info;
  };

  /** All non-empty slots, in slot order. */
  Inventory113.prototype.slots = function () {
    var out = [];
    for (var k = 0; k < this.soldier.inventory.length; ++k) {
      var info = this.slot(k);
      if (info) { out.push(info); }
    }
    return out;
  };

  /**
   * Replacement options for a slot: {items: [...]} or {reason: '...'} when
   * the item there cannot be replaced.
   */
  Inventory113.prototype.options = function (index) {
    var info = this.slot(index);
    if (!info) { return { reason: 'Empty slot.' }; }
    if (!info.item) { return { reason: 'Unknown item #' + info.id + ' (not in the v5 item data).' }; }
    if (info.lbe || info.item.cls === IC.LBEGEAR) { return { reason: 'LBE gear carries other items and cannot be replaced.' }; }
    if (index === SECONDHANDPOS && this.twoHandedInHand()) {
      return { reason: 'Blocked: ' + this.twoHandedInHand().name + ' in the hand is two-handed.' };
    }
    var group = this.db.groupOf(info.item);
    if (!group) { return { reason: 'Only guns, melee weapons and armour can be replaced.' }; }
    var items = this.db.group(group);
    if (index >= this.firstPocket) {
      // A pocket fits what fitted before: nothing bigger than the current item.
      var size = info.item.size;
      items = items.filter(function (it) { return it.size <= size || it.id === info.id; });
    }
    return { items: items, group: this.db.groupLabel(group) };
  };

  /** The two-handed item held in the hand, if any. */
  Inventory113.prototype.twoHandedInHand = function () {
    var hand = this.slot(HANDPOS);
    return hand && hand.item && hand.item.twoHanded ? hand.item : null;
  };

  /** Error message if the replacement is not allowed, else null. */
  Inventory113.prototype.check = function (index, newId) {
    var opts = this.options(index);
    if (opts.reason) { return opts.reason; }
    var it = this.db.item(newId);
    if (!it || opts.items.indexOf(it) === -1) { return this.db.name(newId) + ' cannot go into this slot.'; }
    if (index === HANDPOS && it.twoHanded && this.slot(SECONDHANDPOS)) {
      return it.name + ' is a two-handed weapon.\nEmpty the second hand first.';
    }
    return null;
  };

  /**
   * Replaces the item in a slot with a new one of the same kind. Every
   * object of a stack is replaced. Attachments are dropped, the new item
   * gets its default attachments. A gun keeps its magazine when the calibre
   * matches (rounds limited to the new magazine size), otherwise it gets its
   * default magazine, full.
   * @return summary {removed: [names], added: [names], ammo: text|null}
   */
  Inventory113.prototype.replace = function (index, newId) {
    var error = this.check(index, newId);
    if (error) { throw new Error(error); }
    var db = this.db;
    var nas = this.nas;
    var slot = this.soldier.inventory[index];
    var node = slot.node;
    var old = slot.bytes;
    var it = db.item(newId);
    var before = this.slot(index);
    var newWeapon = it.cls === IC.GUN ? db.weapon(newId) : null;
    var keptAmmo = false;

    var entries = node.stacks.map(function (e) {
      var status = s16(old, e.data + OD.status);
      var data;
      if (newWeapon) {
        data = newGunData(db, newId, status);
        var oldMag = db.magazineOf(u16(old, e.data + OD.ammoItem));
        if (oldMag && oldMag.calibre === newWeapon.calibre && db.item(node.usItem).cls === IC.GUN) {
          // Same calibre: keep what is loaded.
          put16(data, OD.ammoItem, u16(old, e.data + OD.ammoItem));
          data[OD.ammoType] = old[e.data + OD.ammoType];
          put16(data, OD.ammoStatus, s16(old, e.data + OD.ammoStatus));
          put16(data, OD.shots, Math.min(u16(old, e.data + OD.shots), newWeapon.magSize));
          data[OD.gunState] = old[e.data + OD.gunState];
          keptAmmo = true;
        }
      } else {
        data = newItemData(it, status);
      }
      return { data: data, attachments: defaultAttachments(db, it, status, nas) };
    });

    var flags = (old[4] & ~OBJECT_UNDROPPABLE) | (it.undroppable ? OBJECT_UNDROPPABLE : 0);
    this.soldier.setSlotObject(index, objectBytes(newId, node.number, old[3], flags, entries));

    var after = this.slot(index);
    var summary = {
      removed: before.attachments,
      added: nas ? it.defaults.map(function (id) { return db.name(id); }) : [],
      ammo: null
    };
    if (after.ammo) {
      summary.ammo = (keptAmmo ? 'kept ' : 'loaded ') + after.ammo.name + ', ' + after.ammo.shots + ' rounds';
    }
    return summary;
  };

  J.Items113 = {
    ItemDB: ItemDB,
    Inventory: Inventory113,
    db: function () {
      if (!J.items113Db && J.DATA113_V5) { J.items113Db = new ItemDB(J.DATA113_V5); }
      return J.items113Db || null;
    }
  };
})(this.JAPE = this.JAPE || {});
