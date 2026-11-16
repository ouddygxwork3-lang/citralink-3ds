import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';
import { api } from './api';
import {
  detectGameFileFormat,
  calculateStorageSummary,
  parseConsoleBatteryResponse,
  SDFileItem,
  SaveSlotBackup,
  ConsoleProtocolType,
  BatteryTelemetry,
} from './utils/transferLogic';
import { generateFallbackBadgeIcon } from './utils/binary3dsParser';
import { buildZipArchive, computeSha256ShortDigest } from './utils/zipBuilder';
import {
  INITIAL_CONSOLE_TITLES,
  INITIAL_SD_DIRECTORIES,
  INITIAL_SD_FILES,
  INITIAL_SAVE_VAULT,
  ConsoleGameTitle,
} from './data/initial3dsData';
import { GameTransferView, TransferQueueItem } from './components/GameTransferView';
import { SdExplorerView } from './components/SdExplorerView';
import { SaveBackupVaultView } from './components/SaveBackupVaultView';
import { ConnectionGuideView } from './components/ConnectionGuideView';
import { CompanionAppView } from './components/CompanionAppView';
import { QrInstallModal } from './components/QrInstallModal';

type ActiveTab = 'transfer' | 'explorer' | 'saves' | 'companion' | 'connection';

const STORAGE_KEY_SD_FILES = 'citralink_3ds_sd_files_v1';
const STORAGE_KEY_SD_DIRS = 'citralink_3ds_sd_dirs_v1';
const STORAGE_KEY_SAVE_VAULT = 'citralink_3ds_save_vault_v1';
const STORAGE_KEY_CONN = 'citralink_3ds_conn_v1';
const STORAGE_KEY_THEME = 'citralink_3ds_theme_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('transfer');

  // Dark Mode State
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_THEME) === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_THEME, darkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [darkMode]);

  // Connection settings
  const [consoleIp, setConsoleIp] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONN);
      if (saved) return JSON.parse(saved).ip || '172.20.10.6';
    } catch {
      // ignore
    }
    return '172.20.10.6';
  });

  const [consolePort, setConsolePort] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONN);
      if (saved) return Number(JSON.parse(saved).port) || 5000;
    } catch {
      // ignore
    }
    return 5000;
  });

  const [connectionMode, setConnectionMode] = useState<'virtual' | 'hardware'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONN);
      if (saved) return JSON.parse(saved).mode === 'hardware' ? 'hardware' : 'virtual';
    } catch {
      // ignore
    }
    return 'virtual';
  });

  const [protocol, setProtocol] = useState<ConsoleProtocolType>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONN);
      if (saved && saved.includes('protocol')) {
        const parsed = JSON.parse(saved).protocol;
        if (parsed === 'fbi_boop_only' || parsed === 'standard_ftp21' || parsed === 'ftpd_rosalina') {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return 'ftpd_rosalina';
  });

  const [simulatedBatteryPct, setSimulatedBatteryPct] = useState<number>(84);
  const [simulatedCharging, setSimulatedCharging] = useState<boolean>(true);
  const [isRefreshingBattery, setIsRefreshingBattery] = useState<boolean>(false);
  const [batteryTelemetry, setBatteryTelemetry] = useState<BatteryTelemetry>(() =>
    parseConsoleBatteryResponse(
      '211-FTPD v3.1.0 Rosalina MCU_BATT=84 AC_ADAPTER=1',
      'ftpd_rosalina',
      true,
      'เมื่อสักครู่'
    )
  );

  // SD Card Directories & Files
  const [directories, setDirectories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SD_DIRS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_SD_DIRECTORIES;
  });

  const [sdFiles, setSdFiles] = useState<SDFileItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SD_FILES);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_SD_FILES;
  });

  // Local Save Backup Vault
  const [saveVault, setSaveVault] = useState<SaveSlotBackup[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SAVE_VAULT);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_SAVE_VAULT;
  });

  const [consoleTitles, setConsoleTitles] = useState<ConsoleGameTitle[]>(INITIAL_CONSOLE_TITLES);

  const [currentExplorerPath, setCurrentExplorerPath] = useState<string>('/cias');
  const [transferQueue, setTransferQueue] = useState<TransferQueueItem[]>([
    {
      id: 'initial-tx-1',
      fileName: 'Mario_Kart_7_Update_v1.2_USA.cia',
      sizeBytes: 36.4 * 1024 * 1024,
      targetDirectory: '/cias',
      categoryLabel: '3DS Installable Archive (.CIA)',
      protocolHint: 'FBI Remote Install / FTPD',
      progress: 100,
      speedMbps: 2.85,
      status: 'completed',
      completedAt: '14:15 น.',
      titleId: '0004000E00030800',
      productCode: 'CTR-U-AMKE',
      iconDataUrl: generateFallbackBadgeIcon('0004000E00030800', 'cia'),
    },
  ]);

  // QR Modal State
  const [qrModalFile, setQrModalFile] = useState<{
    isOpen: boolean;
    fileName: string;
    sizeBytes: number;
    titleId?: string;
  }>({
    isOpen: false,
    fileName: '',
    sizeBytes: 0,
  });

  // Global notification banner
  const [notification, setNotification] = useState<string>('');
  const [isServerOnline, setIsServerOnline] = useState<boolean>(false);

  // Persist changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SD_FILES, JSON.stringify(sdFiles));
    } catch {
      // ignore
    }
  }, [sdFiles]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SD_DIRS, JSON.stringify(directories));
    } catch {
      // ignore
    }
  }, [directories]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SAVE_VAULT, JSON.stringify(saveVault));
    } catch {
      // ignore
    }
  }, [saveVault]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_CONN,
        JSON.stringify({ ip: consoleIp, port: consolePort, mode: connectionMode, protocol })
      );
    } catch {
      // ignore
    }
  }, [consoleIp, consolePort, connectionMode, protocol]);

  const fetchConsoleBatteryTelemetry = useCallback(
    async (
      targetIp: string = consoleIp,
      targetPort: number = consolePort,
      targetMode: 'virtual' | 'hardware' = connectionMode,
      targetProtocol: ConsoleProtocolType = protocol,
      simPct: number = simulatedBatteryPct,
      simChrg: boolean = simulatedCharging
    ) => {
      setIsRefreshingBattery(true);
      try {
        const data = await api.getConsoleTelemetry({
          ip: targetIp,
          port: targetPort,
          mode: targetMode,
          protocol: targetProtocol,
        });
        if (data.telemetry) {
          setBatteryTelemetry(data.telemetry);
        }
      } catch {
        const fallbackBanner =
          targetProtocol === 'ftpd_rosalina'
            ? `211-FTPD v3.1.0 Rosalina MCU_BATT=${simPct} AC_ADAPTER=${simChrg ? 1 : 0}`
            : '';
        setBatteryTelemetry(
          parseConsoleBatteryResponse(fallbackBanner, targetProtocol, simChrg, 'เมื่อสักครู่')
        );
      } finally {
        setIsRefreshingBattery(false);
      }
    },
    [consoleIp, consolePort, connectionMode, protocol, simulatedBatteryPct, simulatedCharging]
  );

  const fetchSdFiles = useCallback(
    async (dir: string = currentExplorerPath) => {
      if (connectionMode === 'hardware' && protocol === 'fbi_boop_only') {
        return;
      }
      try {
        const online = await api.isBridgeOnline();
        setIsServerOnline(online);
        if (!online) return;
        const files = await api.getSdFiles(dir, connectionMode, consoleIp, consolePort);
        if (Array.isArray(files)) {
          setSdFiles(files);
        }
      } catch {
        // keep current files
      }
    },
    [currentExplorerPath, connectionMode, protocol, consoleIp, consolePort]
  );

  const fetchVaultData = useCallback(async () => {
    try {
      const online = await api.isBridgeOnline();
      setIsServerOnline(online);
      if (!online) return;
      const backups = await api.listVaultBackups();
      if (Array.isArray(backups) && backups.length > 0) {
        setSaveVault(backups);
      }
      if (connectionMode === 'hardware' && protocol === 'fbi_boop_only') {
        return;
      }
      const titles = await api.getCheckpointTitles(connectionMode, consoleIp, consolePort);
      if (Array.isArray(titles) && titles.length > 0) {
        const mapped: ConsoleGameTitle[] = titles.map((t) => ({
          titleId: t.titleId,
          name: t.name || t.titleId,
          region: 'REGION-FREE',
          publisher: 'Nintendo / Developer',
          checkpointFolder: t.checkpointFolder,
          primarySaveFileName: t.primarySaveFileName,
          primarySaveSizeBytes: t.primarySaveSizeBytes,
          lastPlayed: 'สแกนจากการ์ด SD',
          installedFormat: 'CIA (NAND/SD)',
        }));
        setConsoleTitles(mapped);
      }
    } catch {
      // keep current vault
    }
  }, [connectionMode, protocol, consoleIp, consolePort]);

  useEffect(() => {
    api.isBridgeOnline().then((online) => setIsServerOnline(online));
  }, []);

  useEffect(() => {
    fetchConsoleBatteryTelemetry();
    fetchSdFiles();
    fetchVaultData();
  }, [fetchConsoleBatteryTelemetry, fetchSdFiles, fetchVaultData]);

  const storageSummary = useMemo(() => calculateStorageSummary(sdFiles), [sdFiles]);

  const triggerBrowserFileDownload = (fileName: string, contentSummary: string | Uint8Array) => {
    try {
      const blobPart =
        typeof contentSummary === 'string'
          ? contentSummary
          : new Uint8Array(contentSummary).buffer;
      const blob = new Blob([blobPart], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // fallback
    }
  };

  const handleQueueFilesAndTransfer = async (
    items: Array<{
      fileName: string;
      sizeBytes: number;
      customDir?: string;
      titleId?: string;
      productCode?: string;
      titleTypeLabel?: string;
      iconDataUrl?: string;
      base64SmallPayload?: string;
    }>
  ) => {
    const nowTime = new Date().toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const [idx, item] of items.entries()) {
      const route = detectGameFileFormat(item.fileName);
      const targetDir = item.customDir || route.targetDirectory;
      const localId = `tx-${Date.now()}-${idx}`;
      const iconFormat = route.category === 'archive' ? 'other' : route.category;
      const resolvedIcon =
        item.iconDataUrl || generateFallbackBadgeIcon(item.titleId || item.fileName, iconFormat);

      const queueEntry: TransferQueueItem = {
        id: localId,
        fileName: item.fileName,
        sizeBytes: item.sizeBytes,
        targetDirectory: targetDir,
        categoryLabel: route.categoryLabel,
        protocolHint: route.protocolHint,
        progress: 10,
        speedMbps: 2.85,
        etaSeconds: Math.max(1, Math.round(item.sizeBytes / (2.85 * 1024 * 1024))),
        status: 'transferring',
        completedAt: `${nowTime} น.`,
        titleId: item.titleId,
        productCode: item.productCode,
        titleTypeLabel: item.titleTypeLabel,
        iconDataUrl: resolvedIcon,
      };

      setTransferQueue((prev) => [queueEntry, ...prev]);

      try {
        const uploadRes = await api.uploadStagingFile({
          fileName: item.fileName,
          base64Data: item.base64SmallPayload,
          targetDirectory: targetDir,
          mode: connectionMode,
          ip: consoleIp,
          port: consolePort,
          titleId: item.titleId,
          productCode: item.productCode,
        });

        const jobId = uploadRes.jobId;
        const pollInterval = setInterval(async () => {
          try {
            const job = await api.getTransferJob(jobId);
            const speedMb = job.speedBytesPerSec > 0 ? (job.speedBytesPerSec / (1024 * 1024)).toFixed(2) : '2.85';
            setTransferQueue((prev) =>
              prev.map((q) =>
                q.id === localId
                  ? {
                      ...q,
                      progress: job.progressPercent,
                      speedMbps: Number(speedMb),
                      etaSeconds:
                        job.speedBytesPerSec > 0
                          ? Math.max(0, Math.round((job.sizeBytes - job.bytesTransferred) / job.speedBytesPerSec))
                          : 0,
                      status:
                        job.status === 'completed'
                          ? 'completed'
                          : job.status === 'failed'
                          ? 'failed'
                          : 'transferring',
                    }
                  : q
              )
            );

            if (job.status === 'completed' || job.status === 'failed') {
              clearInterval(pollInterval);
              fetchSdFiles(targetDir);
              setNotification(
                job.status === 'completed'
                  ? `ส่งไฟล์ ${item.fileName} เข้าสู่ sdmc:${targetDir} สำเร็จแล้ว (${uploadRes.checksum})`
                  : `ส่งไฟล์ ${item.fileName} ไม่สำเร็จ: ${job.errorMessage || 'การเชื่อมต่อขัดข้อง'}`
              );
            }
          } catch {
            clearInterval(pollInterval);
          }
        }, 350);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isOfflineBridge =
          !isServerOnline || errMsg.startsWith('STATIC_WEB_MODE') || err instanceof TypeError;
        if (isOfflineBridge) {
          const checksum = await computeSha256ShortDigest(
            new TextEncoder().encode(`${item.fileName}:${item.sizeBytes}`)
          );
          setTimeout(() => {
            setTransferQueue((prev) =>
              prev.map((q) => (q.id === localId ? { ...q, progress: 65 } : q))
            );
          }, 180);
          setTimeout(() => {
            setTransferQueue((prev) =>
              prev.map((q) =>
                q.id === localId
                  ? { ...q, progress: 100, etaSeconds: 0, status: 'completed' }
                  : q
              )
            );
            setDirectories((prev) => (prev.includes(targetDir) ? prev : [...prev, targetDir]));
            setSdFiles((prev) => {
              const filtered = prev.filter(
                (f) => !(f.name === item.fileName && f.path === targetDir)
              );
              return [
                {
                  id: `sd-${Date.now()}-${idx}`,
                  name: item.fileName,
                  path: targetDir,
                  sizeBytes: item.sizeBytes,
                  modifiedAt: 'เมื่อสักครู่',
                  category: route.category,
                  isDirectory: false,
                  titleId: item.titleId,
                  productCode: item.productCode,
                  titleTypeLabel: item.titleTypeLabel,
                  iconDataUrl: resolvedIcon,
                  checksum,
                },
                ...filtered,
              ];
            });
            setNotification(
              `ส่งไฟล์ ${item.fileName} เข้าสู่ sdmc:${targetDir} สำเร็จแล้ว (${checksum} · โหมดเว็บเบราว์เซอร์)`
            );
          }, 420);
        } else {
          setTransferQueue((prev) =>
            prev.map((q) => (q.id === localId ? { ...q, status: 'failed', progress: 0 } : q))
          );
          setNotification(`ส่งไฟล์ไม่สำเร็จ: ${errMsg}`);
        }
      }
    }
  };

  const handleCreateDirectory = async (newPath: string): Promise<{ ok: boolean; error?: string }> => {
    if (directories.includes(newPath)) {
      return { ok: false, error: 'มีโฟลเดอร์นี้อยู่แล้วในการ์ด microSD' };
    }
    try {
      const res = await api.createSdDirectory(newPath, connectionMode, consoleIp, consolePort);
      if (res.ok) {
        setDirectories((prev) => (prev.includes(newPath) ? prev : [...prev, newPath]));
        fetchSdFiles(newPath);
        setNotification(`สร้างโฟลเดอร์ใหม่ sdmc:${newPath} บนการ์ด SD เรียบร้อยแล้ว`);
        return { ok: true };
      }
      return { ok: false, error: res.message || 'ไม่สามารถสร้างโฟลเดอร์ได้' };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isOfflineBridge =
        !isServerOnline || errMsg.startsWith('STATIC_WEB_MODE') || err instanceof TypeError;
      if (isOfflineBridge) {
        setDirectories((prev) => (prev.includes(newPath) ? prev : [...prev, newPath]));
        setNotification(
          `สร้างโฟลเดอร์ใหม่ sdmc:${newPath} บนการ์ด SD เรียบร้อยแล้ว (โหมดเว็บเบราว์เซอร์)`
        );
        return { ok: true };
      }
      return { ok: false, error: errMsg };
    }
  };

  const handleDeleteSdFile = async (fileId: string) => {
    const target = sdFiles.find((f) => f.id === fileId);
    if (!target) return;
    try {
      const targetPath = `${target.path.replace(/\/+$/, '')}/${target.name}`;
      await api.deleteSdFile(targetPath, connectionMode, consoleIp, consolePort);
      setSdFiles((prev) => prev.filter((f) => f.id !== fileId));
      setNotification(`ลบไฟล์ ${target.name} ออกจาก sdmc:${target.path} เรียบร้อยแล้ว`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isOfflineBridge =
        !isServerOnline || errMsg.startsWith('STATIC_WEB_MODE') || err instanceof TypeError;
      if (isOfflineBridge) {
        setSdFiles((prev) => prev.filter((f) => f.id !== fileId));
        setNotification(
          `ลบไฟล์ ${target.name} ออกจาก sdmc:${target.path} เรียบร้อยแล้ว (โหมดเว็บเบราว์เซอร์)`
        );
      } else {
        setNotification(`ลบไฟล์ไม่สำเร็จ: ${errMsg}`);
      }
    }
  };

  const handleDownloadSdFileToDevice = (file: SDFileItem) => {
    if (isServerOnline) {
      const fullPath = `${file.path.replace(/\/+$/, '')}/${file.name}`;
      const downloadUrl = `/api/sd/download?path=${encodeURIComponent(fullPath)}&mode=${connectionMode}&ip=${consoleIp}&port=${consolePort}`;
      window.open(downloadUrl, '_blank');
      setNotification(`ดาวน์โหลดไฟล์ "${file.name}" จาก 3DS เรียบร้อยแล้ว`);
      return;
    }
    triggerBrowserFileDownload(
      file.name,
      `CitraLink 3DS Virtual SD File\nName: ${file.name}\nPath: sdmc:${file.path}\nSize: ${file.sizeBytes} bytes\nTitleID: ${file.titleId || 'N/A'}\n`
    );
    setNotification(`ดาวน์โหลดไฟล์ "${file.name}" จาก Virtual SD เรียบร้อยแล้ว`);
  };

  const handleQuickBackupSaveFromSd = async (file: SDFileItem) => {
    const slotName = `2026-11-05_${file.name.replace(/\.[^.]+$/, '')}`;
    const titleId = file.titleId || '0004000000055D00';
    try {
      const backup = await api.createVaultBackup({
        titleId,
        gameTitle: file.name,
        slotName,
        note: `สำรองโดยตรงจากโฟลเดอร์ sdmc:${file.path}`,
        tags: ['เซฟหลัก'],
        mode: connectionMode,
        ip: consoleIp,
        port: consolePort,
      });
      setSaveVault((prev) => [backup, ...prev]);
      setNotification(`สำรองไฟล์เซฟ "${file.name}" เข้าสู่ Vault สำเร็จ (${backup.checksum})`);
      setActiveTab('saves');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isOfflineBridge =
        !isServerOnline || errMsg.startsWith('STATIC_WEB_MODE') || err instanceof TypeError;
      if (isOfflineBridge) {
        const checksum = await computeSha256ShortDigest(
          new TextEncoder().encode(`${titleId}:${slotName}:${file.name}:${file.sizeBytes}`)
        );
        const backup: SaveSlotBackup = {
          id: `save-${Date.now()}`,
          titleId,
          gameTitle: file.name,
          consoleSource: `${consoleIp}:${consolePort} (Web Virtual SD)`,
          slotName,
          sdSourcePath: file.path,
          fileName: file.name,
          sizeBytes: file.sizeBytes || 64 * 1024,
          createdAt: new Date().toLocaleString('th-TH'),
          checksum,
          note: `สำรองโดยตรงจากโฟลเดอร์ sdmc:${file.path}`,
          isVerified: true,
          tags: ['เซฟหลัก'],
        };
        setSaveVault((prev) => [backup, ...prev]);
        setNotification(
          `สำรองไฟล์เซฟ "${file.name}" เข้าสู่ Vault สำเร็จ (${backup.checksum} · โหมดเว็บเบราว์เซอร์)`
        );
        setActiveTab('saves');
      } else {
        setNotification(`สำรองเซฟไม่สำเร็จ: ${errMsg}`);
      }
    }
  };

  const handleCreateSaveBackup = async (params: {
    titleId: string;
    gameTitle: string;
    slotName: string;
    note: string;
    fileName: string;
    sizeBytes: number;
    checksum?: string;
    isPinned?: boolean;
    tags?: string[];
  }) => {
    try {
      const backup = await api.createVaultBackup({
        titleId: params.titleId,
        gameTitle: params.gameTitle,
        slotName: params.slotName,
        note: params.note,
        isPinned: params.isPinned,
        tags: params.tags,
        mode: connectionMode,
        ip: consoleIp,
        port: consolePort,
      });
      setSaveVault((prev) => [backup, ...prev.filter((b) => b.id !== backup.id)]);
      setNotification(`สำรองเซฟ "${params.gameTitle} (${params.slotName})" เรียบร้อยแล้ว (${backup.checksum})`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isOfflineBridge =
        !isServerOnline || errMsg.startsWith('STATIC_WEB_MODE') || err instanceof TypeError;
      if (isOfflineBridge) {
        const checksum =
          params.checksum ||
          (await computeSha256ShortDigest(
            new TextEncoder().encode(
              `${params.titleId}:${params.slotName}:${params.fileName}:${params.sizeBytes}`
            )
          ));
        const matchedTitle = consoleTitles.find((t) => t.titleId === params.titleId);
        const backup: SaveSlotBackup = {
          id: `save-${Date.now()}`,
          titleId: params.titleId,
          gameTitle: params.gameTitle,
          consoleSource: `${consoleIp}:${consolePort} (Web Virtual SD)`,
          slotName: params.slotName,
          sdSourcePath:
            matchedTitle?.checkpointFolder ||
            `/3ds/Checkpoint/saves/${params.titleId}/${params.slotName}`,
          fileName: params.fileName || matchedTitle?.primarySaveFileName || 'main',
          sizeBytes: params.sizeBytes || matchedTitle?.primarySaveSizeBytes || 128 * 1024,
          createdAt: new Date().toLocaleString('th-TH'),
          checksum,
          note: params.note || '',
          isVerified: true,
          isPinned: params.isPinned,
          tags: params.tags && params.tags.length > 0 ? params.tags : ['เซฟหลัก'],
        };
        setSaveVault((prev) => [
          backup,
          ...prev.filter((b) => !(b.titleId === backup.titleId && b.slotName === backup.slotName)),
        ]);
        setNotification(
          `สำรองเซฟ "${params.gameTitle} (${params.slotName})" เรียบร้อยแล้ว (${backup.checksum} · โหมดเว็บเบราว์เซอร์)`
        );
      } else {
        setNotification(`สำรองเซฟไม่สำเร็จ: ${errMsg}`);
      }
    }
  };

  const handleBackupAllTitles = async () => {
    let anyOnlineSuccess = false;
    const offlineFallbacks: SaveSlotBackup[] = [];
    for (const [idx, game] of consoleTitles.entries()) {
      try {
        await api.createVaultBackup({
          titleId: game.titleId,
          gameTitle: game.name,
          slotName: 'Full_Sync',
          note: 'สำรองข้อมูลเซฟอัตโนมัติพร้อมกันทุกเกมผ่าน Wi-Fi',
          tags: ['เซฟหลัก', 'Full-Sync'],
          mode: connectionMode,
          ip: consoleIp,
          port: consolePort,
        });
        anyOnlineSuccess = true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isOfflineBridge =
          !isServerOnline || errMsg.startsWith('STATIC_WEB_MODE') || err instanceof TypeError;
        if (isOfflineBridge) {
          const checksum = await computeSha256ShortDigest(
            new TextEncoder().encode(
              `${game.titleId}:Full_Sync:${game.primarySaveFileName}:${game.primarySaveSizeBytes}`
            )
          );
          offlineFallbacks.push({
            id: `save-sync-${Date.now()}-${idx}`,
            titleId: game.titleId,
            gameTitle: game.name,
            consoleSource: `${consoleIp}:${consolePort} (Web Virtual SD)`,
            slotName: 'Full_Sync',
            sdSourcePath: game.checkpointFolder,
            fileName: game.primarySaveFileName,
            sizeBytes: game.primarySaveSizeBytes,
            createdAt: new Date().toLocaleString('th-TH'),
            checksum,
            note: 'สำรองข้อมูลเซฟอัตโนมัติพร้อมกันทุกเกมผ่าน Wi-Fi',
            isVerified: true,
            tags: ['เซฟหลัก', 'Full-Sync'],
          });
        }
      }
    }
    if (offlineFallbacks.length > 0 && !anyOnlineSuccess) {
      setSaveVault((prev) => {
        const remaining = prev.filter(
          (existing) =>
            !offlineFallbacks.some(
              (fb) => fb.titleId === existing.titleId && fb.slotName === existing.slotName
            )
        );
        return [...offlineFallbacks, ...remaining];
      });
    }
    fetchVaultData();
    setNotification('ซิงก์ข้อมูลเซฟของทุกเกมเข้าสู่ Vault เรียบร้อยแล้ว');
  };

  const handleRestoreBackupTo3ds = async (backup: SaveSlotBackup) => {
    try {
      const res = await api.restoreVaultBackup({
        titleId: backup.titleId,
        slotName: backup.slotName,
        mode: connectionMode,
        ip: consoleIp,
        port: consolePort,
      });
      setNotification(res.message || `กู้คืนเซฟ ${backup.gameTitle} (${backup.slotName}) ไปยัง 3DS Checkpoint สำเร็จ`);
      fetchSdFiles();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isOfflineBridge =
        !isServerOnline || errMsg.startsWith('STATIC_WEB_MODE') || err instanceof TypeError;
      if (isOfflineBridge) {
        const restoreDir = '/3ds/Checkpoint/saves';
        setSdFiles((prev) => {
          const filtered = prev.filter(
            (f) => !(f.name === backup.fileName && f.path === restoreDir)
          );
          return [
            {
              id: `sd-restore-${Date.now()}`,
              name: backup.fileName,
              path: restoreDir,
              sizeBytes: backup.sizeBytes,
              modifiedAt: 'กู้คืนเมื่อสักครู่',
              category: 'save',
              isDirectory: false,
              titleId: backup.titleId,
              checksum: backup.checksum,
            },
            ...filtered,
          ];
        });
        setNotification(
          `กู้คืนเซฟ ${backup.gameTitle} (${backup.slotName}) ไปยัง 3DS Checkpoint สำเร็จ (โหมดเว็บเบราว์เซอร์)`
        );
      } else {
        setNotification(`กู้คืนเซฟไม่สำเร็จ: ${errMsg}`);
      }
    }
  };

  const exportBackupsAsClientZip = (backups: SaveSlotBackup[], zipFileName: string) => {
    const entries = backups.map((b) => ({
      path: `3ds/Checkpoint/saves/${b.titleId}/${b.slotName}/${b.fileName}`,
      data: `CitraLink 3DS Save Backup\nTitleID: ${b.titleId}\nGame: ${b.gameTitle}\nSlot: ${b.slotName}\nChecksum: ${b.checksum}\nCreatedAt: ${b.createdAt}\nNote: ${b.note}\n`,
    }));
    entries.push({
      path: '3ds/Checkpoint/saves/manifest.json',
      data: JSON.stringify(
        {
          exportedBy: 'CitraLink 3DS Web App',
          exportedAt: new Date().toISOString(),
          totalBackups: backups.length,
          backups,
        },
        null,
        2
      ),
    });
    const zipBytes = buildZipArchive(entries);
    triggerBrowserFileDownload(zipFileName, zipBytes);
  };

  const handleDownloadBackupToDevice = (backup: SaveSlotBackup) => {
    if (isServerOnline) {
      const url = `/api/vault/export-zip?titleId=${encodeURIComponent(backup.titleId)}&slotName=${encodeURIComponent(backup.slotName)}`;
      window.open(url, '_blank');
      setNotification(`ดาวน์โหลดไฟล์สำรอง ZIP ของ ${backup.gameTitle} เรียบร้อยแล้ว`);
      return;
    }
    const safeName = `${backup.titleId}_${backup.slotName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
    exportBackupsAsClientZip([backup], safeName);
    setNotification(`ดาวน์โหลดไฟล์สำรอง ZIP ของ ${backup.gameTitle} เรียบร้อยแล้ว`);
  };

  const handleDeleteBackupFromVault = async (backupId: string) => {
    const target = saveVault.find((b) => b.id === backupId);
    if (target) {
      await api.deleteVaultBackup(target.titleId, target.slotName).catch(() => {});
    }
    setSaveVault((prev) => prev.filter((b) => b.id !== backupId));
    setNotification('ลบข้อมูลสำรองออกจาก Vault เรียบร้อยแล้ว');
  };

  const handleTogglePinBackup = async (backupId: string) => {
    const target = saveVault.find((b) => b.id === backupId);
    if (target) {
      const nextPin = !target.isPinned;
      setSaveVault((prev) => prev.map((b) => (b.id === backupId ? { ...b, isPinned: nextPin } : b)));
      await api.setVaultPin(target.titleId, target.slotName, nextPin).catch(() => {});
    }
  };

  const handleToggleTagOnBackup = async (backupId: string, tag: string) => {
    const target = saveVault.find((b) => b.id === backupId);
    if (target) {
      const currentTags = target.tags || [];
      const nextTags = currentTags.includes(tag) ? currentTags.filter((t) => t !== tag) : [...currentTags, tag];
      setSaveVault((prev) => prev.map((b) => (b.id === backupId ? { ...b, tags: nextTags } : b)));
      await api.setVaultTags(target.titleId, target.slotName, nextTags).catch(() => {});
    }
  };

  const handleExportAllVaultAsZip = () => {
    if (isServerOnline) {
      window.open('/api/vault/export-zip', '_blank');
      setNotification('ส่งออกคลังเซฟทั้งหมดเป็น .ZIP เรียบร้อยแล้ว');
      return;
    }
    if (saveVault.length === 0) {
      setNotification('ยังไม่มีข้อมูลสำรองเซฟในคลังสำหรับส่งออก');
      return;
    }
    exportBackupsAsClientZip(
      saveVault,
      `CitraLink_3DS_SaveVault_${new Date().toISOString().slice(0, 10)}.zip`
    );
    setNotification('ส่งออกคลังเซฟทั้งหมดเป็น .ZIP เรียบร้อยแล้ว');
  };

  return (
    <div className={`min-h-screen flex flex-col bg-slate-50 text-slate-900 ${darkMode ? 'dark-mode-root' : ''}`}>
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 md:gap-8 border-b border-slate-200 bg-white px-4 sm:px-6 py-3">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('transfer');
          }}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          CitraLink 3DS
        </a>

        {/* Zone 2: Navigation links */}
        <nav
          aria-label="เมนูหลัก"
          className="order-3 w-full md:order-2 md:w-auto flex items-center justify-start md:justify-center gap-4 sm:gap-6 overflow-x-auto text-xs sm:text-sm font-medium text-slate-600 border-t md:border-t-0 border-slate-100 pt-2 md:pt-0"
        >
          <button
            type="button"
            onClick={() => setActiveTab('transfer')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'transfer'
                ? 'border-rose-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            ส่งไฟล์เกม
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('explorer')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'explorer'
                ? 'border-rose-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            จัดการ SD Card
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('saves')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'saves'
                ? 'border-rose-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            สำรองเซฟเกม
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('companion')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'companion'
                ? 'border-rose-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            แอพบน 3DS (.CIA)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('connection')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'connection'
                ? 'border-rose-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            ตั้งค่าการเชื่อมต่อ
          </button>
        </nav>

        {/* Zone 3: Theme Toggle & Primary Action */}
        <div className="order-2 md:order-3 flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            aria-label={darkMode ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
            title={darkMode ? 'สลับเป็นโหมดสว่าง (Light Mode)' : 'สลับเป็นโหมดมืด (Dark Mode)'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            {darkMode ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{darkMode ? 'โหมดสว่าง' : 'โหมดมืด'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              handleBackupAllTitles();
              setActiveTab('saves');
              setNotification('ซิงก์และสำรองข้อมูลเซฟทุกเกมจาก Nintendo 3DS มายังอุปกรณ์หลักเรียบร้อยแล้ว');
            }}
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            สำรองเซฟด่วน
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {notification && (
          <div
            role="status"
            className="flex items-center justify-between gap-4 rounded-xl border border-slate-300 bg-slate-900 px-4 py-3 text-xs text-white"
          >
            <span>{notification}</span>
            <button
              type="button"
              onClick={() => setNotification('')}
              className="font-semibold text-rose-300 hover:text-white whitespace-nowrap shrink-0"
            >
              ปิดข้อความ
            </button>
          </div>
        )}

        {activeTab === 'transfer' && (
          <GameTransferView
            consoleIp={consoleIp}
            consolePort={consolePort}
            connectionMode={connectionMode}
            batteryTelemetry={batteryTelemetry}
            isRefreshingBattery={isRefreshingBattery}
            onRefreshBattery={() => fetchConsoleBatteryTelemetry()}
            onNavigateToConnection={() => setActiveTab('connection')}
            storage={storageSummary}
            directories={directories}
            transferQueue={transferQueue}
            onQueueFilesAndTransfer={handleQueueFilesAndTransfer}
            onClearCompletedTransfers={() =>
              setTransferQueue((prev) => prev.filter((t) => t.status !== 'completed'))
            }
            onOpenQrInstall={(file) =>
              setQrModalFile({
                isOpen: true,
                fileName: file.fileName,
                sizeBytes: file.sizeBytes,
                titleId: file.titleId,
              })
            }
            onNavigateToExplorer={(folderPath) => {
              setCurrentExplorerPath(folderPath);
              setActiveTab('explorer');
            }}
          />
        )}

        {activeTab === 'explorer' && (
          <SdExplorerView
            currentPath={currentExplorerPath}
            onSelectPath={setCurrentExplorerPath}
            directories={directories}
            files={sdFiles}
            onCreateDirectory={handleCreateDirectory}
            onDeleteFile={handleDeleteSdFile}
            onDownloadFileToDevice={handleDownloadSdFileToDevice}
            onQuickBackupSaveFromSd={handleQuickBackupSaveFromSd}
            onOpenQrInstall={(file) =>
              setQrModalFile({
                isOpen: true,
                fileName: file.fileName,
                sizeBytes: file.sizeBytes,
                titleId: file.titleId,
              })
            }
            onUploadFileToCurrentDir={(fileName, sizeBytes, dirPath, meta) => {
              handleQueueFilesAndTransfer([
                {
                  fileName,
                  sizeBytes,
                  customDir: dirPath,
                  titleId: meta?.titleId,
                  productCode: meta?.productCode,
                  iconDataUrl: meta?.iconDataUrl,
                },
              ]);
            }}
          />
        )}

        {activeTab === 'saves' && (
          <SaveBackupVaultView
            consoleTitles={consoleTitles}
            saveVault={saveVault}
            consoleIp={consoleIp}
            onCreateSaveBackup={handleCreateSaveBackup}
            onBackupAllTitles={handleBackupAllTitles}
            onRestoreBackupTo3ds={handleRestoreBackupTo3ds}
            onDownloadBackupToDevice={handleDownloadBackupToDevice}
            onDeleteBackupFromVault={handleDeleteBackupFromVault}
            onTogglePinBackup={handleTogglePinBackup}
            onToggleTagOnBackup={handleToggleTagOnBackup}
            onExportAllVaultAsZip={handleExportAllVaultAsZip}
          />
        )}

        {activeTab === 'companion' && (
          <CompanionAppView
            consoleIp={consoleIp}
            consolePort={consolePort}
            batteryTelemetry={batteryTelemetry}
            onDeployCompanionCiaTo3ds={(fileName, sizeBytes, titleId) => {
              handleQueueFilesAndTransfer([
                {
                  fileName,
                  sizeBytes,
                  titleId,
                  productCode: 'CTR-P-CLNK',
                  customDir: '/cias',
                },
              ]);
            }}
            onOpenQrInstall={(file) =>
              setQrModalFile({
                isOpen: true,
                fileName: file.fileName,
                sizeBytes: file.sizeBytes,
                titleId: file.titleId,
              })
            }
            onTriggerDirectSaveSyncFrom3ds={() => {
              handleBackupAllTitles();
              setNotification(
                'แอพ CitraLink 3DS Direct (.CIA) ดึงเซฟจาก ARCHIVE_SAVEDATA ของทุกเกมเข้าสู่คลังสำรองบนเว็บโดยตรงเรียบร้อยแล้ว (ไม่ต้องเปิด Checkpoint)'
              );
            }}
            onDownloadCompanionFile={(fileName, content) => {
              triggerBrowserFileDownload(fileName, content);
              setNotification(`ดาวน์โหลดไฟล์ "${fileName}" ลงสู่อุปกรณ์ของคุณเรียบร้อยแล้ว`);
            }}
          />
        )}

        {activeTab === 'connection' && (
          <ConnectionGuideView
            consoleIp={consoleIp}
            consolePort={consolePort}
            connectionMode={connectionMode}
            protocol={protocol}
            batteryTelemetry={batteryTelemetry}
            simulatedBatteryPct={simulatedBatteryPct}
            simulatedCharging={simulatedCharging}
            onUpdateConnection={(ip, port, mode, nextProtocol) => {
              setConsoleIp(ip);
              setConsolePort(port);
              setConnectionMode(mode);
              setProtocol(nextProtocol);
            }}
            onUpdateSimulatedBattery={(pct, chrg) => {
              setSimulatedBatteryPct(pct);
              setSimulatedCharging(chrg);
              fetchConsoleBatteryTelemetry(
                consoleIp,
                consolePort,
                connectionMode,
                protocol,
                pct,
                chrg
              );
            }}
          />
        )}
      </main>

      {/* Clean Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <p>CitraLink 3DS — ระบบจัดการไฟล์เกม (.CIA / .3DSX / .NDS) และสำรองเซฟ Checkpoint ไร้สาย</p>
          <p className="font-mono tabular-nums">
            ปลายทางปัจจุบัน: {consoleIp}:{consolePort}
          </p>
        </div>
      </footer>

      {/* FBI Remote Install QR Code & Boop TCP Push Modal */}
      <QrInstallModal
        isOpen={qrModalFile.isOpen}
        onClose={() => setQrModalFile((prev) => ({ ...prev, isOpen: false }))}
        fileName={qrModalFile.fileName}
        fileSizeBytes={qrModalFile.sizeBytes}
        titleId={qrModalFile.titleId}
        consoleIp={consoleIp}
        consolePort={consolePort}
        connectionMode={connectionMode}
        onBoopPushSuccess={(fileName, message) => {
          handleQueueFilesAndTransfer([
            {
              fileName,
              sizeBytes: qrModalFile.sizeBytes,
              titleId: qrModalFile.titleId,
              customDir: '/cias',
            },
          ]);
          setNotification(message);
        }}
      />
    </div>
  );
}
