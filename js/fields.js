/*
  JAPE - Jagged Alliance 2 Person Editor, JavaScript port.
  Original Java version written 1999-2008 by Douglas Greiman.

  This software may be used and distributed according to the terms
  of the GNU Public License, incorporated herein by reference.

  Port of the Field classes (ByteField, ShortField, IntField, StringField,
  ChoiceField) and BasicStructure. A field knows its offset inside a byte
  array; a structure maps field names to fields over one byte array.
*/
(function (J) {
  'use strict';

  function NumberFormatError(message) {
    this.name = 'NumberFormatError';
    this.message = message;
  }
  NumberFormatError.prototype = Object.create(Error.prototype);
  NumberFormatError.prototype.constructor = NumberFormatError;

  /** Integer.parseInt equivalent: optional sign and decimal digits only. */
  function parseIntStrict(str) {
    if (typeof str === 'number') { return str | 0; }
    if (!/^[+-]?\d+$/.test(String(str))) {
      throw new NumberFormatError('For input string: "' + str + '"');
    }
    return parseInt(str, 10) | 0;
  }

  // ---- Numeric fields --------------------------------------------------------

  function NumericField(offset, size, min, max) {
    this.offset = offset;
    this.size = size;
    this.min = min;
    this.max = max;
  }
  NumericField.prototype.kind = 'number';
  NumericField.prototype.get = function (data) { return String(this.getInt(data)); };
  NumericField.prototype.set = function (data, str) { this.setInt(data, parseIntStrict(str)); };

  /**
   * Unsigned byte. `max` lowers the accepted input range, e.g. 127 for game
   * fields that are really INT8 (stats, item status): the original JAPE read
   * them as unsigned, so the displayed value is kept unsigned for those.
   */
  function ByteField(offset, max) { NumericField.call(this, offset, 1, 0, max === undefined ? 0xFF : max); }
  ByteField.prototype = Object.create(NumericField.prototype);
  ByteField.prototype.getInt = function (data) { return data[this.offset]; };
  ByteField.prototype.setInt = function (data, value) { data[this.offset] = value & 0xFF; };

  /** Signed byte (INT8), as JA2 1.13 stores stats. */
  function SByteField(offset) { NumericField.call(this, offset, 1, -0x80, 0x7F); }
  SByteField.prototype = Object.create(NumericField.prototype);
  SByteField.prototype.getInt = function (data) { return (data[this.offset] << 24) >> 24; };
  SByteField.prototype.setInt = function (data, value) { data[this.offset] = value & 0xFF; };

  function ShortField(offset) { NumericField.call(this, offset, 2, 0, 0xFFFF); }
  ShortField.prototype = Object.create(NumericField.prototype);
  ShortField.prototype.getInt = function (data) {
    return data[this.offset] | (data[this.offset + 1] << 8);
  };
  ShortField.prototype.setInt = function (data, value) {
    data[this.offset] = value & 0xFF;
    data[this.offset + 1] = (value >>> 8) & 0xFF;
  };

  /** Signed 32-bit little-endian integer, like Java's int. */
  function IntField(offset) { NumericField.call(this, offset, 4, -0x80000000, 0x7FFFFFFF); }
  IntField.prototype = Object.create(NumericField.prototype);
  IntField.prototype.getInt = function (data) {
    var o = this.offset;
    return data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24);
  };
  IntField.prototype.setInt = function (data, value) {
    var o = this.offset;
    data[o] = value & 0xFF;
    data[o + 1] = (value >>> 8) & 0xFF;
    data[o + 2] = (value >>> 16) & 0xFF;
    data[o + 3] = (value >>> 24) & 0xFF;
  };

  // ---- String field ------------------------------------------------------------

  /** Zero-terminated UTF-16LE string occupying `length` bytes. */
  function StringField(offset, length) {
    this.offset = offset;
    this.length = length;
    this.maxChars = length / 2;
  }
  StringField.prototype.kind = 'string';
  StringField.prototype.get = function (data) {
    var s = '';
    for (var i = 0; i < this.maxChars; ++i) {
      var c = data[this.offset + i * 2] | (data[this.offset + i * 2 + 1] << 8);
      if (c === 0) { break; }
      s += String.fromCharCode(c);
    }
    return s;
  };
  StringField.prototype.getInt = function (data) { return parseIntStrict(this.get(data)); };
  StringField.prototype.set = function (data, value) {
    value = String(value);
    for (var i = 0; i < this.maxChars; ++i) {
      var c = i < value.length ? value.charCodeAt(i) : 0;
      // The Java original wrote ((c & 0xFF) >>> 8), i.e. always 0, as the
      // high byte. Writing the real high byte keeps non-Latin characters.
      data[this.offset + i * 2] = c & 0xFF;
      data[this.offset + i * 2 + 1] = (c >>> 8) & 0xFF;
    }
  };
  StringField.prototype.setInt = function (data, value) { this.set(data, String(value)); };

  // ---- Choice field ------------------------------------------------------------

  /**
   * Numeric field whose values have names.
   * `names` maps value -> name (a plain object or Map-like {get}).
   */
  function ChoiceField(baseField, names) {
    this.base = baseField;
    this.names = names;
    this.offset = baseField.offset;
    this.min = baseField.min;
    this.max = baseField.max;
  }
  ChoiceField.prototype.kind = 'choice';
  ChoiceField.prototype.getInt = function (data) { return this.base.getInt(data); };
  ChoiceField.prototype.setInt = function (data, value) { this.base.setInt(data, value); };
  ChoiceField.prototype.get = function (data) {
    var name = this.names.nameOf(this.base.getInt(data));
    return name === undefined ? null : name;
  };
  ChoiceField.prototype.set = function (data, name) {
    var value = this.names.valueOf(name);
    if (value === undefined) { return; }
    this.setInt(data, value);
  };

  /** Two-way value <-> name table for ChoiceField. */
  function NameTable(pairs) {
    this.pairs = pairs;
    this.byValue = {};
    this.byName = {};
    for (var i = 0; i < pairs.length; ++i) {
      this.byValue[pairs[i][0]] = pairs[i][1];
      // Like the Java Hashtable, a duplicated name maps to its last value.
      this.byName[pairs[i][1]] = pairs[i][0];
    }
  }
  NameTable.prototype.nameOf = function (value) {
    return Object.prototype.hasOwnProperty.call(this.byValue, value) ? this.byValue[value] : undefined;
  };
  NameTable.prototype.valueOf = function (name) {
    return Object.prototype.hasOwnProperty.call(this.byName, name) ? this.byName[name] : undefined;
  };
  /** Choices in table order, as [{id, name}]. */
  NameTable.prototype.options = function () {
    return this.pairs.map(function (p) { return { id: p[0], name: p[1] }; });
  };

  // ---- Structures --------------------------------------------------------------

  /** A set of named fields over one byte array (BasicStructure). */
  function Structure(fields, data) {
    this.fields = fields;
    this.data = data;
  }
  Structure.prototype.field = function (name) {
    return Object.prototype.hasOwnProperty.call(this.fields, name) ? this.fields[name] : null;
  };
  Structure.prototype.has = function (name) { return this.field(name) !== null; };
  Structure.prototype.get = function (name) {
    var f = this.field(name);
    return f ? f.get(this.data) : null;
  };
  Structure.prototype.getInt = function (name) {
    var f = this.field(name);
    return f ? f.getInt(this.data) : 0;
  };
  Structure.prototype.set = function (name, value) {
    var f = this.field(name);
    if (f) { f.set(this.data, value); }
  };
  Structure.prototype.setInt = function (name, value) {
    var f = this.field(name);
    if (f) { f.setInt(this.data, value); }
  };

  /**
   * Several structures viewed as one (BasicStructure.chain): reads come from
   * the first structure that has the field, writes go to every structure
   * that has it. Used to show a Mercenary on top of its Actor profile.
   */
  function Chain(structs) {
    this.structs = structs.filter(function (s) { return !!s; });
  }
  Chain.prototype.owner = function (name) {
    for (var i = 0; i < this.structs.length; ++i) {
      if (this.structs[i].has(name)) { return this.structs[i]; }
    }
    return null;
  };
  Chain.prototype.field = function (name) {
    var s = this.owner(name);
    return s ? s.field(name) : null;
  };
  Chain.prototype.has = function (name) { return this.owner(name) !== null; };
  Chain.prototype.get = function (name) {
    var s = this.owner(name);
    return s ? s.get(name) : null;
  };
  Chain.prototype.getInt = function (name) {
    var s = this.owner(name);
    return s ? s.getInt(name) : 0;
  };
  Chain.prototype.set = function (name, value) {
    this.structs.forEach(function (s) { s.set(name, value); });
  };
  Chain.prototype.setInt = function (name, value) {
    this.structs.forEach(function (s) { s.setInt(name, value); });
  };

  J.NumberFormatError = NumberFormatError;
  J.parseIntStrict = parseIntStrict;
  J.ByteField = ByteField;
  J.SByteField = SByteField;
  J.ShortField = ShortField;
  J.IntField = IntField;
  J.StringField = StringField;
  J.ChoiceField = ChoiceField;
  J.NameTable = NameTable;
  J.Structure = Structure;
  J.Chain = Chain;
})(this.JAPE = this.JAPE || {});
