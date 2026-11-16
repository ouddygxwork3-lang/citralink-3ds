import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveSafePath, sanitizeFileName, isPrivateOrLocalIp } from './pathUtils.ts';
import { FtpClient } from './ftpClient.ts';
import {
  parse3dsBinarySlices,
  formatFromFileName,
  generateFallbackBadgeIcon,
} from '../src/utils/binary3dsParser.ts';

export interface SDFileEntry {
  id: string;
  name: string;
  path: string; // e.g. "/cias" or "/3ds"
  sizeBytes: number;
  isDirectory: boolean;
  modifiedAt?: string;
  category: 'cia' | '3dsx' | 'nds' | 'save' | 'firm' | 'other';
  titleId?: string;
  productCode?: string;
  appTitle?: string;
  titleTypeLabel?: string;
  iconDataUrl?: string;
  checksum?: string;
}

export interface StorageUsageSummary {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
  byCategory: {
    ciaAndNdsBytes: number;
    homebrewBytes: number;
    saveBytes: number;
    otherBytes: number;
  };
}

export interface SdBackend {
  listFiles(dirPath: string): Promise<SDFileEntry[]>;
  createDirectory(dirPath: string): Promise<{ ok: boolean; message?: string }>;
  deleteFile(filePath: string): Promise<{ ok: boolean; message?: string }>;
  downloadFile(filePath: string): Promise<Buffer>;
  uploadFile(
    remoteDir: string,
    fileName: string,
    stream: NodeJS.ReadableStream,
    sizeBytes: number,
    onProgress?: (bytes: number) => void
  ): Promise<{ bytesWritten: number; sha256Hex: string }>;
  getUsage(): Promise<StorageUsageSummary>;
}

const TOTAL_SD_CAPACITY_BYTES = 32 * 1024 * 1024 * 1024; // Standard 32 GB microSD FAT32

/**
 * Sandboxed local virtual SD filesystem backend rooted at `virtualSdDir`.
 */
export class VirtualSdBackend implements SdBackend {
  private baseDir: string;

  constructor(virtualSdDir: string) {
    this.baseDir = path.resolve(virtualSdDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async listFiles(dirPath: string): Promise<SDFileEntry[]> {
    const safe = resolveSafePath(this.baseDir, dirPath);
    if (!safe.ok) {
      throw new Error(`Invalid SD path: ${safe.error}`);
    }

    if (!fs.existsSync(safe.absolutePath)) {
      return [];
    }

    const stat = fs.statSync(safe.absolutePath);
    if (!stat.isDirectory()) {
      return [];
    }

    const items = fs.readdirSync(safe.absolutePath, { withFileTypes: true });
    const results: SDFileEntry[] = [];
    const normalizedDirPath = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;

    for (const item of items) {
      const fullPath = path.join(safe.absolutePath, item.name);
      try {
        const itemStat = fs.statSync(fullPath);
        const isDir = item.isDirectory();
        const sizeBytes = isDir ? 0 : itemStat.size;
        const category = isDir ? 'other' : (formatFromFileName(item.name) as any);
        const id = `vsd-${Buffer.from(`${normalizedDirPath}/${item.name}`).toString('base64url')}`;
        const modifiedAt = itemStat.mtime.toISOString().slice(0, 16).replace('T', ' ');

        let meta = {
          titleId: undefined as string | undefined,
          productCode: undefined as string | undefined,
          appTitle: undefined as string | undefined,
          titleTypeLabel: undefined as string | undefined,
          iconDataUrl: undefined as string | undefined,
        };

        if (!isDir && sizeBytes > 0 && ['cia', '3dsx', 'nds'].includes(category)) {
          // Read 64KB head & 32KB tail to inspect binary header without loading whole file
          const fd = fs.openSync(fullPath, 'r');
          const headLen = Math.min(sizeBytes, 64 * 1024);
          const headBuf = Buffer.alloc(headLen);
          fs.readSync(fd, headBuf, 0, headLen, 0);

          let tailBuf: Uint8Array | undefined;
          if (sizeBytes > 64 * 1024) {
            const tailLen = Math.min(sizeBytes, 32 * 1024);
            const tBuf = Buffer.alloc(tailLen);
            fs.readSync(fd, tBuf, 0, tailLen, sizeBytes - tailLen);
            tailBuf = new Uint8Array(tBuf);
          }
          fs.closeSync(fd);

          const parsed = parse3dsBinarySlices(item.name, sizeBytes, new Uint8Array(headBuf), tailBuf);
          meta = {
            titleId: parsed.titleId,
            productCode: parsed.productCode,
            appTitle: parsed.appTitle,
            titleTypeLabel: parsed.titleTypeLabel,
            iconDataUrl: parsed.iconDataUrl,
          };
        }

        results.push({
          id,
          name: item.name,
          path: normalizedDirPath,
          sizeBytes,
          isDirectory: isDir,
          modifiedAt,
          category,
          titleId: meta.titleId,
          productCode: meta.productCode,
          appTitle: meta.appTitle,
          titleTypeLabel: meta.titleTypeLabel,
          iconDataUrl: meta.iconDataUrl,
        });
      } catch {
        // Skip inaccessible entries
      }
    }

    return results;
  }

  async createDirectory(dirPath: string): Promise<{ ok: boolean; message?: string }> {
    const safe = resolveSafePath(this.baseDir, dirPath);
    if (!safe.ok) throw new Error(safe.error);

    fs.mkdirSync(safe.absolutePath, { recursive: true });
    return { ok: true, message: `Created directory ${dirPath}` };
  }

  async deleteFile(filePath: string): Promise<{ ok: boolean; message?: string }> {
    const safe = resolveSafePath(this.baseDir, filePath);
    if (!safe.ok) throw new Error(safe.error);

    if (!fs.existsSync(safe.absolutePath)) {
      return { ok: false, message: 'File or directory does not exist' };
    }

    const stat = fs.statSync(safe.absolutePath);
    if (stat.isDirectory()) {
      fs.rmSync(safe.absolutePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(safe.absolutePath);
    }
    return { ok: true, message: `Deleted ${filePath}` };
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const safe = resolveSafePath(this.baseDir, filePath);
    if (!safe.ok) throw new Error(safe.error);
    if (!fs.existsSync(safe.absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(safe.absolutePath);
  }

  async uploadFile(
    remoteDir: string,
    fileName: string,
    streamOrBuffer: NodeJS.ReadableStream | Buffer,
    _sizeBytes: number,
    onProgress?: (bytes: number) => void
  ): Promise<{ bytesWritten: number; sha256Hex: string }> {
    const safeDir = resolveSafePath(this.baseDir, remoteDir);
    if (!safeDir.ok) throw new Error(safeDir.error);

    fs.mkdirSync(safeDir.absolutePath, { recursive: true });
    const safeName = sanitizeFileName(fileName);
    const destPath = path.join(safeDir.absolutePath, safeName);

    const hash = crypto.createHash('sha256');
    let bytesWritten = 0;
    const stream = Buffer.isBuffer(streamOrBuffer) ? (await import('stream')).Readable.from(streamOrBuffer) : streamOrBuffer;

    return new Promise((resolve, reject) => {
      const outStream = fs.createWriteStream(destPath);

      stream.on('data', (chunk: Buffer | Uint8Array) => {
        bytesWritten += chunk.length;
        hash.update(chunk);
        if (onProgress) onProgress(bytesWritten);
      });

      stream.pipe(outStream);

      outStream.on('finish', () => {
        resolve({
          bytesWritten,
          sha256Hex: hash.digest('hex').toUpperCase(),
        });
      });

      outStream.on('error', (err) => reject(err));
      stream.on('error', (err) => reject(err));
    });
  }

  async getUsage(): Promise<StorageUsageSummary> {
    let usedBytes = 0;
    const byCategory = {
      ciaAndNdsBytes: 0,
      homebrewBytes: 0,
      saveBytes: 0,
      otherBytes: 0,
    };

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else if (e.isFile()) {
          try {
            const sz = fs.statSync(full).size;
            usedBytes += sz;
            const fmt = formatFromFileName(e.name);
            if (fmt === 'cia' || fmt === 'nds') byCategory.ciaAndNdsBytes += sz;
            else if (fmt === '3dsx') byCategory.homebrewBytes += sz;
            else if (fmt === 'save') byCategory.saveBytes += sz;
            else byCategory.otherBytes += sz;
          } catch {
            // ignore
          }
        }
      }
    };

    walk(this.baseDir);
    const freeBytes = Math.max(0, TOTAL_SD_CAPACITY_BYTES - usedBytes);
    const usagePercent = Math.min(100, Math.round((usedBytes / TOTAL_SD_CAPACITY_BYTES) * 1000) / 10);

    return {
      totalBytes: TOTAL_SD_CAPACITY_BYTES,
      usedBytes,
      freeBytes,
      usagePercent,
      byCategory,
    };
  }
}

/**
 * Real Nintendo 3DS hardware backend operating over RFC 959 FTP (ftpd).
 */
export class HardwareFtpBackend implements SdBackend {
  private ip: string;
  private port: number;

  constructor(ip: string, port = 5000) {
    if (!isPrivateOrLocalIp(ip)) {
      throw new Error(`Rejected non-private IP address for 3DS connection: ${ip}`);
    }
    this.ip = ip;
    this.port = port;
  }

  private async getClient(): Promise<FtpClient> {
    const client = new FtpClient(6000);
    await client.connect(this.ip, this.port);
    return client;
  }

  async listFiles(dirPath: string): Promise<SDFileEntry[]> {
    const client = await this.getClient();
    try {
      const remoteEntries = await client.list(dirPath);
      const normalizedDir = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;

      return remoteEntries.map((e) => {
        const category = e.isDirectory ? 'other' : (formatFromFileName(e.name) as any);
        return {
          id: `hsd-${Buffer.from(`${normalizedDir}/${e.name}`).toString('base64url')}`,
          name: e.name,
          path: normalizedDir,
          sizeBytes: e.size,
          isDirectory: e.isDirectory,
          modifiedAt: e.modifiedAt,
          category,
          iconDataUrl: generateFallbackBadgeIcon(e.name, category),
        };
      });
    } finally {
      await client.quit();
    }
  }

  async createDirectory(dirPath: string): Promise<{ ok: boolean; message?: string }> {
    const client = await this.getClient();
    try {
      await client.mkdir(dirPath);
      return { ok: true, message: `Created directory ${dirPath}` };
    } finally {
      await client.quit();
    }
  }

  async deleteFile(filePath: string): Promise<{ ok: boolean; message?: string }> {
    const client = await this.getClient();
    try {
      await client.delete(filePath);
      return { ok: true, message: `Deleted ${filePath}` };
    } finally {
      await client.quit();
    }
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const client = await this.getClient();
    try {
      return await client.downloadToBuffer(filePath);
    } finally {
      await client.quit();
    }
  }

  async uploadFile(
    remoteDir: string,
    fileName: string,
    streamOrBuffer: NodeJS.ReadableStream | Buffer,
    _sizeBytes: number,
    onProgress?: (bytes: number) => void
  ): Promise<{ bytesWritten: number; sha256Hex: string }> {
    const client = await this.getClient();
    const hash = crypto.createHash('sha256');
    const safeName = sanitizeFileName(fileName);
    const remotePath = `${remoteDir.replace(/\/+$/, '')}/${safeName}`;

    const stream = Buffer.isBuffer(streamOrBuffer)
      ? (await import('stream')).Readable.from(streamOrBuffer)
      : streamOrBuffer;

    const pass = new (await import('stream')).PassThrough();
    stream.on('data', (c) => hash.update(c));
    stream.pipe(pass);

    try {
      const up = await client.upload(remotePath, pass, onProgress);
      return {
        bytesWritten: up.bytesWritten,
        sha256Hex: hash.digest('hex').toUpperCase(),
      };
    } finally {
      await client.quit();
    }
  }

  async getUsage(): Promise<StorageUsageSummary> {
    // Collect usage by listing standard 3DS SD roots
    const client = await this.getClient();
    let usedBytes = 0;
    const byCategory = {
      ciaAndNdsBytes: 0,
      homebrewBytes: 0,
      saveBytes: 0,
      otherBytes: 0,
    };

    try {
      for (const d of ['/cias', '/3ds', '/roms/nds', '/3ds/Checkpoint/saves']) {
        try {
          const list = await client.list(d);
          for (const item of list) {
            if (!item.isDirectory) {
              usedBytes += item.size;
              const fmt = formatFromFileName(item.name);
              if (fmt === 'cia' || fmt === 'nds') byCategory.ciaAndNdsBytes += item.size;
              else if (fmt === '3dsx') byCategory.homebrewBytes += item.size;
              else if (fmt === 'save') byCategory.saveBytes += item.size;
              else byCategory.otherBytes += item.size;
            }
          }
        } catch {
          // directory may not exist on 3DS yet
        }
      }
    } finally {
      await client.quit();
    }

    const freeBytes = Math.max(0, TOTAL_SD_CAPACITY_BYTES - usedBytes);
    const usagePercent = Math.min(100, Math.round((usedBytes / TOTAL_SD_CAPACITY_BYTES) * 1000) / 10);

    return {
      totalBytes: TOTAL_SD_CAPACITY_BYTES,
      usedBytes,
      freeBytes,
      usagePercent,
      byCategory,
    };
  }
}
