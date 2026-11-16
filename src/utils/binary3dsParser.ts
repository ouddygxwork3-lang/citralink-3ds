/**
 * Nintendo 3DS & DS binary format inspector (.CIA, .3DSX, .NDS, SMDH).
 *
 * Reads only the byte ranges it needs through a {@link ByteReader}, so a multi-gigabyte
 * .CIA/.NDS can be inspected without loading the whole file. The same code runs in the
 * browser (File.slice) and on the server (fs.read).
 *
 * Fields that cannot be read from the binary are left `undefined` — nothing is guessed
 * from the file name.
 */

export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

export type Parsed3dsFormat = 'cia' | '3dsx' | 'nds' | 'save' | 'firm' | 'other';

export interface Parsed3dsFileMetadata {
  fileName: string;
  sizeBytes: number;
  format: Parsed3dsFormat;
  /** true when the expected magic/header structure was found in the file */
  isAuthenticBinaryHeader: boolean;
  titleId?: string;
  titleTypeLabel?: string;
  productCode?: string;
  appTitle?: string;
  publisher?: string;
  encryptionStatus?: 'Decrypted (NoCrypto)' | 'Encrypted (AES-CTR)' | 'Unknown' | 'N/A';
  /** Real icon decoded from SMDH (48x48) or NDS banner (32x32) as a BMP data URL */
  iconDataUrl?: string;
  /** Deterministic placeholder icon used when the file has no embedded icon */
  fallbackIconDataUrl: string;
  summaryBadge: string;
  warnings: string[];
}

const SMDH_SIZE = 0x36c0;

export function align64(n: number): number {
  return Math.ceil(n / 64) * 64;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(bytes.length, offset + length);
  let out = '';
  for (let i = offset; i < end; i++) {
    const c = bytes[i];
    if (c === 0) break;
    if (c >= 32 && c <= 126) out += String.fromCharCode(c);
  }
  return out.trim();
}

function readUtf16Le(bytes: Uint8Array, offset: number, maxBytes: number): string {
  const end = Math.min(bytes.length - 1, offset + maxBytes);
  let out = '';
  for (let i = offset; i < end; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code === 0) break;
    out += code === 0x0a || code === 0x0d ? ' ' : code >= 0x20 ? String.fromCharCode(code) : '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function hexBigEndian(bytes: Uint8Array, offset: number, length: number): string {
  let hex = '';
  for (let i = 0; i < length; i++) hex += (bytes[offset + i] ?? 0).toString(16).toUpperCase().padStart(2, '0');
  return hex;
}

function hexLittleEndianU64(bytes: Uint8Array, offset: number): string {
  let hex = '';
  for (let i = 7; i >= 0; i--) hex += (bytes[offset + i] ?? 0).toString(16).toUpperCase().padStart(2, '0');
  return hex;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Encodes an RGBA buffer into a 24-bit BMP data URL (works without DOM canvas). */
export function encodeRgbaToBmpDataUrl(width: number, height: number, rgba: Uint8Array): string {
  const rowStride = (width * 3 + 3) & ~3;
  const pixelArraySize = rowStride * height;
  const fileSize = 54 + pixelArraySize;
  const bmp = new Uint8Array(fileSize);
  const view = new DataView(bmp.buffer);
  bmp[0] = 0x42;
  bmp[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true); // top-down
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelArraySize, true);
  for (let y = 0; y < height; y++) {
    const rowStart = 54 + y * rowStride;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = rowStart + x * 3;
      bmp[d] = rgba[s + 2];
      bmp[d + 1] = rgba[s + 1];
      bmp[d + 2] = rgba[s];
    }
  }
  return `data:image/bmp;base64,${uint8ToBase64(bmp)}`;
}

/** Morton (Z-order) index of a pixel inside an 8x8 3DS GPU tile. */
export function mortonIndex8x8(x: number, y: number): number {
  return (
    (x & 1) | ((y & 1) << 1) | ((x & 2) << 1) | ((y & 2) << 2) | ((x & 4) << 2) | ((y & 4) << 3)
  );
}

/**
 * Decodes an SMDH block (magic "SMDH", 0x36C0 bytes): English (fallback Japanese) title,
 * publisher and the 48x48 tiled RGB565 icon.
 */
export function parseSmdhBlock(smdh: Uint8Array): {
  title: string;
  description: string;
  publisher: string;
  iconDataUrl?: string;
} | null {
  if (smdh.length < 0x2008 || readAscii(smdh, 0, 4) !== 'SMDH') return null;

  const readTitle = (index: number) => {
    const base = 0x08 + index * 0x200;
    return {
      short: readUtf16Le(smdh, base, 0x80),
      long: readUtf16Le(smdh, base + 0x80, 0x100),
      publisher: readUtf16Le(smdh, base + 0x180, 0x80),
    };
  };
  let t = readTitle(1); // English
  if (!t.short) t = readTitle(0); // Japanese

  let iconDataUrl: string | undefined;
  if (smdh.length >= SMDH_SIZE) {
    const view = dataView(smdh);
    const rgba = new Uint8Array(48 * 48 * 4);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const tileIndex = (y >> 3) * 6 + (x >> 3);
        const pixelIndex = tileIndex * 64 + mortonIndex8x8(x & 7, y & 7);
        const rgb565 = view.getUint16(0x24c0 + pixelIndex * 2, true);
        const r5 = (rgb565 >>> 11) & 0x1f;
        const g6 = (rgb565 >>> 5) & 0x3f;
        const b5 = rgb565 & 0x1f;
        const d = (y * 48 + x) * 4;
        rgba[d] = (r5 << 3) | (r5 >>> 2);
        rgba[d + 1] = (g6 << 2) | (g6 >>> 4);
        rgba[d + 2] = (b5 << 3) | (b5 >>> 2);
        rgba[d + 3] = 255;
      }
    }
    iconDataUrl = encodeRgbaToBmpDataUrl(48, 48, rgba);
  }

  return { title: t.short, description: t.long, publisher: t.publisher, iconDataUrl };
}

export function classify3dsTitleId(titleIdHex: string): string {
  const upper = titleIdHex.toUpperCase();
  if (upper.startsWith('00040000')) return 'Base Game / App (00040000)';
  if (upper.startsWith('0004000E')) return 'Update Patch (0004000E)';
  if (upper.startsWith('0004008C')) return 'DLC (0004008C)';
  if (upper.startsWith('00040001')) return 'Download Play Child (00040001)';
  if (upper.startsWith('00040002')) return 'Demo (00040002)';
  if (upper.startsWith('00048004')) return 'DSiWare (00048004)';
  if (upper.startsWith('00040010') || upper.startsWith('00040030')) return 'System Application / Applet';
  if (upper.startsWith('0004001B') || upper.startsWith('0004009B') || upper.startsWith('000400DB')) return 'System Data Archive';
  if (upper.startsWith('00040130')) return 'System Module';
  return '3DS Title';
}

/** Deterministic 32x32 placeholder icon (clearly a placeholder, not game art). */
export function generateFallbackBadgeIcon(seedText: string, format: Parsed3dsFormat | 'archive'): string {
  const size = 32;
  const rgba = new Uint8Array(size * size * 4);
  const palettes: Record<string, { bg: number[]; accent: number[]; fg: number[] }> = {
    cia: { bg: [15, 23, 42], accent: [225, 29, 72], fg: [248, 250, 252] },
    '3dsx': { bg: [15, 23, 42], accent: [245, 158, 11], fg: [254, 243, 199] },
    nds: { bg: [30, 41, 59], accent: [14, 165, 233], fg: [224, 242, 254] },
    save: { bg: [6, 78, 59], accent: [16, 185, 129], fg: [209, 250, 229] },
    firm: { bg: [49, 46, 129], accent: [129, 140, 248], fg: [224, 231, 255] },
    other: { bg: [51, 65, 85], accent: [148, 163, 184], fg: [241, 245, 249] },
  };
  const pal = palettes[format] || palettes.other;
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const isBorder = x < 2 || x >= size - 2 || y < 2 || y >= size - 2;
      const isTopStripe = y >= 2 && y < 8;
      let isEmblem = false;
      if (x >= 8 && x < 23 && y >= 11 && y < 26) {
        const gx = Math.floor((x - 8) / 3);
        const gy = Math.floor((y - 11) / 3);
        const mirrorX = gx <= 2 ? gx : 4 - gx;
        isEmblem = ((hash >>> (gy * 3 + mirrorX)) & 1) === 1;
      }
      const c = isBorder || isTopStripe ? pal.accent : isEmblem ? pal.fg : pal.bg;
      rgba[idx] = c[0];
      rgba[idx + 1] = c[1];
      rgba[idx + 2] = c[2];
      rgba[idx + 3] = 255;
    }
  }
  return encodeRgbaToBmpDataUrl(size, size, rgba);
}

/** Size of signature + padding before the body of a Ticket/TMD, per signature type. */
function signatureBlockSize(sigType: number): number | null {
  switch (sigType) {
    case 0x010000:
    case 0x010003:
      return 4 + 0x200 + 0x3c; // RSA-4096
    case 0x010001:
    case 0x010004:
      return 4 + 0x100 + 0x3c; // RSA-2048
    case 0x010002:
    case 0x010005:
      return 4 + 0x3c + 0x40; // ECDSA
    default:
      return null;
  }
}

export function formatFromFileName(fileName: string): Parsed3dsFormat {
  const lower = fileName.trim().toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
  if (ext === '.cia') return 'cia';
  if (ext === '.3dsx') return '3dsx';
  if (ext === '.nds' || ext === '.dsi' || ext === '.srl') return 'nds';
  if (ext === '.sav' || ext === '.dat' || ext === '.bin') return 'save';
  if (ext === '.firm') return 'firm';
  return 'other';
}

async function safeRead(read: ByteReader, size: number, offset: number, length: number): Promise<Uint8Array> {
  if (offset < 0 || offset >= size || length <= 0) return new Uint8Array(0);
  return read(offset, Math.min(length, size - offset));
}

async function inspectCia(fileName: string, size: number, read: ByteReader, out: Parsed3dsFileMetadata) {
  const header = await safeRead(read, size, 0, 0x20);
  if (header.length < 0x20) {
    out.warnings.push('ไฟล์สั้นเกินกว่าจะเป็น CIA');
    return;
  }
  const hv = dataView(header);
  const headerSize = hv.getUint32(0x00, true);
  const certSize = hv.getUint32(0x08, true);
  const ticketSize = hv.getUint32(0x0c, true);
  const tmdSize = hv.getUint32(0x10, true);
  const metaSize = hv.getUint32(0x14, true);
  const contentSize = Number(hv.getBigUint64(0x18, true));

  if (headerSize !== 0x2020 || ticketSize === 0 || tmdSize === 0) {
    out.warnings.push('ไม่พบ CIA header มาตรฐาน (header size ควรเป็น 0x2020)');
    return;
  }

  const ticketOffset = align64(headerSize) + align64(certSize);
  const tmdOffset = ticketOffset + align64(ticketSize);
  const contentOffset = tmdOffset + align64(tmdSize);
  const metaOffset = contentOffset + align64(contentSize);

  if (contentOffset > size) {
    out.warnings.push('ขนาดไฟล์ไม่ตรงกับ CIA header (ไฟล์อาจไม่สมบูรณ์)');
    return;
  }
  out.isAuthenticBinaryHeader = true;

  // Title ID from TMD (body offset +0x4C) — falls back to Ticket (body offset +0x9C)
  const tmdHead = await safeRead(read, size, tmdOffset, 0x300);
  if (tmdHead.length >= 4) {
    const sigBlock = signatureBlockSize(dataView(tmdHead).getUint32(0, false));
    if (sigBlock !== null && tmdHead.length >= sigBlock + 0x54) {
      out.titleId = hexBigEndian(tmdHead, sigBlock + 0x4c, 8);
    }
  }
  if (!out.titleId) {
    const tik = await safeRead(read, size, ticketOffset, 0x300);
    if (tik.length >= 4) {
      const sigBlock = signatureBlockSize(dataView(tik).getUint32(0, false));
      if (sigBlock !== null && tik.length >= sigBlock + 0xa4) out.titleId = hexBigEndian(tik, sigBlock + 0x9c, 8);
    }
  }

  // First content NCCH header
  const ncch = await safeRead(read, size, contentOffset, 0x200);
  if (ncch.length >= 0x190 && readAscii(ncch, 0x100, 4) === 'NCCH') {
    const prod = readAscii(ncch, 0x150, 16);
    if (prod) out.productCode = prod;
    if (!out.titleId) out.titleId = hexLittleEndianU64(ncch, 0x118);
    out.encryptionStatus = (ncch[0x18f] & 0x04) !== 0 ? 'Decrypted (NoCrypto)' : 'Encrypted (AES-CTR)';
  } else if (contentSize > 0) {
    out.encryptionStatus = 'Unknown';
    out.warnings.push('อ่าน NCCH header ของ content แรกไม่ได้ (content อาจถูกเข้ารหัสแบบ CDN/title key)');
  }

  // Meta region: SMDH lives at meta + 0x400
  if (metaSize >= 0x400 + SMDH_SIZE) {
    const smdh = parseSmdhBlock(await safeRead(read, size, metaOffset + 0x400, SMDH_SIZE));
    if (smdh) {
      if (smdh.title) out.appTitle = smdh.title;
      if (smdh.publisher) out.publisher = smdh.publisher;
      out.iconDataUrl = smdh.iconDataUrl;
    }
  }

  if (out.titleId) out.titleTypeLabel = classify3dsTitleId(out.titleId);
  void fileName;
}

async function inspect3dsx(size: number, read: ByteReader, out: Parsed3dsFileMetadata) {
  const header = await safeRead(read, size, 0, 0x2c);
  if (header.length < 0x20 || readAscii(header, 0, 4) !== '3DSX') {
    out.warnings.push('ไม่พบ magic "3DSX"');
    return;
  }
  out.isAuthenticBinaryHeader = true;
  out.titleTypeLabel = 'Homebrew (.3DSX)';
  out.encryptionStatus = 'N/A';

  const hv = dataView(header);
  const headerSize = hv.getUint16(4, true);
  // Extended header (headerSize >= 0x2C) carries SMDH offset/size at 0x20/0x24
  if (headerSize >= 0x2c && header.length >= 0x2c) {
    const smdhOffset = hv.getUint32(0x20, true);
    const smdhSize = hv.getUint32(0x24, true);
    if (smdhOffset > 0 && smdhSize >= 0x2008 && smdhOffset + smdhSize <= size) {
      const smdh = parseSmdhBlock(await safeRead(read, size, smdhOffset, Math.min(smdhSize, SMDH_SIZE)));
      if (smdh) {
        if (smdh.title) out.appTitle = smdh.title;
        if (smdh.publisher) out.publisher = smdh.publisher;
        out.iconDataUrl = smdh.iconDataUrl;
      }
    }
  } else {
    out.warnings.push('3DSX นี้ไม่มี extended header จึงไม่มีไอคอน/ชื่อแอป (SMDH) ฝังอยู่');
  }
}

async function inspectNds(size: number, read: ByteReader, out: Parsed3dsFileMetadata) {
  const header = await safeRead(read, size, 0, 0x200);
  if (header.length < 0x6c) {
    out.warnings.push('ไฟล์สั้นเกินกว่าจะเป็น NDS ROM');
    return;
  }
  const rawTitle = readAscii(header, 0x00, 12);
  const rawCode = readAscii(header, 0x0c, 4);
  if (!/^[A-Z0-9]{4}$/.test(rawCode)) {
    out.warnings.push('Game code ใน NDS header ไม่ถูกต้อง');
    return;
  }
  out.isAuthenticBinaryHeader = true;
  const isDsi = (header[0x12] & 0x02) !== 0;
  out.productCode = `${isDsi ? 'TWL' : 'NTR'}-${rawCode}`;
  out.appTitle = rawTitle || undefined;
  out.titleTypeLabel = isDsi ? 'DSi Enhanced/Exclusive (TWL)' : 'Nintendo DS (NTR)';
  out.encryptionStatus = 'N/A';

  const bannerOffset = dataView(header).getUint32(0x68, true);
  if (bannerOffset === 0 || bannerOffset + 0x840 > size) return;
  const banner = await safeRead(read, size, bannerOffset, 0x840);
  if (banner.length < 0x440) return;
  const bv = dataView(banner);

  const palette: number[][] = [];
  for (let c = 0; c < 16; c++) {
    const bgr555 = bv.getUint16(0x220 + c * 2, true);
    const r5 = bgr555 & 0x1f;
    const g5 = (bgr555 >>> 5) & 0x1f;
    const b5 = (bgr555 >>> 10) & 0x1f;
    palette.push([(r5 << 3) | (r5 >>> 2), (g5 << 3) | (g5 >>> 2), (b5 << 3) | (b5 >>> 2)]);
  }
  palette[0] = [15, 23, 42]; // color 0 is transparent -> dark background

  const rgba = new Uint8Array(32 * 32 * 4);
  for (let tileIdx = 0; tileIdx < 16; tileIdx++) {
    const tx = tileIdx % 4;
    const ty = Math.floor(tileIdx / 4);
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const byte = banner[0x20 + tileIdx * 32 + py * 4 + (px >> 1)];
        const ci = px & 1 ? byte >>> 4 : byte & 0x0f;
        const d = ((ty * 8 + py) * 32 + tx * 8 + px) * 4;
        rgba[d] = palette[ci][0];
        rgba[d + 1] = palette[ci][1];
        rgba[d + 2] = palette[ci][2];
        rgba[d + 3] = 255;
      }
    }
  }
  out.iconDataUrl = encodeRgbaToBmpDataUrl(32, 32, rgba);

  const englishTitle = readUtf16Le(banner, 0x340, 0x100);
  if (englishTitle) out.appTitle = englishTitle;
}

/** Inspects a 3DS/DS file using random-access reads. */
export async function inspect3dsFile(
  fileName: string,
  sizeBytes: number,
  read: ByteReader
): Promise<Parsed3dsFileMetadata> {
  const format = formatFromFileName(fileName);
  const out: Parsed3dsFileMetadata = {
    fileName,
    sizeBytes,
    format,
    isAuthenticBinaryHeader: false,
    fallbackIconDataUrl: generateFallbackBadgeIcon(fileName, format),
    summaryBadge: '',
    warnings: [],
  };

  try {
    if (format === 'cia') await inspectCia(fileName, sizeBytes, read, out);
    else if (format === '3dsx') await inspect3dsx(sizeBytes, read, out);
    else if (format === 'nds') await inspectNds(sizeBytes, read, out);
    else if (format === 'save') {
      out.titleTypeLabel = 'Save data';
      out.encryptionStatus = 'N/A';
    } else if (format === 'firm') {
      const head = await safeRead(read, sizeBytes, 0, 4);
      out.isAuthenticBinaryHeader = readAscii(head, 0, 4) === 'FIRM';
      out.titleTypeLabel = 'FIRM payload';
      out.encryptionStatus = 'N/A';
    }
  } catch (err) {
    out.warnings.push(`อ่านไฟล์ไม่สำเร็จ: ${(err as Error).message}`);
  }

  out.summaryBadge = [out.productCode, out.titleTypeLabel].filter(Boolean).join(' · ') || format.toUpperCase();
  return out;
}

export function bufferReader(buf: Uint8Array): ByteReader {
  return async (offset, length) => buf.subarray(offset, Math.min(buf.length, offset + length));
}

function writeUtf16(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint16(offset + i * 2, text.charCodeAt(i), true);
}

/** Builds a structurally valid .CIA buffer with Ticket, TMD, NCCH, and SMDH (for tests and companion downloads). */
export function buildSyntheticCiaBinaryBuffer(params: {
  titleId: string;
  productCode: string;
  appTitle: string;
  publisher: string;
  contentSize?: number;
  noCrypto?: boolean;
}): Uint8Array {
  const headerSize = 0x2020;
  const certSize = 0x0a00;
  const ticketSize = 0x0350;
  const tmdSize = 0x0b34;
  const contentSize = params.contentSize ?? 0x2000;
  const metaSize = 0x3ac0;

  const certOffset = align64(headerSize);
  const ticketOffset = certOffset + align64(certSize);
  const tmdOffset = ticketOffset + align64(ticketSize);
  const contentOffset = tmdOffset + align64(tmdSize);
  const metaOffset = contentOffset + align64(contentSize);
  const totalSize = metaOffset + metaSize;

  const buf = new Uint8Array(totalSize);
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

  const smdh = new Uint8Array(0x36c0);
  const smdhView = new DataView(smdh.buffer);
  smdh.set(new TextEncoder().encode('SMDH'), 0);
  const eng = 0x08 + 0x200;
  writeUtf16(smdhView, eng, params.appTitle);
  writeUtf16(smdhView, eng + 0x80, `${params.appTitle} long description`);
  writeUtf16(smdhView, eng + 0x180, params.publisher);
  for (let i = 0; i < 48 * 48; i++) smdhView.setUint16(0x24c0 + i * 2, 0x001f, true);
  smdhView.setUint16(0x24c0 + mortonIndex8x8(0, 0) * 2, 0xf800, true);

  buf.set(smdh, metaOffset + 0x400);
  return buf;
}

/** Synchronous slice-based parser extracting metadata from available head and tail buffers. */
export function parse3dsBinarySlices(
  fileName: string,
  totalSizeBytes: number,
  headBytes: Uint8Array,
  tailBytes?: Uint8Array
): Parsed3dsFileMetadata {
  const format = formatFromFileName(fileName);
  const out: Parsed3dsFileMetadata = {
    fileName,
    sizeBytes: totalSizeBytes,
    format,
    isAuthenticBinaryHeader: false,
    fallbackIconDataUrl: generateFallbackBadgeIcon(fileName, format),
    summaryBadge: '',
    warnings: [],
  };

  const readSync = (offset: number, length: number): Uint8Array => {
    if (offset < 0 || offset >= totalSizeBytes || length <= 0) return new Uint8Array(0);
    const actualLen = Math.min(length, totalSizeBytes - offset);
    if (offset + actualLen <= headBytes.length) {
      return headBytes.subarray(offset, offset + actualLen);
    }
    if (tailBytes && tailBytes.length > 0) {
      const tailStart = totalSizeBytes - tailBytes.length;
      if (offset >= tailStart && offset + actualLen <= totalSizeBytes) {
        const rel = offset - tailStart;
        return tailBytes.subarray(rel, rel + actualLen);
      }
    }
    return new Uint8Array(0);
  };

  try {
    if (format === 'cia') {
      const header = readSync(0, 0x20);
      if (header.length >= 0x20) {
        const hv = dataView(header);
        const headerSize = hv.getUint32(0x00, true);
        const certSize = hv.getUint32(0x08, true);
        const ticketSize = hv.getUint32(0x0c, true);
        const tmdSize = hv.getUint32(0x10, true);
        const metaSize = hv.getUint32(0x14, true);
        const contentSize = Number(hv.getBigUint64(0x18, true));

        if (headerSize === 0x2020 && ticketSize > 0 && tmdSize > 0) {
          out.isAuthenticBinaryHeader = true;
          const ticketOffset = align64(headerSize) + align64(certSize);
          const tmdOffset = ticketOffset + align64(ticketSize);
          const contentOffset = tmdOffset + align64(tmdSize);
          const metaOffset = contentOffset + align64(contentSize);

          const tmdHead = readSync(tmdOffset, 0x300);
          if (tmdHead.length >= 4) {
            const sigBlock = signatureBlockSize(dataView(tmdHead).getUint32(0, false));
            if (sigBlock !== null && tmdHead.length >= sigBlock + 0x54) {
              out.titleId = hexBigEndian(tmdHead, sigBlock + 0x4c, 8);
            }
          }
          if (!out.titleId) {
            const tik = readSync(ticketOffset, 0x300);
            if (tik.length >= 4) {
              const sigBlock = signatureBlockSize(dataView(tik).getUint32(0, false));
              if (sigBlock !== null && tik.length >= sigBlock + 0xa4) {
                out.titleId = hexBigEndian(tik, sigBlock + 0x9c, 8);
              }
            }
          }

          const ncch = readSync(contentOffset, 0x200);
          if (ncch.length >= 0x190 && readAscii(ncch, 0x100, 4) === 'NCCH') {
            const prod = readAscii(ncch, 0x150, 16);
            if (prod) out.productCode = prod;
            if (!out.titleId) out.titleId = hexLittleEndianU64(ncch, 0x118);
            out.encryptionStatus = (ncch[0x18f] & 0x04) !== 0 ? 'Decrypted (NoCrypto)' : 'Encrypted (AES-CTR)';
          }

          if (metaSize >= 0x400 + SMDH_SIZE) {
            const smdhBytes = readSync(metaOffset + 0x400, SMDH_SIZE);
            if (smdhBytes.length === SMDH_SIZE) {
              const smdh = parseSmdhBlock(smdhBytes);
              if (smdh) {
                if (smdh.title) out.appTitle = smdh.title;
                if (smdh.publisher) out.publisher = smdh.publisher;
                out.iconDataUrl = smdh.iconDataUrl;
              }
            }
          }
          if (out.titleId) out.titleTypeLabel = classify3dsTitleId(out.titleId);
        }
      }
    } else if (format === '3dsx') {
      const header = readSync(0, 0x2c);
      if (header.length >= 0x20 && readAscii(header, 0, 4) === '3DSX') {
        out.isAuthenticBinaryHeader = true;
        out.titleTypeLabel = 'Homebrew (.3DSX)';
        out.encryptionStatus = 'N/A';
        const hv = dataView(header);
        const headerSize = hv.getUint16(4, true);
        if (headerSize >= 0x2c && header.length >= 0x2c) {
          const smdhOffset = hv.getUint32(0x20, true);
          const smdhSize = hv.getUint32(0x24, true);
          if (smdhOffset > 0 && smdhSize >= 0x2008) {
            const smdhBytes = readSync(smdhOffset, Math.min(smdhSize, SMDH_SIZE));
            if (smdhBytes.length >= SMDH_SIZE) {
              const smdh = parseSmdhBlock(smdhBytes);
              if (smdh) {
                if (smdh.title) out.appTitle = smdh.title;
                if (smdh.publisher) out.publisher = smdh.publisher;
                out.iconDataUrl = smdh.iconDataUrl;
              }
            }
          }
        }
      }
    } else if (format === 'nds') {
      const header = readSync(0, 0x200);
      if (header.length >= 0x6c) {
        const rawTitle = readAscii(header, 0x00, 12);
        const rawCode = readAscii(header, 0x0c, 4);
        if (/^[A-Z0-9]{4}$/.test(rawCode)) {
          out.isAuthenticBinaryHeader = true;
          const isDsi = (header[0x12] & 0x02) !== 0;
          out.productCode = `${isDsi ? 'TWL' : 'NTR'}-${rawCode}`;
          out.appTitle = rawTitle || undefined;
          out.titleTypeLabel = isDsi ? 'DSi Enhanced/Exclusive (TWL)' : 'Nintendo DS (NTR)';
          out.encryptionStatus = 'N/A';
        }
      }
    }
  } catch {
    // Ignore slice read errors
  }

  out.summaryBadge = [out.productCode, out.titleTypeLabel].filter(Boolean).join(' · ') || format.toUpperCase();
  return out;
}

/** Browser helper: inspect a File via File.slice() without reading it fully. */
export function inspectBrowserGameFile(file: File): Promise<Parsed3dsFileMetadata> {
  return inspect3dsFile(file.name, file.size, async (offset, length) =>
    new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
  );
}
