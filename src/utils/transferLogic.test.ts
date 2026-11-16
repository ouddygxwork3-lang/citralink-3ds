import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectGameFileFormat,
  validateConnectionInput,
  validateSaveSnapshotInput,
  formatBytes,
  calculateStorageSummary,
  buildFbiBoopPayload,
  generateQrMatrix,
  parseConsoleBatteryResponse,
  validateCompanionConfig,
  generateLibctruCompanionCode,
  generateCompanionMakefile,
  generateCompanionRsf,
} from './transferLogic';
import { encodeIsoQrCodeMatrix } from './qrCodeEncoder';
import { buildZipArchive, computeCrc32 } from './zipBuilder';
import {
  parse3dsBinarySlices,
  buildSyntheticCiaBinaryBuffer,
} from './binary3dsParser';

test('detectGameFileFormat routes .cia, .3dsx, .nds, and .sav to correct 3DS SD folders', () => {
  const cia = detectGameFileFormat('Mario_Kart_7_Update.CIA');
  assert.equal(cia.category, 'cia');
  assert.equal(cia.targetDirectory, '/cias');

  const homebrew = detectGameFileFormat('Checkpoint.3dsx');
  assert.equal(homebrew.category, '3dsx');
  assert.equal(homebrew.targetDirectory, '/3ds');

  const nds = detectGameFileFormat('Pokemon_HeartGold.nds');
  assert.equal(nds.category, 'nds');
  assert.equal(nds.targetDirectory, '/roms/nds');

  const save = detectGameFileFormat('garden_plus.dat');
  assert.equal(save.category, 'save');
  assert.equal(save.targetDirectory, '/3ds/Checkpoint/saves');
});

test('validateConnectionInput validates IPv4 and TCP port without silent fallbacks', () => {
  const validResult = validateConnectionInput('192.168.1.35', '5000');
  assert.equal(validResult.valid, true);
  assert.equal(validResult.normalizedIp, '192.168.1.35');
  assert.equal(validResult.normalizedPort, 5000);

  const emptyResult = validateConnectionInput('', '');
  assert.equal(emptyResult.valid, false);
  assert.ok(emptyResult.ipError);
  assert.ok(emptyResult.portError);

  const badOctet = validateConnectionInput('192.168.1.999', '5000');
  assert.equal(badOctet.valid, false);
  assert.ok(badOctet.ipError);

  const badPort = validateConnectionInput('192.168.1.35', '70000');
  assert.equal(badPort.valid, false);
  assert.ok(badPort.portError);
});

test('validateSaveSnapshotInput rejects empty or FAT32-unsafe characters and validates Title ID', () => {
  const ok = validateSaveSnapshotInput('2026-11-04 Elite Four Ready', '0004000000055D00');
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitizedSlotName, '2026-11-04_Elite_Four_Ready');

  const unsafeChars = validateSaveSnapshotInput('Save:Slot*1?', '0004000000055D00');
  assert.equal(unsafeChars.valid, false);
  assert.ok(unsafeChars.slotNameError);

  const badTitleId = validateSaveSnapshotInput('Valid_Slot', '12345');
  assert.equal(badTitleId.valid, false);
  assert.ok(badTitleId.titleIdError);
});

test('formatBytes and calculateStorageSummary compute accurate storage metrics', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024 * 1024 * 512), '512.00 MB');

  const summary = calculateStorageSummary(
    [
      {
        id: '1',
        name: 'Game.cia',
        path: '/cias',
        sizeBytes: 1024 * 1024 * 500,
        modifiedAt: '2026-11-04 10:00',
        category: 'cia',
      },
      {
        id: '2',
        name: 'ftpd.3dsx',
        path: '/3ds',
        sizeBytes: 1024 * 500,
        modifiedAt: '2026-11-04 10:00',
        category: '3dsx',
      },
    ],
    32 * 1024 * 1024 * 1024
  );

  assert.equal(summary.byCategory.ciaAndNdsBytes, 1024 * 1024 * 500);
  assert.equal(summary.byCategory.homebrewBytes, 1024 * 500);
  assert.ok(summary.freeBytes < summary.totalBytes);
  assert.ok(summary.usagePercent > 0 && summary.usagePercent < 100);
});

test('buildFbiBoopPayload creates 4-byte Big-Endian length header followed by URL bytes', () => {
  const url = 'http://192.168.1.10:3000/api/stream/game.cia';
  const payload = buildFbiBoopPayload([url]);
  assert.equal(payload.byteLength, 4 + url.length);
  const view = new DataView(payload.buffer);
  assert.equal(view.getUint32(0, false), url.length);
});

test('generateQrMatrix produces a 21x21 boolean grid with intact finder patterns', () => {
  const matrix = generateQrMatrix('http://192.168.1.10:3000/api/stream/test.cia');
  assert.equal(matrix.length, 21);
  assert.equal(matrix[0].length, 21);
  // Top-left finder corner and center must be dark (true)
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[3][3], true);
});

test('encodeIsoQrCodeMatrix encodes full stream URLs into Reed-Solomon ISO/IEC 18004 QR grids', () => {
  const encoded = encodeIsoQrCodeMatrix('http://192.168.1.35:3000/api/stream/CitraLink_Direct.cia');
  assert.ok(encoded.version >= 3 && encoded.version <= 6);
  assert.equal(encoded.matrix.length, encoded.size);
  assert.equal(encoded.matrix[0].length, encoded.size);
  assert.equal(encoded.matrix[0][0], true);
  assert.equal(encoded.matrix[3][3], true);
  assert.equal(encoded.matrix[0][encoded.size - 1], true);
  assert.equal(encoded.matrix[encoded.size - 1][0], true);
});

test('parse3dsBinarySlices extracts authentic Title ID, Product Code, and SMDH 48x48 icon from .CIA binary', () => {
  const ciaBuffer = buildSyntheticCiaBinaryBuffer({
    titleId: '000400000EC73D00',
    productCode: 'CTR-P-CLNK',
    appTitle: 'CitraLink Direct',
    publisher: 'CitraLink Team',
  });

  const parsed = parse3dsBinarySlices(
    'CitraLink_Direct.cia',
    ciaBuffer.byteLength,
    ciaBuffer,
    ciaBuffer
  );

  assert.equal(parsed.isAuthenticBinaryHeader, true);
  assert.equal(parsed.titleId, '000400000EC73D00');
  assert.equal(parsed.productCode, 'CTR-P-CLNK');
  assert.equal(parsed.appTitle, 'CitraLink Direct');
  assert.equal(parsed.publisher, 'CitraLink Team');
  assert.ok(parsed.iconDataUrl && parsed.iconDataUrl.startsWith('data:image/bmp;base64,'));
});

test('buildZipArchive produces a valid PKZIP archive with local headers and EOCD signature', () => {
  const zip = buildZipArchive([
    { path: '3ds/Checkpoint/saves/0004000000055D00/Slot1/main', data: 'SAVE_DATA_CONTENT' },
    { path: 'manifest.json', data: '{"ok":true}' },
  ]);
  const view = new DataView(zip.buffer);
  // PK\x03\x04 local file header signature
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // PK\x05\x06 End of Central Directory signature at the end
  assert.equal(view.getUint32(zip.byteLength - 22, true), 0x06054b50);
  assert.ok(computeCrc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
});

test('parseConsoleBatteryResponse extracts battery percentage when protocol supports telemetry and flags unsupported protocols', () => {
  const supported = parseConsoleBatteryResponse(
    '211-FTPD Rosalina Telemetry BATT:84% CHRG:1',
    'ftpd_rosalina'
  );
  assert.equal(supported.supported, true);
  assert.equal(supported.percentage, 84);
  assert.equal(supported.isCharging, true);
  assert.equal(supported.mcuBars, 4);
  assert.equal(supported.safeForLargeInstall, true);

  const lowBattery = parseConsoleBatteryResponse(
    '211-FTPD Rosalina Telemetry BATT:12% CHRG:0',
    'ftpd_rosalina'
  );
  assert.equal(lowBattery.supported, true);
  assert.equal(lowBattery.percentage, 12);
  assert.equal(lowBattery.isCharging, false);
  assert.equal(lowBattery.mcuBars, 1);
  assert.equal(lowBattery.safeForLargeInstall, false);

  const unsupportedFbi = parseConsoleBatteryResponse('', 'fbi_boop_only');
  assert.equal(unsupportedFbi.supported, false);
  assert.equal(unsupportedFbi.percentage, null);
  assert.ok(unsupportedFbi.reasonIfUnsupported);
});

test('validateCompanionConfig and companion generators validate 3DS Title ID and emit C, Makefile, and RSF', () => {
  const validCfg = {
    appTitle: 'CitraLink 3DS Direct',
    titleId: '000400000EC73D00',
    productCode: 'CTR-P-CLNK',
    defaultHostIp: '192.168.1.10',
    defaultPort: 5000,
    directAmInstall: true,
    directSaveArchive: true,
    keepAwakeClamshell: true,
  };
  const check = validateCompanionConfig(validCfg);
  assert.equal(check.valid, true);

  const code = generateLibctruCompanionCode(validCfg);
  assert.ok(code.includes('AM_StartCiaInstall'));
  assert.ok(code.includes('aptSetSleepAllowed(false)'));

  const makefile = generateCompanionMakefile(validCfg);
  assert.ok(makefile.includes('makerom -f cia'));

  const rsf = generateCompanionRsf(validCfg);
  assert.ok(rsf.includes('am:net'));
  assert.ok(rsf.includes('fs:USER'));

  const invalidCfg = {
    ...validCfg,
    titleId: '123456',
    productCode: 'BADCODE',
  };
  const badCheck = validateCompanionConfig(invalidCfg);
  assert.equal(badCheck.valid, false);
  assert.ok(badCheck.titleIdError);
  assert.ok(badCheck.productCodeError);
});
