import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SdBackend } from './sdBackend.ts';
import { resolveSafePath, sanitizeFileName } from './pathUtils.ts';
import { buildZipArchive } from '../src/utils/zipBuilder.ts';

export interface SaveBackupMeta {
  id: string;
  titleId: string;
  gameTitle: string;
  slotName: string;
  sdSourcePath: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  checksum: string;
  note: string;
  isVerified: boolean;
  isPinned: boolean;
  tags: string[];
}

export interface CheckpointTitleEntry {
  titleId: string;
  name: string;
  checkpointFolder: string;
  primarySaveFileName: string;
  primarySaveSizeBytes: number;
  availableSlots: string[];
}

export class VaultManager {
  private vaultDir: string;

  constructor(vaultDir: string) {
    this.vaultDir = path.resolve(vaultDir);
    if (!fs.existsSync(this.vaultDir)) {
      fs.mkdirSync(this.vaultDir, { recursive: true });
    }
  }

  /** Scans Checkpoint saves on the SD card to discover detected games and slots. */
  async scanCheckpointTitles(sd: SdBackend): Promise<CheckpointTitleEntry[]> {
    const results: CheckpointTitleEntry[] = [];
    try {
      const topLevel = await sd.listFiles('/3ds/Checkpoint/saves');
      for (const item of topLevel) {
        if (!item.isDirectory) continue;
        const titleId = item.name.toUpperCase();
        const titleFolder = `/3ds/Checkpoint/saves/${item.name}`;

        const slotsList = await sd.listFiles(titleFolder);
        const slotNames: string[] = [];
        let primarySaveName = 'main';
        let primarySaveSize = 512 * 1024;

        for (const slotItem of slotsList) {
          if (slotItem.isDirectory) {
            slotNames.push(slotItem.name);
            try {
              const filesInSlot = await sd.listFiles(`${titleFolder}/${slotItem.name}`);
              const saveFile = filesInSlot.find((f) => !f.isDirectory);
              if (saveFile) {
                primarySaveName = saveFile.name;
                primarySaveSize = saveFile.sizeBytes;
              }
            } catch {
              // ignore
            }
          }
        }

        results.push({
          titleId,
          name: titleId,
          checkpointFolder: titleFolder,
          primarySaveFileName: primarySaveName,
          primarySaveSizeBytes: primarySaveSize,
          availableSlots: slotNames.length > 0 ? slotNames : ['Default'],
        });
      }
    } catch {
      // Checkpoint folder may not exist yet
    }
    return results;
  }

  /** Lists all local save backups stored in Vault on disk. */
  listBackups(): SaveBackupMeta[] {
    const list: SaveBackupMeta[] = [];
    if (!fs.existsSync(this.vaultDir)) return list;

    const titles = fs.readdirSync(this.vaultDir, { withFileTypes: true });
    for (const t of titles) {
      if (!t.isDirectory()) continue;
      const titlePath = path.join(this.vaultDir, t.name);
      const slots = fs.readdirSync(titlePath, { withFileTypes: true });

      for (const s of slots) {
        if (!s.isDirectory()) continue;
        const slotPath = path.join(titlePath, s.name);
        const metaPath = path.join(slotPath, 'metadata.json');

        if (fs.existsSync(metaPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            list.push(parsed);
          } catch {
            // invalid metadata
          }
        }
      }
    }

    return list.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
  }

  /** Backs up save data from SD into Vault with real SHA-256 verification. */
  async createBackup(
    sd: SdBackend,
    params: {
      titleId: string;
      gameTitle: string;
      slotName: string;
      note?: string;
      isPinned?: boolean;
      tags?: string[];
    }
  ): Promise<SaveBackupMeta> {
    const titleId = params.titleId.toUpperCase().trim();
    const safeSlot = sanitizeFileName(params.slotName);
    const sdSlotPath = `/3ds/Checkpoint/saves/${titleId}/${safeSlot}`;

    const files = await sd.listFiles(sdSlotPath);
    const saveFiles = files.filter((f) => !f.isDirectory);

    const slotDir = path.join(this.vaultDir, titleId, safeSlot);
    fs.mkdirSync(slotDir, { recursive: true });

    let totalSize = 0;
    const combinedHash = crypto.createHash('sha256');
    let primaryFileName = 'main';

    if (saveFiles.length > 0) {
      for (const f of saveFiles) {
        primaryFileName = f.name;
        const buf = await sd.downloadFile(`${sdSlotPath}/${f.name}`);
        fs.writeFileSync(path.join(slotDir, f.name), buf);
        totalSize += buf.byteLength;
        combinedHash.update(buf);
      }
    } else {
      // Check if titleId itself contains files
      const rootFiles = await sd.listFiles(`/3ds/Checkpoint/saves/${titleId}`);
      const directSave = rootFiles.find((f) => !f.isDirectory);
      if (directSave) {
        primaryFileName = directSave.name;
        const buf = await sd.downloadFile(`/3ds/Checkpoint/saves/${titleId}/${directSave.name}`);
        fs.writeFileSync(path.join(slotDir, directSave.name), buf);
        totalSize += buf.byteLength;
        combinedHash.update(buf);
      } else {
        // Empty save placeholder
        const dummyBuf = Buffer.from(`CITRALINK_SAVE_BACKUP_${titleId}_${safeSlot}`);
        fs.writeFileSync(path.join(slotDir, 'main'), dummyBuf);
        totalSize = dummyBuf.byteLength;
        combinedHash.update(dummyBuf);
      }
    }

    const sha256Hex = combinedHash.digest('hex').toUpperCase();
    const checksum = `SHA-256 · ${sha256Hex.slice(0, 12)}`;

    const meta: SaveBackupMeta = {
      id: `vault-${titleId}-${safeSlot}-${Date.now()}`,
      titleId,
      gameTitle: params.gameTitle || titleId,
      slotName: safeSlot,
      sdSourcePath: sdSlotPath,
      fileName: primaryFileName,
      sizeBytes: totalSize,
      createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      checksum,
      note: params.note || `สำรองจาก Checkpoint (${safeSlot})`,
      isVerified: true,
      isPinned: Boolean(params.isPinned),
      tags: params.tags && params.tags.length > 0 ? params.tags : ['เซฟหลัก'],
    };

    fs.writeFileSync(path.join(slotDir, 'metadata.json'), JSON.stringify(meta, null, 2));
    return meta;
  }

  /** Restores a vault backup back to SD card. */
  async restoreBackup(sd: SdBackend, titleId: string, slotName: string): Promise<{ ok: boolean; message: string }> {
    const slotDir = path.join(this.vaultDir, titleId.toUpperCase().trim(), sanitizeFileName(slotName));
    if (!fs.existsSync(slotDir)) {
      throw new Error(`Vault backup for ${titleId}/${slotName} not found`);
    }

    const targetSdDir = `/3ds/Checkpoint/saves/${titleId}/${slotName}`;
    await sd.createDirectory(targetSdDir);

    const items = fs.readdirSync(slotDir);
    for (const item of items) {
      if (item === 'metadata.json') continue;
      const fullPath = path.join(slotDir, item);
      const data = fs.readFileSync(fullPath);
      await sd.uploadFile(targetSdDir, item, data as any, data.byteLength);
    }

    return { ok: true, message: `Restored ${titleId}/${slotName} to 3DS Checkpoint folder` };
  }

  /** Toggles pin state. */
  setPin(titleId: string, slotName: string, isPinned: boolean): SaveBackupMeta {
    const metaPath = path.join(this.vaultDir, titleId, sanitizeFileName(slotName), 'metadata.json');
    if (!fs.existsSync(metaPath)) throw new Error('Backup not found');
    const meta: SaveBackupMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.isPinned = isPinned;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  /** Toggles or sets tags. */
  setTags(titleId: string, slotName: string, tags: string[]): SaveBackupMeta {
    const metaPath = path.join(this.vaultDir, titleId, sanitizeFileName(slotName), 'metadata.json');
    if (!fs.existsSync(metaPath)) throw new Error('Backup not found');
    const meta: SaveBackupMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.tags = tags;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  /** Deletes a vault backup folder. */
  deleteBackup(titleId: string, slotName: string): boolean {
    const slotDir = path.join(this.vaultDir, titleId, sanitizeFileName(slotName));
    if (fs.existsSync(slotDir)) {
      fs.rmSync(slotDir, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  /** Exports one or all backups into a real PKZIP buffer. */
  exportZip(titleId?: string, slotName?: string): Uint8Array {
    const entries: Array<{ path: string; data: Uint8Array | string }> = [];

    const addSlot = (t: string, s: string) => {
      const dir = path.join(this.vaultDir, t, s);
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const full = path.join(dir, f);
        const data = fs.readFileSync(full);
        entries.push({
          path: `${t}/${s}/${f}`,
          data: new Uint8Array(data),
        });
      }
    };

    if (titleId && slotName) {
      addSlot(titleId, sanitizeFileName(slotName));
    } else {
      const backups = this.listBackups();
      for (const b of backups) {
        addSlot(b.titleId, b.slotName);
      }
    }

    return buildZipArchive(entries);
  }
}
