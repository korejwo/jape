/*
  JAPE - Jagged Alliance 2 Person Editor, JavaScript port.
  Original Java version written 1999-2008 by Douglas Greiman.

  This software may be used and distributed according to the terms
  of the GNU Public License, incorporated herein by reference.

  Port of SaveGame.java: locates and decodes the character profiles
  (MERCPROFILESTRUCT) and soldiers (SOLDIERTYPE) in a JA2 save, and writes
  them back. Works on an in-memory copy of the file.
*/
(function (J) {
  'use strict';

  function FormatError(message) {
    this.name = 'FormatError';
    this.message = message;
  }
  FormatError.prototype = Object.create(Error.prototype);
  FormatError.prototype.constructor = FormatError;

  function EOFError() {
    this.name = 'EOFError';
    this.message = 'Unexpected end of file reached.';
  }
  EOFError.prototype = Object.create(Error.prototype);
  EOFError.prototype.constructor = EOFError;

  // ---- Layout constants (SaveGame.java) ----------------------------------------

  var LAYOUT = {
    99: {
      uiNumGameEvents_Offset: 0x32f,
      STRATEGICEVENT_Offset: 0x333,
      LaptopSaveInfoStruct_Length: 7440,
      MERCPROFILESTRUCT_Length: 0x2CC,
      SOLDIERTYPE_Length: 0x918
    },
    103: {
      uiNumGameEvents_Offset: 0x333,
      STRATEGICEVENT_Offset: 0x337,
      LaptopSaveInfoStruct_Length: 81840,
      MERCPROFILESTRUCT_Length: 0x278,
      SOLDIERTYPE_Length: 0x430
    }
  };
  var STRATEGICEVENT_Length = 0x1C;
  var MERCPROFILESTRUCT_Count = 0xAA;
  var TOTAL_SOLDIERS = 156;
  var SOLDIERTYPE_TrailingLength_103 = 525;
  var PathSt_Length = 20;
  var NUM_KEYS = 64;
  var KEY_ON_RING_Length = 2;
  var OBJECTTYPE_Length_103 = 5;
  var STACKEDOBJECTDATA_Length_103 = 16;

  // ---- Byte reader -----------------------------------------------------------------

  function Reader(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  Reader.prototype.need = function (n) {
    if (this.pos + n > this.bytes.length) { throw new EOFError(); }
  };
  Reader.prototype.seek = function (pos) { this.pos = pos; };
  /** Signed byte, like DataInput.readByte. */
  Reader.prototype.readByte = function () {
    this.need(1);
    return (this.bytes[this.pos++] << 24) >> 24;
  };
  /** Signed little-endian 32-bit int. */
  Reader.prototype.readIntLE = function () {
    this.need(4);
    var b = this.bytes, p = this.pos;
    this.pos += 4;
    return b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24);
  };
  Reader.prototype.readFully = function (n) {
    this.need(n);
    var out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  };
  Reader.prototype.skip = function (n) {
    this.need(n);
    this.pos += n;
  };

  // ---- Save game ---------------------------------------------------------------------

  /**
   * @param {Uint8Array} bytes  the whole save file
   * @param {string} filename   name shown in the UI
   */
  function SaveGame(bytes, filename) {
    this.bytes = bytes;
    this.filename = filename;
    this.version = 0;
    this.codeTable = null;
    this.codeTableIdx = -1;
    this.codeTableSubIdx = -1;
    this.actorOffset = 0;
    this.mercOffset = 0;
    this.actors = [];
    this.mercs = [];
  }

  SaveGame.load = function (bytes, filename) {
    var game = new SaveGame(bytes, filename);
    game.load();
    return game;
  };

  SaveGame.prototype.load = function () {
    var r = new Reader(this.bytes);

    this.version = r.readIntLE();
    var layout;
    if (this.version >= 95 && this.version <= 99) {
      layout = LAYOUT[99];
    } else if (this.version === 103) {
      layout = LAYOUT[103];
    } else {
      throw new FormatError('Save game version ' + this.version + ' not supported.  ' +
        'Supported values are 95, 96, 97, 97, 99 and 103');
    }
    this.layout = layout;

    r.seek(layout.uiNumGameEvents_Offset);
    var eventCount = r.readIntLE();
    if (eventCount < 0 || eventCount > 1000) {
      throw new FormatError('Internal Error: STRATEGICEVENT_Count = ' + eventCount);
    }

    this.actorOffset = layout.STRATEGICEVENT_Offset + eventCount * STRATEGICEVENT_Length +
      layout.LaptopSaveInfoStruct_Length;

    // Decide which coding table was used for the profiles.
    r.seek(this.actorOffset);
    var probe = r.readFully(16);
    var found = findActorCodeTable(probe);
    if (found === null) { throw new FormatError('Unable to determine code table'); }
    this.codeTableIdx = found[0];
    this.codeTableSubIdx = found[1];
    this.codeTable = found[0] === -1 ? null : J.CODE_TABLES[found[0]][found[1]];

    this.loadActors(r);
    this.mercOffset = r.pos;
    this.loadMercs(r);
    this.linkActorsToMercs();
  };

  SaveGame.prototype.loadActors = function (r) {
    r.seek(this.actorOffset);
    for (var idx = 0; idx < MERCPROFILESTRUCT_Count; ++idx) {
      var start = r.pos;
      r.skip(this.layout.MERCPROFILESTRUCT_Length);
      if (this.version === 103) {
        var inventorySize = r.readIntLE();
        if (inventorySize < 0 || inventorySize > 1000) {
          throw new FormatError('Invalid inventory size ' + inventorySize +
            ' for MERCPROFILESTRUCT ' + idx);
        }
        r.skip(inventorySize * 12);
      }
      var actor = new J.Actor(this.bytes.subarray(start, r.pos), this.version, this.codeTable);
      actor.validateChecksum();
      this.actors.push(actor);
    }
  };

  SaveGame.prototype.loadMercs = function (r) {
    r.seek(this.mercOffset);

    // Initial run of inactive soldiers (may be none).
    var mercIdx = 0;
    while (mercIdx < TOTAL_SOLDIERS) {
      if (r.readByte() !== 0) {
        r.pos -= 1;
        break;
      }
      mercIdx++;
      this.mercOffset++;
    }

    // Active soldiers. Each record starts with its own ubActive byte and
    // carries the ubActive bytes of the inactive soldiers that follow it.
    for (; mercIdx < TOTAL_SOLDIERS; ++mercIdx) {
      var slot = mercIdx;
      var start = r.pos;
      var trailingOffset = 0;
      var inventorySum = 0;

      var ubActive = r.readByte();
      if (ubActive !== 1) { throw new FormatError('ubActive = ' + ubActive); }

      r.skip(this.layout.SOLDIERTYPE_Length);

      if (this.version === 103) {
        inventorySum = inventoryLoad103(r);
        trailingOffset = r.pos - start - 1; // -1 for ubActive
        r.skip(SOLDIERTYPE_TrailingLength_103);
      }

      var nodeCount = r.readIntLE();
      if (nodeCount < 0 || nodeCount > 1000) {
        throw new FormatError('Internal error: uiNumOfNodes=' + nodeCount);
      }
      r.skip(nodeCount * PathSt_Length);

      var ubOne = r.readByte();
      if (ubOne !== 1 && ubOne !== 0) { throw new FormatError('ubOne = ' + ubOne); }
      if (ubOne === 1) { r.skip(NUM_KEYS * KEY_ON_RING_Length); }

      // Following inactive soldiers are kept as opaque bytes of this record.
      while (mercIdx < TOTAL_SOLDIERS) {
        if (r.readByte() !== 0) {
          r.pos -= 1;
          break;
        }
        mercIdx++;
      }

      var merc = new J.Mercenary(this.bytes.subarray(start, r.pos), this.version,
        trailingOffset, inventorySum, this.codeTable, slot);
      merc.validateChecksum();
      this.mercs.push(merc);
    }
  };

  /** Actor index -> Mercenary (matched by nickname, like the original). */
  SaveGame.prototype.linkActorsToMercs = function () {
    var self = this;
    this.actorMercs = this.actors.map(function (actor) {
      return self.getMercByNick(actor.get('Nickname'));
    });
  };

  SaveGame.prototype.getMercByNick = function (nick) {
    for (var i = 0; i < this.mercs.length; ++i) {
      if (this.mercs[i].get('Nickname') === nick) { return this.mercs[i]; }
    }
    return null;
  };

  /** Builds the modified file contents. Does not change this.bytes. */
  SaveGame.prototype.save = function () {
    var out = new Uint8Array(this.bytes);
    var pos = this.actorOffset;
    var i, chunk;
    for (i = 0; i < this.actors.length; ++i) {
      chunk = this.actors[i].encode(this.codeTable);
      out.set(chunk, pos);
      pos += chunk.length;
    }
    pos = this.mercOffset;
    for (i = 0; i < this.mercs.length; ++i) {
      chunk = this.mercs[i].encode(this.codeTable);
      out.set(chunk, pos);
      pos += chunk.length;
    }
    return out;
  };

  /** Call after the bytes returned by save() were written successfully. */
  SaveGame.prototype.commitSaved = function (bytes) {
    this.bytes = bytes;
  };

  function findActorCodeTable(ciphertext) {
    for (var main = 0; main < 4; ++main) {
      for (var sub = 0; sub < 57; ++sub) {
        var p = J.Alg.decode(ciphertext, 8, J.CODE_TABLES[main][sub]);
        if (p[1] === 0 && p[3] === 0 && p[5] === 0 && p[7] === 0) { return [main, sub]; }
      }
    }
    if (ciphertext[1] === 0 && ciphertext[3] === 0 && ciphertext[5] === 0 && ciphertext[7] === 0) {
      return [-1, -1];
    }
    return null;
  }

  // ---- Version 103 (JA2 1.13) inventory walking --------------------------------------

  function inventoryLoad103(r) {
    var size = r.readIntLE();
    if (size < 0 || size > 55) { throw new FormatError('Invalid inventory size ' + size); }
    var sum = 0;
    for (var i = 0; i < size; ++i) {
      sum = (sum + objecttypeLoad103(r)) | 0;
      r.skip(4); // bNewItemCount
      r.skip(4); // bNewItemCycleCount
    }
    return sum;
  }

  function objecttypeLoad103(r) {
    var obj = r.readFully(OBJECTTYPE_Length_103);
    var sum = (obj[0] | (obj[1] << 8)) + obj[2]; // usItem + ubNumberOfObjects
    var stackSize = r.readIntLE();
    if (stackSize < 0 || stackSize > 55) {
      throw new FormatError('Invalid object stack size ' + stackSize);
    }
    for (var i = 0; i < stackSize; ++i) { stackedObjectDataLoad103(r); }
    return sum;
  }

  function stackedObjectDataLoad103(r) {
    r.skip(STACKEDOBJECTDATA_Length_103);
    var attachments = r.readIntLE();
    if (attachments < 0 || attachments > 55) {
      throw new FormatError('Invalid attachment size ' + attachments);
    }
    for (var i = 0; i < attachments; ++i) { objecttypeLoad103(r); }
  }

  J.FormatError = FormatError;
  J.EOFError = EOFError;
  J.SaveGame = SaveGame;
})(this.JAPE = this.JAPE || {});
