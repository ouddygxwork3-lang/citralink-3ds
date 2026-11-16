import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import http from 'http';
import { unzipSync } from 'fflate';
import { createApp } from '../server/app.ts';

function startTestServer(dataRoot: string): Promise<{
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const { app } = createApp({ dataRoot });
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test('Server: Path traversal attempts are rejected or sanitized', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citralink-test-traversal-'));
  const testApp = await startTestServer(tmpDir);

  try {
    const res = await fetch(`${testApp.baseUrl}/api/sd/list?path=../../../../etc`);
    const data = await res.json();
    // Must either return 500 error or empty list strictly bounded inside virtual-sd
    if (res.status === 200) {
      assert.deepEqual(data.files, []);
    } else {
      assert.equal(data.ok, false);
    }
  } finally {
    await testApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Server: /api/stream returns 404 for missing files and Range 206 for existing files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citralink-test-stream-'));
  const testApp = await startTestServer(tmpDir);

  try {
    // 1. Missing file -> 404 (NEVER dummy synthetic CIA)
    const missingRes = await fetch(`${testApp.baseUrl}/api/stream/nonexistent_game.cia`);
    assert.equal(missingRes.status, 404);

    // 2. Stage a real file
    const payload = Buffer.from('REAL_3DS_GAME_STREAM_CONTENT_1234567890_TEST_DATA');
    const stageRes = await fetch(`${testApp.baseUrl}/api/staging/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'real_test.cia',
        base64Data: payload.toString('base64'),
        targetDirectory: '/cias',
        mode: 'virtual',
      }),
    });
    const stageData = await stageRes.json();
    assert.equal(stageData.ok, true);
    assert.ok(stageData.jobId);
    assert.ok(stageData.shortStreamUrl);

    // 3. Full stream 200
    const fullRes = await fetch(`${testApp.baseUrl}/api/stream/real_test.cia`);
    assert.equal(fullRes.status, 200);
    const fullBytes = Buffer.from(await fullRes.arrayBuffer());
    assert.equal(fullBytes.toString('utf-8'), payload.toString('utf-8'));

    // 4. Range 206 stream
    const rangeRes = await fetch(`${testApp.baseUrl}/api/stream/real_test.cia`, {
      headers: { Range: 'bytes=5-15' },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-range'), `bytes 5-15/${payload.length}`);
    const rangeBytes = Buffer.from(await rangeRes.arrayBuffer());
    assert.equal(rangeBytes.toString('utf-8'), payload.subarray(5, 16).toString('utf-8'));

    // 5. Short stream URL
    const shortRes = await fetch(`${testApp.baseUrl}${stageData.shortStreamUrl}`);
    assert.equal(shortRes.status, 200);
    const shortBytes = Buffer.from(await shortRes.arrayBuffer());
    assert.equal(shortBytes.toString('utf-8'), payload.toString('utf-8'));
  } finally {
    await testApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Server: SD Explorer and Vault operations (mkdir, list, delete, backup, zip export, restore)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citralink-test-sd-vault-'));
  const testApp = await startTestServer(tmpDir);

  try {
    // 1. SD mkdir
    const mkRes = await fetch(`${testApp.baseUrl}/api/sd/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/roms/custom_rpg' }),
    });
    const mkData = await mkRes.json();
    assert.equal(mkData.ok, true);

    // 2. SD list
    const listRes = await fetch(`${testApp.baseUrl}/api/sd/list?path=/roms`);
    const listData = await listRes.json();
    assert.equal(listData.ok, true);
    assert.ok(listData.files.some((f: any) => f.name === 'custom_rpg' && f.isDirectory));

    // 3. SD delete
    const delRes = await fetch(`${testApp.baseUrl}/api/sd/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/roms/custom_rpg' }),
    });
    const delData = await delRes.json();
    assert.equal(delData.ok, true);

    // 4. Checkpoint detected titles
    const titlesRes = await fetch(`${testApp.baseUrl}/api/checkpoint/titles`);
    const titlesData = await titlesRes.json();
    assert.equal(titlesData.ok, true);
    assert.ok(titlesData.titles.some((t: any) => t.titleId === '0004000000055D00'));

    // 5. Vault backup
    const backupRes = await fetch(`${testApp.baseUrl}/api/vault/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titleId: '0004000000055D00',
        gameTitle: 'Pokemon X',
        slotName: 'Slot1',
        note: 'Before Gym 8',
        tags: ['เซฟหลัก', 'Pokemon'],
      }),
    });
    const backupData = await backupRes.json();
    assert.equal(backupData.ok, true);
    assert.equal(backupData.backup.titleId, '0004000000055D00');
    assert.ok(backupData.backup.checksum.startsWith('SHA-256 · '));

    // 6. Vault list
    const vaultListRes = await fetch(`${testApp.baseUrl}/api/vault/list`);
    const vaultListData = await vaultListRes.json();
    assert.equal(vaultListData.ok, true);
    assert.ok(vaultListData.backups.some((b: any) => b.titleId === '0004000000055D00'));

    // 7. Vault export ZIP verified by independent unzipper (fflate)
    const zipRes = await fetch(`${testApp.baseUrl}/api/vault/export-zip?titleId=0004000000055D00&slotName=Slot1`);
    assert.equal(zipRes.status, 200);
    const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
    const unzipped = unzipSync(zipBuf);
    assert.ok(Object.keys(unzipped).some((k) => k.includes('0004000000055D00/Slot1/main')));

    // 8. Vault restore
    const restoreRes = await fetch(`${testApp.baseUrl}/api/vault/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titleId: '0004000000055D00',
        slotName: 'Slot1',
      }),
    });
    const restoreData = await restoreRes.json();
    assert.equal(restoreData.ok, true);
  } finally {
    await testApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
