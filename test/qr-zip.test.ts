import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { unzipSync, strFromU8 } from 'fflate';
import { encodeIsoQrCodeMatrix, QrDataTooLongError } from '../src/utils/qrCodeEncoder.ts';
import { buildZipArchive, computeCrc32 } from '../src/utils/zipBuilder.ts';

function decodeMatrix(matrix: boolean[][]): string | null {
  const scale = 4;
  const quiet = 4;
  const n = matrix.length;
  const dim = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const my = Math.floor(y / scale) - quiet;
      const mx = Math.floor(x / scale) - quiet;
      const v = my >= 0 && my < n && mx >= 0 && mx < n && matrix[my][mx] ? 0 : 255;
      const i = (y * dim + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return jsQR(data, dim, dim, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

test('QR encoder output is decodable by an independent decoder (jsQR) across versions', () => {
  const samples = [
    'A',
    'http://192.168.1.35:3000/api/s/0123456789',
    'http://192.168.1.35:3000/api/stream/CitraLink_Direct_CTR-P-CLNK.cia',
    'http://192.168.100.200:3000/api/stream/' + 'Pokemon_'.repeat(20) + '.cia',
    'http://10.0.0.5:3000/api/stream/' + encodeURIComponent('เกมภาษาไทย_ทดสอบ.cia'),
  ];
  const versions = new Set<number>();
  for (const s of samples) {
    const enc = encodeIsoQrCodeMatrix(s);
    versions.add(enc.version);
    assert.equal(enc.matrix.length, enc.size);
    assert.equal(decodeMatrix(enc.matrix), s, `failed for version ${enc.version}`);
  }
  assert.ok(versions.size >= 4, 'should exercise several versions incl. >= 7 (version info block)');
  assert.ok([...versions].some((v) => v >= 7));
});

test('QR encoder throws instead of silently truncating oversized data', () => {
  assert.throws(() => encodeIsoQrCodeMatrix('x'.repeat(3000)), QrDataTooLongError);
});

test('ZIP builder output is readable by an independent unzip implementation (fflate)', () => {
  const zip = buildZipArchive([
    { path: '3ds/Checkpoint/saves/0x0055D Pokemon X/slot1/main', data: new Uint8Array([1, 2, 3, 250]) },
    { path: 'manifest.json', data: '{"ok":true,"ไทย":"ทดสอบ"}' },
  ]);
  const files = unzipSync(zip);
  assert.deepEqual([...files['3ds/Checkpoint/saves/0x0055D Pokemon X/slot1/main']], [1, 2, 3, 250]);
  assert.equal(strFromU8(files['manifest.json']), '{"ok":true,"ไทย":"ทดสอบ"}');
  assert.equal(computeCrc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
