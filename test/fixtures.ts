/**
 * Test-only builders for structurally valid 3DS/DS binaries.
 * They are NOT installable (no valid signatures/content) — used to verify parsers.
 */
import { align64, mortonIndex8x8 } from '../src/utils/binary3dsParser.ts';

function writeUtf16(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint16(offset + i * 2, text.charCodeAt(i), true);
}

/** SMDH whose 48x48 icon is solid `rgb565` except pixel (0,0) which is pure red (0xF800). */
export function buildSmdh(title: string, publisher: string, rgb565 = 0x001f): Uint8Array {
  const smdh = new Uint8Array(0x36c0);
  const view = new DataView(smdh.buffer);
  smdh.set(new TextEncoder().encode('SMDH'), 0);
  const eng = 0x08 + 0x200;
  writeUtf16(view, eng, title);
  writeUtf16(view, eng + 0x80, `${title} long description`);
  writeUtf16(view, eng + 0x180, publisher);
  for (let i = 0; i < 48 * 48; i++) view.setUint16(0x24c0 + i * 2, rgb565, true);
  // pixel (0,0) lives in tile 0 at morton index 0
  view.setUint16(0x24c0 + mortonIndex8x8(0, 0) * 2, 0xf800, true);
  return smdh;
}

export function buildCia(params: {
  titleId: string;
  productCode: string;
  title: string;
  publisher: string;
  contentSize?: number;
  noCrypto?: boolean;
}): Uint8Array {
  const headerSize = 0x2020;
  const certSize = 0x0a00;
  const ticketSize = 0x0350;
  const tmdSize = 0x0b34;
  const contentSize = params.contentSize ?? 0x30000; // pushes meta beyond 64 KB
  const metaSize = 0x3ac0;

  const ticketOffset = align64(headerSize) + align64(certSize);
  const tmdOffset = ticketOffset + align64(ticketSize);
  const contentOffset = tmdOffset + align64(tmdSize);
  const metaOffset = contentOffset + align64(contentSize);

  const buf = new Uint8Array(metaOffset + metaSize);
  const view = new DataView(buf.buffer);
  view.setUint32(0x00, headerSize, true);
  view.setUint32(0x08, certSize, true);
  view.setUint32(0x0c, ticketSize, true);
  view.setUint32(0x10, tmdSize, true);
  view.setUint32(0x14, metaSize, true);
  view.setBigUint64(0x18, BigInt(contentSize), true);

  const tid = params.titleId.padStart(16, '0');
  const tidBytes = tid.match(/../g)!.map((h) => parseInt(h, 16));
  // Ticket & TMD with RSA-2048 SHA-256 signatures (type 0x00010004, big-endian)
  view.setUint32(ticketOffset, 0x00010004, false);
  buf.set(tidBytes, ticketOffset + 0x140 + 0x9c);
  view.setUint32(tmdOffset, 0x00010004, false);
  buf.set(tidBytes, tmdOffset + 0x140 + 0x4c);

  buf.set(new TextEncoder().encode('NCCH'), contentOffset + 0x100);
  buf.set(new TextEncoder().encode(params.productCode), contentOffset + 0x150);
  buf[contentOffset + 0x18f] = params.noCrypto === false ? 0 : 0x04;

  buf.set(buildSmdh(params.title, params.publisher), metaOffset + 0x400);
  return buf;
}

export function build3dsx(title: string, publisher: string, codeSize = 0x20000): Uint8Array {
  const smdh = buildSmdh(title, publisher, 0x07e0);
  const headerSize = 0x2c;
  const smdhOffset = headerSize + codeSize;
  const buf = new Uint8Array(smdhOffset + smdh.length);
  const view = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode('3DSX'), 0);
  view.setUint16(4, headerSize, true);
  view.setUint16(6, 8, true);
  view.setUint32(0x10, codeSize, true);
  view.setUint32(0x20, smdhOffset, true);
  view.setUint32(0x24, smdh.length, true);
  buf.set(smdh, smdhOffset);
  return buf;
}

export function buildNds(gameTitle: string, gameCode: string, bannerTitle: string, bannerOffset = 0x24000): Uint8Array {
  const buf = new Uint8Array(bannerOffset + 0x840);
  const view = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode(gameTitle.slice(0, 12)), 0x00);
  buf.set(new TextEncoder().encode(gameCode), 0x0c);
  view.setUint32(0x68, bannerOffset, true);
  view.setUint16(bannerOffset, 1, true);
  // icon: every pixel uses palette index 1; palette[1] = pure green (BGR555 0x03E0)
  for (let i = 0; i < 0x200; i++) buf[bannerOffset + 0x20 + i] = 0x11;
  view.setUint16(bannerOffset + 0x220 + 2, 0x03e0, true);
  writeUtf16(view, bannerOffset + 0x340, bannerTitle);
  return buf;
}

/** Decodes pixel (x,y) of a 24-bit top-down BMP data URL -> [r,g,b]. */
export function bmpPixel(dataUrl: string, x: number, y: number): [number, number, number] {
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  const width = bytes.readInt32LE(18);
  const rowStride = (width * 3 + 3) & ~3;
  const o = 54 + y * rowStride + x * 3;
  return [bytes[o + 2], bytes[o + 1], bytes[o]];
}
