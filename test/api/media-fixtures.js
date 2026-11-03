// Tiny, hand-built image files and an in-memory stand-in for R2, for the timed-photo tests. The images are structurally
// valid (signatures, markers, chunks and sizes) so they exercise the server's real validation and metadata stripping.
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const be16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

export const GPS_MARKER = 'GPS-LAT-14.5995-LON-120.9842';

export function pngChunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([be32(data.length), body, be32(crc32(body))]);
}

/** A real, decodable PNG of one solid colour, optionally with text metadata chunks. */
export function makePng({ width = 8, height = 8, withMetadata = true } = {}) {
  const ihdr = Buffer.concat([be32(width), be32(height), Buffer.from([8, 2, 0, 0, 0])]);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x88)]);
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...(withMetadata ? [pngChunk('tEXt', Buffer.from(`Comment\0${GPS_MARKER}`)), pngChunk('eXIf', Buffer.from(GPS_MARKER)), pngChunk('tIME', Buffer.alloc(7))] : []),
    pngChunk('IDAT', idat),
    pngChunk('IEND'),
  ]);
}

/** A JPEG with the markers the server reads (APP0, APP1 EXIF with a GPS string, COM, SOF0, SOS) and an EOI. */
export function makeJpeg({ width = 16, height = 16, withMetadata = true, pad = 0 } = {}) {
  const seg = (marker, data) => Buffer.concat([Buffer.from([0xff, marker]), be16(data.length + 2), data]);
  const sof = Buffer.concat([Buffer.from([8]), be16(height), be16(width), Buffer.from([1, 1, 0x11, 0])]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...(withMetadata ? [seg(0xe1, Buffer.from(`Exif\0\0${GPS_MARKER}`)), seg(0xfe, Buffer.from('a comment'))] : []),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.alloc(24 + pad, 0x55),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A still lossless WebP (VP8X + EXIF + VP8L) with the given size. */
export function makeWebp({ width = 16, height = 16, withMetadata = true, animated = false } = {}) {
  const chunk = (type, data) => Buffer.concat([Buffer.from(type, 'latin1'), le32(data.length), data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  const vp8x = Buffer.alloc(10);
  vp8x[0] = (withMetadata ? 0x08 : 0) | (animated ? 0x02 : 0);
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const vp8l = Buffer.alloc(12, 0x33);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  const body = Buffer.concat([
    Buffer.from('WEBP'),
    chunk('VP8X', vp8x),
    ...(animated ? [chunk('ANIM', Buffer.alloc(6))] : []),
    ...(withMetadata ? [chunk('EXIF', Buffer.from(GPS_MARKER))] : []),
    chunk('VP8L', vp8l),
  ]);
  return Buffer.concat([Buffer.from('RIFF'), le32(body.length), body]);
}

export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'.padEnd(64, ' '));
export const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 1)]);
export const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(80, 7)]);
export const HTML = Buffer.from('<html><body><script>alert(1)</script></body></html>'.padEnd(64, ' '));
export const toBase64 = (buf) => buf.toString('base64');

/** An in-memory stand-in for the R2 store, with switches to make each call fail. */
export function fakeStore() {
  const objects = new Map();
  const log = [];
  const store = {
    objects,
    log,
    failPut: false,
    failGet: false,
    failDelete: false,
    async put(key, body, contentType) {
      log.push(['put', key]);
      if (store.failPut) throw Object.assign(new Error('r2 down'), { code: 'r2_500' });
      objects.set(key, { body: Buffer.from(body), contentType });
    },
    async get(key) {
      log.push(['get', key]);
      if (store.failGet) throw Object.assign(new Error('r2 down'), { code: 'r2_500' });
      const found = objects.get(key);
      if (!found) throw Object.assign(new Error('missing'), { code: 'not_found' });
      return Buffer.from(found.body);
    },
    async delete(key) {
      log.push(['delete', key]);
      if (store.failDelete) throw Object.assign(new Error('r2 down'), { code: 'r2_500' });
      objects.delete(key);
    },
  };
  return store;
}
