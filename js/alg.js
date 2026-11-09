/*
  JAPE - Jagged Alliance 2 Person Editor, JavaScript port.
  Original Java version written 1999-2008 by Douglas Greiman.

  This software may be used and distributed according to the terms
  of the GNU Public License, incorporated herein by reference.

  Port of JapeAlg.java: the save game cipher and the JA2 1.0x checksums.
  All arithmetic mimics Java 32-bit int / 8-bit byte semantics.
*/
(function (J) {
  'use strict';

  var SALT_PERIOD = 49;

  /** Signed byte value (Java `(int) byte`). */
  function sx(b) { return (b << 24) >> 24; }

  /** Unsigned 16-bit little-endian word. */
  function word(data, offset) { return data[offset] | (data[offset + 1] << 8); }

  /** Encrypt `length` bytes of plaintext with a 49-byte salt table. */
  function encode(plaintext, length, table) {
    var out = new Uint8Array(length);
    var last = 0;
    var offset = 0;
    for (var i = 0; i < length; ++i) {
      out[i] = (plaintext[i] + last + table[offset]) & 0xFF;
      offset = (offset + 1) % SALT_PERIOD;
      last = out[i];
    }
    return out;
  }

  /** Decrypt `length` bytes of ciphertext with a 49-byte salt table. */
  function decode(ciphertext, length, table) {
    var out = new Uint8Array(length);
    var last = 0;
    var offset = 0;
    for (var i = 0; i < length; ++i) {
      out[i] = (ciphertext[i] - last - table[offset]) & 0xFF;
      offset = (offset + 1) % SALT_PERIOD;
      last = ciphertext[i];
    }
    return out;
  }

  /** MERCPROFILESTRUCT checksum, save versions 95-99. */
  function actorChecksum(d) {
    var eax, edx, esi, edi, ebx;
    eax = sx(d[0x129]);
    edx = sx(d[0x14e]);
    eax = eax + 1;
    edx = edx + 2;
    eax = Math.imul(eax, edx);
    edx = sx(d[0x195]);
    edi = 0x1a0;
    eax = (eax + edx + 1) | 0;
    edx = sx(d[0x14f]) + 1;
    eax = Math.imul(eax, edx);
    edx = sx(d[0x128]);
    eax = (eax + edx + 1) | 0;
    edx = sx(d[0x161]) + 1;
    eax = Math.imul(eax, edx);
    edx = sx(d[0x105]);
    eax = (eax + edx + 1) | 0;
    edx = sx(d[0x19b]) + 1;
    eax = Math.imul(eax, edx);
    edx = sx(d[0x153]);
    esi = (eax + edx + 1) | 0;
    eax = sx(d[0x160]) + 1;
    esi = Math.imul(esi, eax);
    edx = 0;
    do {
      ebx = word(d, edi);
      eax = d[0x179 + edx];
      ebx = (ebx + esi) | 0;
      edx = edx + 1;
      edi = edi + 2;
      esi = (ebx + eax) | 0;
    } while (edx < 0x13);
    return esi;
  }

  /** SOLDIERTYPE checksum, save versions 95-99. */
  function mercChecksum(d) {
    var eax, edx, edi;
    var esi = 0x13;
    eax = sx(d[0x395]);
    edx = sx(d[0x364]);
    eax = eax + 1;
    edx = edx + 2;
    eax = Math.imul(eax, edx);

    edx = sx(d[0x370]);
    eax = (eax + edx + 1) | 0;
    edx = sx(d[0x348]) + 1;
    eax = Math.imul(eax, edx);

    edx = sx(d[0x376]);
    eax = (eax + edx + 1) | 0;
    edx = sx(d[0x561]) + 1;
    eax = Math.imul(eax, edx);

    edx = sx(d[0x55c]);
    eax = (eax + edx + 1) | 0;
    edx = sx(d[0x394]) + 1;
    eax = Math.imul(eax, edx);

    edx = sx(d[0x562]);
    eax = (eax + edx + 1) | 0;
    edx = sx(d[0x351]) + 1;
    eax = Math.imul(eax, edx);

    edx = d[0x721];
    var offset = 0xC;
    eax = (eax + edx + 1) | 0;

    do {
      edi = word(d, offset);
      edx = d[offset + 0x2];
      edi = (edi + eax) | 0;
      offset = offset + 0x24;
      esi = esi - 1;
      eax = (edi + edx) | 0;
    } while (esi !== 0);

    return eax;
  }

  J.Alg = {
    encode: encode,
    decode: decode,
    actorChecksum: actorChecksum,
    mercChecksum: mercChecksum
  };
})(this.JAPE = this.JAPE || {});
