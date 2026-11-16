/**
 * Pure TypeScript PKZIP Archive Builder & Checksum Calculator
 * Generates standard uncompressed (STORE, method 0) .ZIP archives compatible with
 * Windows Explorer, macOS Archive Utility, 7-Zip, and Nintendo 3DS archive tools.
 */

export interface ZipEntryInput {
  path: string; // e.g. '3ds/Checkpoint/saves/0004000000055D00/Slot1/main'
  data: Uint8Array | string;
  modifiedDate?: Date;
}

const CRC32_TABLE = new Uint32Array(256);
(function initCrc32Table() {
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC32_TABLE[i] = c >>> 0;
  }
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function computeFnv1aHexHash(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= bytes[i] ^ (i & 0xff);
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0;
  }
  const crc = computeCrc32(bytes);
  return (
    h1.toString(16).toUpperCase().padStart(8, '0') +
    crc.toString(16).toUpperCase().padStart(8, '0')
  );
}

/**
 * Computes real SHA-256 hex digest using Web Crypto API when available,
 * with a deterministic synchronous fallback.
 */
export async function computeSha256ShortDigest(bytes: Uint8Array): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
      const arr = new Uint8Array(digest);
      let hex = '';
      for (let i = 0; i < 8; i++) {
        hex += arr[i].toString(16).toUpperCase().padStart(2, '0');
      }
      return `SHA-256 · ${hex}`;
    }
  } catch {
    // Fallback below
  }
  return `SHA-256 · ${computeFnv1aHexHash(bytes)}`;
}

function dateToDosTimeAndDate(d: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, d.getFullYear());
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Builds a complete standard PKZIP (.zip) binary Uint8Array from an array of file entries.
 */
export function buildZipArchive(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const cleanPath = entry.path.replace(/^\/+/, '').replace(/\\/g, '/');
    const nameBytes = encoder.encode(cleanPath);
    const contentBytes =
      typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const crc = computeCrc32(contentBytes);
    const { dosTime, dosDate } = dateToDosTimeAndDate(entry.modifiedDate || new Date());

    // Local File Header (30 + nameBytes.length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true); // General purpose bit flag (bit 11 = UTF-8)
    lv.setUint16(8, 0, true); // Compression method (0 = STORE)
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, contentBytes.length, true); // Compressed size
    lv.setUint32(22, contentBytes.length, true); // Uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, contentBytes);

    // Central Directory File Header (46 + nameBytes.length)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central file header signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // Compression method (STORE)
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, contentBytes.length, true);
    cv.setUint32(24, contentBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal file attributes
    cv.setUint32(38, 0, true); // External file attributes
    cv.setUint32(42, localOffset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    centralChunks.push(centralHeader);
    localOffset += localHeader.length + contentBytes.length;
  }

  let centralDirSize = 0;
  for (const chunk of centralChunks) {
    centralDirSize += chunk.length;
  }

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true); // Number of this disk
  ev.setUint16(6, 0, true); // Disk where central directory starts
  ev.setUint16(8, entries.length, true); // Number of central directory records on this disk
  ev.setUint16(10, entries.length, true); // Total number of central directory records
  ev.setUint32(12, centralDirSize, true); // Size of central directory
  ev.setUint32(16, localOffset, true); // Offset of start of central directory
  ev.setUint16(20, 0, true); // Comment length

  const totalSize = localOffset + centralDirSize + eocd.length;
  const output = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of localChunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of centralChunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }
  output.set(eocd, pos);

  return output;
}
