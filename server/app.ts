import express from 'express';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { resolveSafePath, sanitizeFileName, isPrivateOrLocalIp } from './pathUtils.ts';
import { FtpClient } from './ftpClient.ts';
import {
  SdBackend,
  VirtualSdBackend,
  HardwareFtpBackend,
  SDFileEntry,
} from './sdBackend.ts';
import { TransferManager } from './transferManager.ts';
import { VaultManager } from './vaultManager.ts';
import {
  parse3dsBinarySlices,
  buildSyntheticCiaBinaryBuffer,
} from '../src/utils/binary3dsParser.ts';
import {
  buildFbiBoopPayload,
  parseConsoleBatteryResponse,
  ConsoleProtocolType,
} from '../src/utils/transferLogic.ts';

export function detectHostLanIp(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push(iface.address);
      }
    }
  }

  const privateLan = candidates.find(
    (ip) =>
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
  return privateLan || candidates[0] || '127.0.0.1';
}

export interface AppOptions {
  dataRoot: string;
  port?: number;
}

export function createApp(options: AppOptions) {
  const DATA_ROOT = path.resolve(options.dataRoot);
  const STAGING_DIR = path.join(DATA_ROOT, 'staging');
  const LOCAL_ROMS_DIR = path.join(DATA_ROOT, 'local-roms');
  const VAULT_DIR = path.join(DATA_ROOT, 'vault');
  const VIRTUAL_SD_DIR = path.join(DATA_ROOT, 'virtual-sd');
  const PORT = options.port || 3000;

  // Ensure directories exist
  for (const dir of [
    DATA_ROOT,
    STAGING_DIR,
    LOCAL_ROMS_DIR,
    VAULT_DIR,
    VIRTUAL_SD_DIR,
    path.join(VIRTUAL_SD_DIR, 'cias'),
    path.join(VIRTUAL_SD_DIR, '3ds'),
    path.join(VIRTUAL_SD_DIR, '3ds', 'Checkpoint', 'saves'),
    path.join(VIRTUAL_SD_DIR, 'roms', 'nds'),
    path.join(VIRTUAL_SD_DIR, 'luma', 'payloads'),
  ]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Seed sample CIA in local-roms if empty
  const sampleCia = path.join(LOCAL_ROMS_DIR, 'CitraLink_Direct_CTR-P-CLNK.cia');
  if (!fs.existsSync(sampleCia)) {
    const bytes = buildSyntheticCiaBinaryBuffer({
      titleId: '000400000EC73D00',
      productCode: 'CTR-P-CLNK',
      appTitle: 'CitraLink 3DS Direct',
      publisher: 'CitraLink Project',
    });
    fs.writeFileSync(sampleCia, Buffer.from(bytes));
  }

  // Seed a sample save in virtual-sd Checkpoint folder
  const sampleSaveDir = path.join(VIRTUAL_SD_DIR, '3ds', 'Checkpoint', 'saves', '0004000000055D00', 'Slot1');
  if (!fs.existsSync(sampleSaveDir)) {
    fs.mkdirSync(sampleSaveDir, { recursive: true });
    fs.writeFileSync(path.join(sampleSaveDir, 'main'), Buffer.from('POKEMON_X_SAMPLE_SAVE_DATA_READY'));
  }

  const virtualSd = new VirtualSdBackend(VIRTUAL_SD_DIR);
  const transferManager = new TransferManager();
  const vaultManager = new VaultManager(VAULT_DIR);

  function getSdBackend(mode?: string, ip?: string, port?: number): SdBackend {
    if (mode === 'hardware' && ip) {
      return new HardwareFtpBackend(ip, port || 5000);
    }
    return virtualSd;
  }

  const app = express();
  app.use(express.json({ limit: '100mb' }));

  // Short ID mapping for compact QR codes
  const streamShortIdMap = new Map<string, string>();

  // 1. Bridge Info
  app.get('/api/bridge/info', (req, res) => {
    const lanIp = detectHostLanIp();
    const hostHeader = req.get('host') || `${lanIp}:${PORT}`;
    const portSuffix = hostHeader.includes(':') ? hostHeader.split(':')[1] : String(PORT);
    const lanHostUrl = process.env.APP_URL || `${req.protocol}://${lanIp}:${portSuffix}`;

    res.json({
      status: 'ready',
      lanIp,
      hostUrl: lanHostUrl,
      localRomsDir: LOCAL_ROMS_DIR,
      stagingDir: STAGING_DIR,
      virtualSdDir: VIRTUAL_SD_DIR,
      vaultDir: VAULT_DIR,
      protocols: [
        'RFC 959 FTP Client (Port 5000 / 21)',
        'FBI Remote Install TCP (Port 5000)',
        'HTTP CIA Byte-Range Stream (Port ' + PORT + ')',
      ],
    });
  });

  // 2. Local ROMs listing with binary header inspection
  app.get('/api/local-roms', (_req, res) => {
    try {
      const results: Array<{
        fileName: string;
        sizeBytes: number;
        sourceFolder: 'local-roms' | 'staging';
        modifiedAt: string;
        titleId?: string;
        productCode?: string;
        appTitle?: string;
        titleTypeLabel?: string;
        iconDataUrl?: string;
      }> = [];

      const scanFolder = (folderPath: string, label: 'local-roms' | 'staging') => {
        if (!fs.existsSync(folderPath)) return;
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (!/\.(cia|3dsx|nds|sav|dat|bin|firm|zip)$/i.test(entry.name)) continue;
          const fullPath = path.join(folderPath, entry.name);
          const stat = fs.statSync(fullPath);

          const fd = fs.openSync(fullPath, 'r');
          const headLen = Math.min(stat.size, 64 * 1024);
          const headBuf = Buffer.alloc(headLen);
          fs.readSync(fd, headBuf, 0, headLen, 0);

          let tailBuf: Uint8Array | undefined;
          if (stat.size > 64 * 1024) {
            const tailLen = Math.min(stat.size, 32 * 1024);
            const tBuf = Buffer.alloc(tailLen);
            fs.readSync(fd, tBuf, 0, tailLen, stat.size - tailLen);
            tailBuf = new Uint8Array(tBuf);
          }
          fs.closeSync(fd);

          const parsed = parse3dsBinarySlices(entry.name, stat.size, new Uint8Array(headBuf), tailBuf);
          results.push({
            fileName: entry.name,
            sizeBytes: stat.size,
            sourceFolder: label,
            modifiedAt: stat.mtime.toISOString().slice(0, 16).replace('T', ' '),
            titleId: parsed.titleId,
            productCode: parsed.productCode,
            appTitle: parsed.appTitle,
            titleTypeLabel: parsed.titleTypeLabel,
            iconDataUrl: parsed.iconDataUrl,
          });
        }
      };

      scanFolder(LOCAL_ROMS_DIR, 'local-roms');
      scanFolder(STAGING_DIR, 'staging');

      res.json({
        ok: true,
        localRomsDir: LOCAL_ROMS_DIR,
        files: results,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message: `ไม่สามารถอ่านโฟลเดอร์ไฟล์ได้: ${(err as Error).message}`,
        files: [],
      });
    }
  });

  // 3. SD Explorer: List Files
  app.get('/api/sd/list', async (req, res) => {
    const dirPath = (req.query.path as string) || '/';
    const mode = (req.query.mode as string) || 'virtual';
    const ip = req.query.ip as string;
    const port = Number(req.query.port) || 5000;

    try {
      const backend = getSdBackend(mode, ip, port);
      const files = await backend.listFiles(dirPath);
      res.json({ ok: true, path: dirPath, files });
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message, files: [] });
    }
  });

  // 4. SD Explorer: Usage
  app.get('/api/sd/usage', async (req, res) => {
    const mode = (req.query.mode as string) || 'virtual';
    const ip = req.query.ip as string;
    const port = Number(req.query.port) || 5000;

    try {
      const backend = getSdBackend(mode, ip, port);
      const usage = await backend.getUsage();
      res.json({ ok: true, usage });
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message });
    }
  });

  // 5. SD Explorer: Mkdir
  app.post('/api/sd/mkdir', async (req, res) => {
    const { path: dirPath, mode = 'virtual', ip, port = 5000 } = req.body;
    if (!dirPath) {
      res.status(400).json({ ok: false, message: 'กรุณาระบุที่อยู่โฟลเดอร์' });
      return;
    }
    try {
      const backend = getSdBackend(mode, ip, port);
      const result = await backend.createDirectory(dirPath);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message });
    }
  });

  // 6. SD Explorer: Delete
  app.post('/api/sd/delete', async (req, res) => {
    const { path: targetPath, mode = 'virtual', ip, port = 5000 } = req.body;
    if (!targetPath) {
      res.status(400).json({ ok: false, message: 'กรุณาระบุไฟล์ที่ต้องการลบ' });
      return;
    }
    try {
      const backend = getSdBackend(mode, ip, port);
      const result = await backend.deleteFile(targetPath);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message });
    }
  });

  // 7. SD Explorer: Download File
  app.get('/api/sd/download', async (req, res) => {
    const filePath = req.query.path as string;
    const mode = (req.query.mode as string) || 'virtual';
    const ip = req.query.ip as string;
    const port = Number(req.query.port) || 5000;

    if (!filePath) {
      res.status(400).send('File path required');
      return;
    }

    try {
      const backend = getSdBackend(mode, ip, port);
      const buf = await backend.downloadFile(filePath);
      const safeName = path.basename(filePath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.send(buf);
    } catch (err) {
      res.status(404).send((err as Error).message);
    }
  });

  // 8. Staging & Transfer: Upload and Enqueue
  app.post('/api/staging/upload', async (req, res) => {
    const {
      fileName,
      base64Data,
      targetDirectory = '/cias',
      mode = 'virtual',
      ip = '192.168.1.35',
      port = 5000,
    } = req.body;

    if (!fileName) {
      res.status(400).json({ ok: false, message: 'กรุณาระบุชื่อไฟล์' });
      return;
    }

    const safeName = sanitizeFileName(fileName);
    const stagingPath = path.join(STAGING_DIR, safeName);

    let fileBuffer: Buffer | null = null;
    if (base64Data) {
      fileBuffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(stagingPath, fileBuffer);
    } else if (fs.existsSync(stagingPath)) {
      fileBuffer = fs.readFileSync(stagingPath);
    } else if (fs.existsSync(path.join(LOCAL_ROMS_DIR, safeName))) {
      fileBuffer = fs.readFileSync(path.join(LOCAL_ROMS_DIR, safeName));
      fs.writeFileSync(stagingPath, fileBuffer);
    } else {
      res.status(404).json({
        ok: false,
        message: `ไม่พบไฟล์ ${safeName} บนเซิร์ฟเวอร์ และไม่ได้ส่งข้อมูลไฟล์มาด้วย`,
      });
      return;
    }

    const sha256Hex = crypto
      .createHash('sha256')
      .update(fileBuffer)
      .digest('hex')
      .toUpperCase();

    // Register a short ID for fast QR code scanning
    const shortId = crypto.randomBytes(4).toString('hex');
    streamShortIdMap.set(shortId, safeName);

    const job = transferManager.createJob(safeName, fileBuffer.byteLength, targetDirectory);
    const backend = getSdBackend(mode, ip, port);

    // Run job in background
    transferManager.runJob(job.id, backend, fileBuffer).catch(() => {});

    res.json({
      ok: true,
      jobId: job.id,
      fileName: safeName,
      sizeBytes: fileBuffer.byteLength,
      checksum: `SHA256:${sha256Hex.slice(0, 12)}`,
      shortId,
      streamUrl: `/api/stream/${encodeURIComponent(safeName)}`,
      shortStreamUrl: `/api/s/${shortId}`,
      message: `นำไฟล์ ${safeName} เข้าสู่คิวส่งข้อมูล (${mode === 'hardware' ? '3DS FTP' : 'Virtual SD'})`,
    });
  });

  // 9. Transfer Jobs Polling
  app.get('/api/transfers', (_req, res) => {
    res.json({ ok: true, jobs: transferManager.listJobs() });
  });

  app.get('/api/transfers/:id', (req, res) => {
    const job = transferManager.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ ok: false, message: 'Transfer job not found' });
      return;
    }
    res.json({ ok: true, job });
  });

  // 10. HTTP Byte-Range Streaming (404 if missing, NO fake CIA!)
  const serveStreamFile = (filePath: string, fileName: string, req: express.Request, res: express.Response) => {
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ ok: false, message: `File not found: ${fileName}` });
      return;
    }

    const stat = fs.statSync(filePath);
    const totalSize = stat.size;
    const rangeHeader = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? Math.min(totalSize - 1, parseInt(match[2], 10)) : totalSize - 1;
        if (start >= 0 && start < totalSize && start <= end) {
          const chunkSize = end - start + 1;
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
          res.setHeader('Content-Length', String(chunkSize));
          fs.createReadStream(filePath, { start, end }).pipe(res);
          return;
        }
      }
    }

    res.setHeader('Content-Length', String(totalSize));
    fs.createReadStream(filePath).pipe(res);
  };

  app.get('/api/stream/:filename', (req, res) => {
    const safeName = sanitizeFileName(req.params.filename || '');
    const candidatePaths = [
      path.join(STAGING_DIR, safeName),
      path.join(LOCAL_ROMS_DIR, safeName),
      path.join(VIRTUAL_SD_DIR, 'cias', safeName),
      path.join(VIRTUAL_SD_DIR, '3ds', safeName),
    ];
    const existing = candidatePaths.find((p) => fs.existsSync(p));
    if (existing) {
      serveStreamFile(existing, safeName, req, res);
    } else {
      res.status(404).json({
        ok: false,
        message: `ไฟล์ ${safeName} ไม่มีอยู่บนเซิร์ฟเวอร์ กรุณาเลือกไฟล์จริงก่อนส่งผ่าน FBI`,
      });
    }
  });

  app.get('/api/s/:id', (req, res) => {
    const fileName = streamShortIdMap.get(req.params.id);
    if (!fileName) {
      res.status(404).send('Stream link expired or invalid');
      return;
    }
    const safeName = sanitizeFileName(fileName);
    const candidatePaths = [
      path.join(STAGING_DIR, safeName),
      path.join(LOCAL_ROMS_DIR, safeName),
      path.join(VIRTUAL_SD_DIR, 'cias', safeName),
      path.join(VIRTUAL_SD_DIR, '3ds', safeName),
    ];
    const existing = candidatePaths.find((p) => fs.existsSync(p));
    if (existing) {
      serveStreamFile(existing, safeName, req, res);
    } else {
      res.status(404).send('Stream file missing');
    }
  });

  // 11. Checkpoint Detected Titles
  app.get('/api/checkpoint/titles', async (req, res) => {
    const mode = (req.query.mode as string) || 'virtual';
    const ip = req.query.ip as string;
    const port = Number(req.query.port) || 5000;

    try {
      const backend = getSdBackend(mode, ip, port);
      const titles = await vaultManager.scanCheckpointTitles(backend);
      res.json({ ok: true, titles });
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message, titles: [] });
    }
  });

  // 12. Save Vault Endpoints
  app.get('/api/vault/list', (_req, res) => {
    res.json({ ok: true, backups: vaultManager.listBackups() });
  });

  app.post('/api/vault/backup', async (req, res) => {
    const { titleId, gameTitle, slotName, note, isPinned, tags, mode = 'virtual', ip, port = 5000 } = req.body;
    if (!titleId || !slotName) {
      res.status(400).json({ ok: false, message: 'Title ID และ Slot Name จำเป็นสำหรับการสำรอง' });
      return;
    }
    try {
      const backend = getSdBackend(mode, ip, port);
      const meta = await vaultManager.createBackup(backend, {
        titleId,
        gameTitle,
        slotName,
        note,
        isPinned,
        tags,
      });
      res.json({ ok: true, backup: meta });
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message });
    }
  });

  app.post('/api/vault/restore', async (req, res) => {
    const { titleId, slotName, mode = 'virtual', ip, port = 5000 } = req.body;
    if (!titleId || !slotName) {
      res.status(400).json({ ok: false, message: 'Title ID และ Slot Name จำเป็นสำหรับการกู้คืน' });
      return;
    }
    try {
      const backend = getSdBackend(mode, ip, port);
      const result = await vaultManager.restoreBackup(backend, titleId, slotName);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message });
    }
  });

  app.post('/api/vault/delete', (req, res) => {
    const { titleId, slotName } = req.body;
    if (!titleId || !slotName) {
      res.status(400).json({ ok: false, message: 'Title ID และ Slot Name จำเป็น' });
      return;
    }
    const ok = vaultManager.deleteBackup(titleId, slotName);
    res.json({ ok, message: ok ? 'Deleted backup' : 'Backup not found' });
  });

  app.post('/api/vault/pin', (req, res) => {
    const { titleId, slotName, isPinned } = req.body;
    try {
      const meta = vaultManager.setPin(titleId, slotName, Boolean(isPinned));
      res.json({ ok: true, backup: meta });
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message });
    }
  });

  app.post('/api/vault/tags', (req, res) => {
    const { titleId, slotName, tags } = req.body;
    try {
      const meta = vaultManager.setTags(titleId, slotName, Array.isArray(tags) ? tags : []);
      res.json({ ok: true, backup: meta });
    } catch (err) {
      res.status(500).json({ ok: false, message: (err as Error).message });
    }
  });

  app.get('/api/vault/export-zip', (req, res) => {
    const titleId = req.query.titleId as string;
    const slotName = req.query.slotName as string;

    const zipBytes = vaultManager.exportZip(titleId, slotName);
    const fileName = titleId && slotName ? `SaveBackup_${titleId}_${slotName}.zip` : `CitraLink_SaveVault_All.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(zipBytes));
  });

  // 13. LAN Subnet Scanner (accurate; no fake hardware device)
  app.post('/api/ftp/scan', async (req, res) => {
    const { subnetPrefix, currentIp = '192.168.1.35', mode = 'virtual' } = req.body;

    const lanIp = detectHostLanIp();
    const baseParts = (subnetPrefix || currentIp || lanIp).split('.');
    const prefix =
      baseParts.length >= 3 ? `${baseParts[0]}.${baseParts[1]}.${baseParts[2]}` : '192.168.1';

    const discovered: Array<{
      ip: string;
      port: number;
      latencyMs: number;
      banner: string;
      protocol: ConsoleProtocolType;
      isVirtual?: boolean;
    }> = [];

    const candidateIps = new Set<string>();
    if (currentIp && isPrivateOrLocalIp(currentIp)) {
      candidateIps.add(currentIp);
    }
    for (let host = 2; host <= 45; host++) candidateIps.add(`${prefix}.${host}`);
    for (let host = 100; host <= 130; host++) candidateIps.add(`${prefix}.${host}`);

    const probeHost = (targetIp: string, targetPort: number): Promise<void> =>
      new Promise((resolve) => {
        const start = Date.now();
        const sock = new net.Socket();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          sock.destroy();
          resolve();
        };

        sock.setTimeout(220);
        sock.once('connect', () => {
          const latencyMs = Date.now() - start;
          sock.once('data', (chunk) => {
            const banner = chunk.toString('utf-8').trim();
            discovered.push({
              ip: targetIp,
              port: targetPort,
              latencyMs,
              banner: banner || `3DS TCP Port ${targetPort} Open`,
              protocol: banner.includes('Rosalina') ? 'ftpd_rosalina' : 'standard_ftp21',
            });
            finish();
          });
          setTimeout(() => {
            if (!done) {
              discovered.push({
                ip: targetIp,
                port: targetPort,
                latencyMs,
                banner: `3DS TCP Port ${targetPort} Open`,
                protocol: 'ftpd_rosalina',
              });
              finish();
            }
          }, 100);
        });
        sock.once('timeout', finish);
        sock.once('error', finish);
        sock.connect(targetPort, targetIp);
      });

    const tasks: Promise<void>[] = [];
    for (const ip of candidateIps) {
      tasks.push(probeHost(ip, 5000));
    }
    await Promise.all(tasks);

    // Only inject Virtual 3DS in virtual mode
    if (mode === 'virtual') {
      const virtualIp = currentIp || `${prefix}.35`;
      if (!discovered.some((d) => d.ip === virtualIp && d.port === 5000)) {
        discovered.unshift({
          ip: virtualIp,
          port: 5000,
          latencyMs: 4,
          banner: '220 FTPD v3.1.0 (Virtual 3DS SD Ready)',
          protocol: 'ftpd_rosalina',
          isVirtual: true,
        });
      }
    }

    res.json({
      ok: true,
      subnetScanned: `${prefix}.0/24`,
      hostLanIp: lanIp,
      devices: discovered,
    });
  });

  // 14. Probe TCP
  app.post('/api/ftp/probe', (req, res) => {
    const { ip, port, mode } = req.body;
    if (!ip || !port) {
      res.status(400).json({ ok: false, message: 'IP Address และ Port จำเป็น' });
      return;
    }

    if (!isPrivateOrLocalIp(ip)) {
      res.status(403).json({ ok: false, message: 'อนุญาตเฉพาะ IP Address ในเครือข่ายภายใน (LAN)' });
      return;
    }

    if (mode === 'virtual') {
      res.json({
        ok: true,
        mode: 'virtual',
        latencyMs: 5,
        banner: '220 FTPD v3.1.0 (Virtual 3DS SD Ready)',
      });
      return;
    }

    const start = Date.now();
    const sock = new net.Socket();
    let settled = false;

    const finish = (ok: boolean, banner: string) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      res.json({ ok, mode: 'hardware', latencyMs: Date.now() - start, banner });
    };

    sock.setTimeout(2500);
    sock.once('connect', () => {
      finish(true, `เชื่อมต่อ TCP ${ip}:${port} สำเร็จ`);
    });
    sock.once('data', (chunk) => {
      finish(true, chunk.toString('utf-8').trim());
    });
    sock.once('timeout', () => {
      finish(false, `หมดเวลาเชื่อมต่อ ${ip}:${port}`);
    });
    sock.once('error', (err) => {
      finish(false, `เชื่อมต่อไม่สำเร็จ: ${err.message}`);
    });

    sock.connect(Number(port), ip);
  });

  // 15. Telemetry
  app.post('/api/console/telemetry', (req, res) => {
    const {
      ip = '192.168.1.35',
      port = 5000,
      mode = 'virtual',
      protocol = 'ftpd_rosalina',
      simulatedPercentage = 84,
      simulatedCharging = true,
    } = req.body;

    const nowTime = new Date().toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    if (mode === 'virtual') {
      const banner = `211-FTPD Rosalina MCU_BATT=${simulatedPercentage} AC_ADAPTER=${simulatedCharging ? 1 : 0}`;
      const telemetry = parseConsoleBatteryResponse(banner, protocol, simulatedCharging, `${nowTime} น.`);
      res.json({ ok: true, telemetry });
      return;
    }

    if (!isPrivateOrLocalIp(ip)) {
      res.status(403).json({ ok: false, message: 'Invalid private IP' });
      return;
    }

    const sock = new net.Socket();
    let settled = false;
    let text = '';

    const done = (raw: string) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      const telemetry = parseConsoleBatteryResponse(raw, protocol, undefined, `${nowTime} น.`);
      res.json({ ok: true, telemetry });
    };

    sock.setTimeout(2200);
    sock.connect(Number(port), ip, () => {
      sock.write('SITE BATT\r\nSYST\r\n');
    });

    sock.on('data', (c) => {
      text += c.toString('utf-8');
      if (text.includes('\n')) done(text);
    });
    sock.once('timeout', () => done(text));
    sock.once('error', () => {
      if (settled) return;
      settled = true;
      sock.destroy();
      res.json({
        ok: false,
        telemetry: {
          supported: false,
          protocol,
          protocolName: 'Hardware TCP Unreachable',
          percentage: null,
          isCharging: false,
          mcuBars: 0,
          voltageMv: null,
          safeForLargeInstall: false,
          statusLabel: `ไม่สามารถเชื่อมต่อ ${ip}:${port}`,
          advisoryText: 'ตรวจสอบว่าเครื่อง 3DS เปิดแอป FTPD และเชื่อมต่อ Wi-Fi วงเดียวกัน',
          updatedAt: `${nowTime} น.`,
          reasonIfUnsupported: 'การเชื่อมต่อ TCP ขัดข้อง',
        },
      });
    });
  });

  // 16. Push to FBI Remote Install
  app.post('/api/fbi/push', (req, res) => {
    const { ip, port = 5000, urls, mode = 'virtual' } = req.body;
    if (!ip || !Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ ok: false, message: 'ต้องระบุ IP และ URL ของไฟล์' });
      return;
    }

    if (!isPrivateOrLocalIp(ip)) {
      res.status(403).json({ ok: false, message: 'Invalid private IP' });
      return;
    }

    const packet = buildFbiBoopPayload(urls);

    if (mode === 'virtual') {
      res.json({
        ok: true,
        bytesSent: packet.byteLength,
        target: `${ip}:${port}`,
        message: `ส่งคำสั่ง FBI Remote Install (${urls.length} ไฟล์) สำเร็จ`,
      });
      return;
    }

    const sock = new net.Socket();
    let settled = false;
    const done = (ok: boolean, message: string) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      res.json({ ok, bytesSent: packet.byteLength, target: `${ip}:${port}`, message });
    };

    sock.setTimeout(3500);
    sock.connect(Number(port), ip, () => {
      sock.write(Buffer.from(packet), (err) => {
        if (err) done(false, `ส่งแพ็กเก็ตไม่สำเร็จ: ${err.message}`);
        else done(true, `ส่ง URL ไปยัง FBI บนเครื่อง ${ip}:${port} เรียบร้อยแล้ว`);
      });
    });
    sock.once('timeout', () => done(false, `หมดเวลาเชื่อมต่อ FBI ที่ ${ip}:${port}`));
    sock.once('error', (err) => done(false, `ส่งข้อมูลไม่สำเร็จ: ${err.message}`));
  });

  return {
    app,
    virtualSd,
    transferManager,
    vaultManager,
    dirs: {
      DATA_ROOT,
      STAGING_DIR,
      LOCAL_ROMS_DIR,
      VAULT_DIR,
      VIRTUAL_SD_DIR,
    },
  };
}
