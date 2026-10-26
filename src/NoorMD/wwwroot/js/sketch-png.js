// Exact PNG encoding/decoding for NoorSketch. A browser canvas stores premultiplied alpha, which changes
// half-transparent pixels on every round trip; NoorSketch keeps its own straight-alpha RGBA buffer and writes
// and reads PNG itself (zlib via the built-in CompressionStream), so a saved sketch reopens pixel-identical.
window.NoorPng = (() => {
  'use strict';
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes, start, end) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function pipe(data, stream) {
    const out = new Response(new Blob([data]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** RGBA (straight alpha) → PNG bytes. Rows use the "Sub" filter, which suits drawings well. */
  async function encode(rgba, width, height) {
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      const o = y * (stride + 1), s = y * stride;
      raw[o] = 1; // Sub
      for (let x = 0; x < stride; x++) raw[o + 1 + x] = (rgba[s + x] - (x >= 4 ? rgba[s + x - 4] : 0)) & 0xff;
    }
    const idat = await pipe(raw, new CompressionStream('deflate'));
    const chunks = [];
    const chunk = (type, data) => {
      const buf = new Uint8Array(12 + data.length);
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, data.length);
      for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i);
      buf.set(data, 8);
      dv.setUint32(8 + data.length, crc32(buf, 4, 8 + data.length));
      chunks.push(buf);
    };
    const ihdr = new Uint8Array(13);
    const hv = new DataView(ihdr.buffer);
    hv.setUint32(0, width); hv.setUint32(4, height);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
    chunk('IHDR', ihdr);
    chunk('IDAT', idat);
    chunk('IEND', new Uint8Array(0));
    const total = 8 + chunks.reduce((a, c) => a + c.length, 0);
    const png = new Uint8Array(total);
    png.set(SIG, 0);
    let pos = 8;
    for (const c of chunks) { png.set(c, pos); pos += c.length; }
    return png;
  }

  /** PNG bytes → { width, height, rgba } for 8-bit RGBA/RGB/grey(+alpha), non-interlaced images. */
  async function decode(png) {
    for (let i = 0; i < 8; i++) if (png[i] !== SIG[i]) throw new Error('Not a PNG image.');
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat = [];
    while (pos + 8 <= png.length) {
      const len = dv.getUint32(pos);
      const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
      const data = png.subarray(pos + 8, pos + 8 + len);
      if (crc32(png, pos + 4, pos + 8 + len) !== dv.getUint32(pos + 8 + len)) throw new Error('The PNG image is damaged (checksum).');
      if (type === 'IHDR') { width = dv.getUint32(pos + 8); height = dv.getUint32(pos + 12); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(colorType)) throw new Error('This PNG format is not supported here.');
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
    const joined = new Uint8Array(idat.reduce((a, d) => a + d.length, 0));
    let o = 0;
    for (const d of idat) { joined.set(d, o); o += d.length; }
    const raw = await pipe(joined, new DecompressionStream('deflate'));
    const stride = width * channels;
    if (raw.length < (stride + 1) * height) throw new Error('The PNG image is damaged (too short).');
    const px = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? px[dst + x - channels] : 0;
        const b = y > 0 ? px[up + x] : 0;
        const c = y > 0 && x >= channels ? px[up + x - channels] : 0;
        let v = raw[src + x];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        else if (f !== 0) throw new Error('The PNG image is damaged (filter).');
        px[dst + x] = v & 0xff;
      }
    }
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += channels) {
      const k = i * 4;
      if (channels === 4) { rgba[k] = px[j]; rgba[k + 1] = px[j + 1]; rgba[k + 2] = px[j + 2]; rgba[k + 3] = px[j + 3]; }
      else if (channels === 3) { rgba[k] = px[j]; rgba[k + 1] = px[j + 1]; rgba[k + 2] = px[j + 2]; rgba[k + 3] = 255; }
      else if (channels === 2) { rgba[k] = rgba[k + 1] = rgba[k + 2] = px[j]; rgba[k + 3] = px[j + 1]; }
      else { rgba[k] = rgba[k + 1] = rgba[k + 2] = px[j]; rgba[k + 3] = 255; }
    }
    return { width, height, rgba };
  }

  const toBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const fromBase64 = (b64) => { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

  return { encode, decode, toBase64, fromBase64 };
})();
