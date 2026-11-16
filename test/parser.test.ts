import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect3dsFile, bufferReader, ByteReader } from '../src/utils/binary3dsParser.ts';
import { buildCia, build3dsx, buildNds, bmpPixel } from './fixtures.ts';

/** Reader that records the byte ranges requested, to prove we never read whole files. */
function trackingReader(buf: Uint8Array) {
  const inner = bufferReader(buf);
  let bytesRead = 0;
  const read: ByteReader = async (o, l) => {
    const r = await inner(o, l);
    bytesRead += r.length;
    return r;
  };
  return { read, get bytesRead() { return bytesRead; } };
}

test('CIA: reads Title ID (TMD), product code, NoCrypto flag and SMDH icon from meta beyond 64KB', async () => {
  const cia = buildCia({ titleId: '000400000EC73D00', productCode: 'CTR-P-CLNK', title: 'CitraLink', publisher: 'Team' });
  assert.ok(cia.length > 0x30000);
  const t = trackingReader(cia);
  const meta = await inspect3dsFile('x.cia', cia.length, t.read);

  assert.equal(meta.isAuthenticBinaryHeader, true);
  assert.equal(meta.titleId, '000400000EC73D00');
  assert.equal(meta.titleTypeLabel, 'Base Game / App (00040000)');
  assert.equal(meta.productCode, 'CTR-P-CLNK');
  assert.equal(meta.encryptionStatus, 'Decrypted (NoCrypto)');
  assert.equal(meta.appTitle, 'CitraLink');
  assert.equal(meta.publisher, 'Team');
  assert.ok(meta.iconDataUrl);
  assert.deepEqual(bmpPixel(meta.iconDataUrl!, 0, 0), [255, 0, 0]); // morton-swizzled pixel (0,0)
  assert.deepEqual(bmpPixel(meta.iconDataUrl!, 47, 47), [0, 0, 255]);
  assert.ok(t.bytesRead < 32 * 1024, `read ${t.bytesRead} bytes; must not read whole file`);
});

test('CIA: update title and encrypted content are classified', async () => {
  const cia = buildCia({ titleId: '0004000E00030800', productCode: 'CTR-U-AMKE', title: 'MK7', publisher: 'N', noCrypto: false });
  const meta = await inspect3dsFile('u.cia', cia.length, bufferReader(cia));
  assert.equal(meta.titleTypeLabel, 'Update Patch (0004000E)');
  assert.equal(meta.encryptionStatus, 'Encrypted (AES-CTR)');
});

test('CIA: garbage data yields no fabricated Title ID / product code', async () => {
  const junk = new Uint8Array(4096).fill(7);
  const meta = await inspect3dsFile('Some_Game_USA.cia', junk.length, bufferReader(junk));
  assert.equal(meta.isAuthenticBinaryHeader, false);
  assert.equal(meta.titleId, undefined);
  assert.equal(meta.productCode, undefined);
  assert.equal(meta.iconDataUrl, undefined);
  assert.ok(meta.fallbackIconDataUrl.startsWith('data:image/bmp;base64,'));
  assert.ok(meta.warnings.length > 0);
});

test('3DSX: reads SMDH via extended header offsets 0x20/0x24 even when SMDH is past 64KB', async () => {
  const f = build3dsx('FTPD Pro', 'mtheall');
  const meta = await inspect3dsFile('ftpd.3dsx', f.length, bufferReader(f));
  assert.equal(meta.isAuthenticBinaryHeader, true);
  assert.equal(meta.appTitle, 'FTPD Pro');
  assert.equal(meta.publisher, 'mtheall');
  assert.deepEqual(bmpPixel(meta.iconDataUrl!, 10, 10), [0, 255, 0]);
});

test('NDS: reads game code and decodes 32x32 banner icon + English title at banner offset', async () => {
  const f = buildNds('POKEMON HG', 'IPKE', 'Pokemon HeartGold');
  const meta = await inspect3dsFile('hg.nds', f.length, bufferReader(f));
  assert.equal(meta.isAuthenticBinaryHeader, true);
  assert.equal(meta.productCode, 'NTR-IPKE');
  assert.equal(meta.appTitle, 'Pokemon HeartGold');
  assert.deepEqual(bmpPixel(meta.iconDataUrl!, 5, 5), [0, 255, 0]);
});
