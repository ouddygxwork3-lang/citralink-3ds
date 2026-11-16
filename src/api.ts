import { SDFileItem, SaveSlotBackup, ConsoleProtocolType, BatteryTelemetry } from './utils/transferLogic.ts';
import { ConsoleGameTitle } from './data/initial3dsData.ts';

export interface BridgeInfoResponse {
  status: string;
  lanIp: string;
  hostUrl: string;
  localRomsDir: string;
  stagingDir: string;
  virtualSdDir: string;
  vaultDir: string;
  protocols: string[];
}

export interface LocalRomEntry {
  fileName: string;
  sizeBytes: number;
  sourceFolder: 'local-roms' | 'staging';
  modifiedAt: string;
  titleId?: string;
  productCode?: string;
  appTitle?: string;
  titleTypeLabel?: string;
  iconDataUrl?: string;
}

export interface SdUsageSummary {
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

export interface TransferJobStatus {
  id: string;
  fileName: string;
  sizeBytes: number;
  bytesTransferred: number;
  speedBytesPerSec: number;
  progressPercent: number;
  status: 'queued' | 'transferring' | 'completed' | 'failed';
  targetDirectory: string;
  checksum?: string;
  errorMessage?: string;
  startedAt: number;
  updatedAt: number;
}

async function parseJsonResponse<T = any>(res: Response, fallbackErrorMsg: string): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('STATIC_WEB_MODE: เซิร์ฟเวอร์ Local Bridge ไม่ได้เปิดใช้งาน');
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || fallbackErrorMsg);
  }
  return data as T;
}

export const api = {
  async isBridgeOnline(): Promise<boolean> {
    try {
      const res = await fetch('/api/bridge/info');
      if (!res.ok) return false;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return false;
      const data = await res.json();
      return data?.status === 'ready' || data?.status === 'online';
    } catch {
      return false;
    }
  },

  async getBridgeInfo(): Promise<BridgeInfoResponse> {
    const res = await fetch('/api/bridge/info');
    return parseJsonResponse<BridgeInfoResponse>(res, 'Cannot connect to CitraLink server bridge');
  },

  async getLocalRoms(): Promise<LocalRomEntry[]> {
    const res = await fetch('/api/local-roms');
    const data = await parseJsonResponse<{ files?: LocalRomEntry[] }>(res, 'Cannot load local ROMs');
    return data.files || [];
  },

  async getSdFiles(path: string, mode: string, ip: string, port: number): Promise<SDFileItem[]> {
    const query = new URLSearchParams({
      path,
      mode,
      ip,
      port: String(port),
    });
    const res = await fetch(`/api/sd/list?${query.toString()}`);
    const data = await parseJsonResponse<{ files?: SDFileItem[] }>(
      res,
      `Cannot list SD files for ${path}`
    );
    return data.files || [];
  },

  async getSdUsage(mode: string, ip: string, port: number): Promise<SdUsageSummary> {
    const query = new URLSearchParams({
      mode,
      ip,
      port: String(port),
    });
    const res = await fetch(`/api/sd/usage?${query.toString()}`);
    const data = await parseJsonResponse<{ usage: SdUsageSummary }>(
      res,
      'Cannot read SD storage usage'
    );
    return data.usage;
  },

  async createSdDirectory(path: string, mode: string, ip: string, port: number): Promise<{ ok: boolean; message?: string }> {
    const res = await fetch('/api/sd/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, mode, ip, port }),
    });
    return parseJsonResponse(res, 'Cannot create SD directory');
  },

  async deleteSdFile(path: string, mode: string, ip: string, port: number): Promise<{ ok: boolean; message?: string }> {
    const res = await fetch('/api/sd/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, mode, ip, port }),
    });
    return parseJsonResponse(res, 'Cannot delete SD file');
  },

  async uploadStagingFile(params: {
    fileName: string;
    base64Data?: string;
    targetDirectory?: string;
    mode: string;
    ip: string;
    port: number;
    titleId?: string;
    productCode?: string;
  }): Promise<{
    ok: boolean;
    jobId: string;
    fileName: string;
    sizeBytes: number;
    checksum: string;
    streamUrl: string;
    shortStreamUrl?: string;
    message: string;
  }> {
    const res = await fetch('/api/staging/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return parseJsonResponse(res, 'Upload staging failed');
  },

  async getTransferJob(jobId: string): Promise<TransferJobStatus> {
    const res = await fetch(`/api/transfers/${encodeURIComponent(jobId)}`);
    const data = await parseJsonResponse<{ job: TransferJobStatus }>(res, 'Job not found');
    return data.job;
  },

  async getCheckpointTitles(mode: string, ip: string, port: number): Promise<Array<{
    titleId: string;
    name: string;
    checkpointFolder: string;
    primarySaveFileName: string;
    primarySaveSizeBytes: number;
    availableSlots: string[];
  }>> {
    const query = new URLSearchParams({ mode, ip, port: String(port) });
    const res = await fetch(`/api/checkpoint/titles?${query.toString()}`);
    const data = await parseJsonResponse<{ titles?: any[] }>(res, 'Cannot scan Checkpoint titles');
    return (data.titles || []).map((t: any) => ({
      titleId: t.titleId,
      name: t.name || t.titleId,
      productCode: 'CTR-P-GAME',
      checkpointFolder: t.checkpointFolder,
      primarySaveFileName: t.primarySaveFileName || 'main',
      primarySaveSizeBytes: t.primarySaveSizeBytes || 512 * 1024,
      availableSlots: t.availableSlots || ['Default'],
    }));
  },

  async listVaultBackups(): Promise<SaveSlotBackup[]> {
    const res = await fetch('/api/vault/list');
    const data = await parseJsonResponse<{ backups?: SaveSlotBackup[] }>(
      res,
      'Cannot load Save Vault backups'
    );
    return data.backups || [];
  },

  async createVaultBackup(params: {
    titleId: string;
    gameTitle: string;
    slotName: string;
    note?: string;
    isPinned?: boolean;
    tags?: string[];
    mode: string;
    ip: string;
    port: number;
  }): Promise<SaveSlotBackup> {
    const res = await fetch('/api/vault/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await parseJsonResponse<{ backup: SaveSlotBackup }>(res, 'Backup failed');
    return data.backup;
  },

  async restoreVaultBackup(params: {
    titleId: string;
    slotName: string;
    mode: string;
    ip: string;
    port: number;
  }): Promise<{ ok: boolean; message: string }> {
    const res = await fetch('/api/vault/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return parseJsonResponse(res, 'Restore failed');
  },

  async deleteVaultBackup(titleId: string, slotName: string): Promise<boolean> {
    const res = await fetch('/api/vault/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titleId, slotName }),
    });
    const data = await parseJsonResponse<{ ok: boolean }>(res, 'Delete backup failed');
    return data.ok;
  },

  async setVaultPin(titleId: string, slotName: string, isPinned: boolean): Promise<SaveSlotBackup> {
    const res = await fetch('/api/vault/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titleId, slotName, isPinned }),
    });
    const data = await parseJsonResponse<{ backup: SaveSlotBackup }>(res, 'Pin update failed');
    return data.backup;
  },

  async setVaultTags(titleId: string, slotName: string, tags: string[]): Promise<SaveSlotBackup> {
    const res = await fetch('/api/vault/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titleId, slotName, tags }),
    });
    const data = await parseJsonResponse<{ backup: SaveSlotBackup }>(res, 'Tag update failed');
    return data.backup;
  },

  async probeConsole(ip: string, port: number, mode: string) {
    const res = await fetch('/api/ftp/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port, mode }),
    });
    return parseJsonResponse(res, 'Probe console failed');
  },

  async scanSubnet(params: { subnetPrefix?: string; currentIp?: string; mode: string }) {
    const res = await fetch('/api/ftp/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return parseJsonResponse(res, 'Scan subnet failed');
  },

  async getConsoleTelemetry(params: {
    ip: string;
    port: number;
    mode: string;
    protocol: ConsoleProtocolType;
  }): Promise<{ ok: boolean; telemetry: BatteryTelemetry }> {
    const res = await fetch('/api/console/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return parseJsonResponse(res, 'Get console telemetry failed');
  },

  async pushFbiRemoteInstall(params: {
    ip: string;
    port: number;
    urls: string[];
    mode: string;
  }) {
    const res = await fetch('/api/fbi/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return parseJsonResponse(res, 'Push FBI remote install failed');
  },
};
