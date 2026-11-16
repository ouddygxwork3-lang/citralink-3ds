import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Wifi,
  QrCode,
  FolderOutput,
  CheckCircle2,
  ArrowUpRight,
  HardDrive,
  FilePlus2,
  Trash2,
  BatteryCharging,
  Battery,
  BatteryWarning,
  RefreshCw,
  Cpu,
  Loader2,
  Server,
  AlertCircle,
} from 'lucide-react';
import {
  detectGameFileFormat,
  formatBytes,
  StorageBreakdown,
  BatteryTelemetry,
} from '../utils/transferLogic';
import {
  inspectBrowserGameFile,
  parse3dsBinarySlices,
  generateFallbackBadgeIcon,
} from '../utils/binary3dsParser';
import { QUICK_SAMPLE_PACKAGES, QuickSampleGamePackage } from '../data/initial3dsData';

export interface TransferQueueItem {
  id: string;
  fileName: string;
  sizeBytes: number;
  targetDirectory: string;
  categoryLabel: string;
  protocolHint: string;
  progress: number;
  speedMbps: number;
  etaSeconds?: number;
  status: 'queued' | 'transferring' | 'completed' | 'failed';
  completedAt?: string;
  titleId?: string;
  productCode?: string;
  titleTypeLabel?: string;
  iconDataUrl?: string;
}

export interface StagedGameFileItem {
  fileName: string;
  sizeBytes: number;
  titleId?: string;
  productCode?: string;
  appTitle?: string;
  titleTypeLabel?: string;
  encryptionStatus?: string;
  iconDataUrl?: string;
  isAuthenticBinaryHeader?: boolean;
  base64SmallPayload?: string;
}

interface ServerLocalRomEntry {
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

interface GameTransferViewProps {
  consoleIp: string;
  consolePort: number;
  connectionMode: 'virtual' | 'hardware';
  batteryTelemetry: BatteryTelemetry;
  isRefreshingBattery: boolean;
  onRefreshBattery: () => void;
  onNavigateToConnection: () => void;
  storage: StorageBreakdown;
  directories: string[];
  transferQueue: TransferQueueItem[];
  onQueueFilesAndTransfer: (
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
  ) => void;
  onClearCompletedTransfers: () => void;
  onOpenQrInstall: (file: { fileName: string; sizeBytes: number; titleId?: string }) => void;
  onNavigateToExplorer: (folderPath: string) => void;
}

export const GameTransferView: React.FC<GameTransferViewProps> = ({
  consoleIp,
  consolePort,
  connectionMode,
  batteryTelemetry,
  isRefreshingBattery,
  onRefreshBattery,
  onNavigateToConnection,
  storage,
  directories,
  transferQueue,
  onQueueFilesAndTransfer,
  onClearCompletedTransfers,
  onOpenQrInstall,
  onNavigateToExplorer,
}) => {
  const [autoRoute, setAutoRoute] = useState<boolean>(true);
  const [selectedTargetDir, setSelectedTargetDir] = useState<string>('/cias');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [stagedFiles, setStagedFiles] = useState<StagedGameFileItem[]>([]);
  const [customFileName, setCustomFileName] = useState<string>('');
  const [customFileSizeMb, setCustomFileSizeMb] = useState<string>('128');
  const [customFileError, setCustomFileError] = useState<string>('');
  const [localServerFiles, setLocalServerFiles] = useState<ServerLocalRomEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/local-roms')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.files)) {
          setLocalServerFiles(data.files);
        }
      })
      .catch(() => {
        // ignore offline
      });
    return () => {
      cancelled = true;
    };
  }, [transferQueue.length]);

  const processIncomingBrowserFiles = async (fileList: FileList) => {
    const added: StagedGameFileItem[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const effectiveSize = f.size > 0 ? f.size : 24 * 1024 * 1024;
      try {
        const meta = await inspectBrowserGameFile(f);
        let base64SmallPayload: string | undefined;
        // If file is <= 12 MB, capture base64 so server can store exact binary for FBI streaming
        if (f.size > 0 && f.size <= 12 * 1024 * 1024) {
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = '';
          for (let b = 0; b < buf.length; b++) bin += String.fromCharCode(buf[b]);
          base64SmallPayload = btoa(bin);
        }
        added.push({
          fileName: f.name,
          sizeBytes: effectiveSize,
          titleId: meta.titleId,
          productCode: meta.productCode,
          appTitle: meta.appTitle,
          titleTypeLabel: meta.titleTypeLabel,
          encryptionStatus: meta.encryptionStatus,
          iconDataUrl: meta.iconDataUrl,
          isAuthenticBinaryHeader: meta.isAuthenticBinaryHeader,
          base64SmallPayload,
        });
      } catch {
        const fallback = parse3dsBinarySlices(f.name, effectiveSize, new Uint8Array(0));
        added.push({
          fileName: f.name,
          sizeBytes: effectiveSize,
          titleId: fallback.titleId,
          productCode: fallback.productCode,
          appTitle: fallback.appTitle,
          titleTypeLabel: fallback.titleTypeLabel,
          encryptionStatus: fallback.encryptionStatus,
          iconDataUrl: fallback.iconDataUrl,
        });
      }
    }
    setStagedFiles((prev) => [...prev, ...added]);
    setCustomFileError('');
  };

  const handleBrowserFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await processIncomingBrowserFiles(fileList);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const fileList = e.dataTransfer.files;
    if (!fileList || fileList.length === 0) return;
    await processIncomingBrowserFiles(fileList);
  };

  const handleAddCustomFileToStage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = customFileName.trim();
    if (!trimmedName) {
      setCustomFileError('กรุณาระบุชื่อไฟล์เกมพร้อมนามสกุล เช่น Fantasy_Life_TH.cia หรือ PKSM.3dsx');
      return;
    }
    if (!/\.(cia|3dsx|nds|sav|dat|bin|firm|zip)$/i.test(trimmedName)) {
      setCustomFileError('นามสกุลไฟล์ต้องเป็น .cia, .3dsx, .nds, .sav, .dat, .bin, .firm หรือ .zip');
      return;
    }
    const sizeNum = Number(customFileSizeMb);
    if (!Number.isFinite(sizeNum) || sizeNum <= 0 || sizeNum > 4096) {
      setCustomFileError('ขนาดไฟล์ต้องอยู่ระหว่าง 1 MB ถึง 4096 MB (ขีดจำกัดระบบไฟล์ FAT32)');
      return;
    }

    const sizeBytes = Math.round(sizeNum * 1024 * 1024);
    const parsed = parse3dsBinarySlices(trimmedName, sizeBytes, new Uint8Array(0));

    setCustomFileError('');
    setStagedFiles((prev) => [
      ...prev,
      {
        fileName: trimmedName,
        sizeBytes,
        titleId: parsed.titleId,
        productCode: parsed.productCode,
        appTitle: parsed.appTitle,
        titleTypeLabel: parsed.titleTypeLabel,
        encryptionStatus: parsed.encryptionStatus,
        iconDataUrl: parsed.iconDataUrl,
      },
    ]);
    setCustomFileName('');
  };

  const handleSendStagedTo3ds = () => {
    if (stagedFiles.length === 0) {
      setCustomFileError('กรุณาเลือกไฟล์เกมจากเครื่อง หรือเพิ่มไฟล์เข้าคิวเตรียมส่งอย่างน้อย 1 ไฟล์');
      return;
    }
    setCustomFileError('');
    onQueueFilesAndTransfer(
      stagedFiles.map((item) => ({
        fileName: item.fileName,
        sizeBytes: item.sizeBytes,
        titleId: item.titleId,
        productCode: item.productCode,
        titleTypeLabel: item.titleTypeLabel,
        iconDataUrl: item.iconDataUrl,
        base64SmallPayload: item.base64SmallPayload,
        customDir: autoRoute ? undefined : selectedTargetDir,
      }))
    );
    setStagedFiles([]);
  };

  const handleQuickSendPackage = (pkg: QuickSampleGamePackage) => {
    setCustomFileError('');
    const route = detectGameFileFormat(pkg.fileName);
    const iconFormat =
      route.category === 'cia' || route.category === '3dsx' || route.category === 'nds'
        ? route.category
        : 'cia';
    onQueueFilesAndTransfer([
      {
        fileName: pkg.fileName,
        sizeBytes: pkg.sizeBytes,
        titleId: pkg.titleId,
        productCode: pkg.productCode,
        titleTypeLabel: pkg.version,
        iconDataUrl: generateFallbackBadgeIcon(pkg.titleId || pkg.fileName, iconFormat),
        customDir: autoRoute ? undefined : selectedTargetDir,
      },
    ]);
  };

  return (
    <div className="space-y-8">
      {/* Top Console Status, Battery Telemetry & Storage Summary Bar */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500 font-mono tabular-nums">
                New Nintendo 3DS XL · Luma3DS v13.1.2 · {consoleIp}:{consolePort}
              </p>
              <span className="text-xs font-semibold text-emerald-700">
                {connectionMode === 'virtual'
                  ? 'เชื่อมต่อพร้อมใช้งาน (Virtual 3DS SD)'
                  : 'โหมดเชื่อมต่อเครื่องจริง (FTPD / FBI TCP)'}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
              ส่งไฟล์เกมและ Homebrew เข้าเครื่อง 3DS ผ่าน Wi-Fi
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              โอนย้ายไฟล์ <code className="text-xs font-mono text-slate-800">.CIA</code>,{' '}
              <code className="text-xs font-mono text-slate-800">.3DSX</code> และ{' '}
              <code className="text-xs font-mono text-slate-800">.NDS</code> เข้าสู่การ์ด microSD พร้อมวิเคราะห์โครงสร้างไบนารี (Title ID, Product Code และไอคอน SMDH/NDS) อัตโนมัติก่อนส่ง
            </p>
          </div>

          {/* Live Nintendo 3DS MCU Battery Telemetry Strip */}
          <div className="mt-5 pt-4 border-t border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {batteryTelemetry.supported ? (
                  batteryTelemetry.isCharging ? (
                    <BatteryCharging className="h-5 w-5 text-emerald-600 shrink-0" />
                  ) : (batteryTelemetry.percentage ?? 0) < 25 ? (
                    <BatteryWarning className="h-5 w-5 text-amber-600 shrink-0" />
                  ) : (
                    <Battery className="h-5 w-5 text-slate-800 shrink-0" />
                  )
                ) : (
                  <Battery className="h-5 w-5 text-slate-400 shrink-0" />
                )}

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      แบตเตอรี่เครื่อง Nintendo 3DS:
                    </span>
                    {batteryTelemetry.supported && batteryTelemetry.percentage !== null ? (
                      <span
                        data-testid="console-battery-percentage"
                        className={`text-sm font-bold font-mono tabular-nums ${
                          !batteryTelemetry.safeForLargeInstall
                            ? 'text-red-600'
                            : batteryTelemetry.isCharging
                            ? 'text-emerald-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {batteryTelemetry.percentage}% · {batteryTelemetry.statusLabel}
                      </span>
                    ) : (
                      <span
                        data-testid="console-battery-unsupported"
                        className="text-xs font-semibold text-amber-700"
                      >
                        ไม่รองรับการอ่านค่า ({batteryTelemetry.protocolName})
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
                    {batteryTelemetry.supported && batteryTelemetry.percentage !== null ? (
                      <>
                        ระดับ MCU {batteryTelemetry.mcuBars}/4 ขีด · แรงดัน{' '}
                        {((batteryTelemetry.voltageMv || 4000) / 1000).toFixed(2)} V · อัปเดตเมื่อ{' '}
                        {batteryTelemetry.updatedAt}
                      </>
                    ) : (
                      <>
                        {batteryTelemetry.reasonIfUnsupported} ·{' '}
                        <button
                          type="button"
                          onClick={onNavigateToConnection}
                          className="font-sans font-semibold text-rose-600 hover:underline"
                        >
                          สลับโปรโตคอลเป็น FTPD Pro + Rosalina
                        </button>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* 4-Bar 3DS MCU Battery Meter */}
                {batteryTelemetry.supported && batteryTelemetry.percentage !== null && (
                  <div
                    className="flex items-center gap-1"
                    aria-label={`ระดับขีดแบตเตอรี่ 3DS ${batteryTelemetry.mcuBars} จาก 4 ขีด`}
                  >
                    {[1, 2, 3, 4].map((bar) => (
                      <span
                        key={bar}
                        className={`h-3.5 w-2 rounded-xs transition-opacity ${
                          bar <= batteryTelemetry.mcuBars
                            ? !batteryTelemetry.safeForLargeInstall
                              ? 'bg-red-600'
                              : batteryTelemetry.isCharging
                              ? 'bg-emerald-600'
                              : 'bg-slate-900'
                            : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={onRefreshBattery}
                  disabled={isRefreshingBattery}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingBattery ? 'animate-spin' : ''}`} />
                  อัปเดตแบตเตอรี่
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* SD Card Storage Capacity Visual */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">
                  พื้นที่การ์ด microSDHC (32 GB)
                </h2>
              </div>
              <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                ว่าง {formatBytes(storage.freeBytes)} ({(100 - storage.usagePercent).toFixed(1)}%)
              </span>
            </div>

            <div
              className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100 flex"
              role="progressbar"
              aria-valuenow={storage.usagePercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="สัดส่วนพื้นที่ใช้งานการ์ด microSD"
            >
              <div
                style={{
                  width: `${Math.max(4, (storage.byCategory.ciaAndNdsBytes / storage.totalBytes) * 100)}%`,
                }}
                className="bg-rose-600 transition-transform duration-200"
                title="เกม .CIA และ .NDS"
              />
              <div
                style={{
                  width: `${Math.max(2, (storage.byCategory.homebrewBytes / storage.totalBytes) * 100)}%`,
                }}
                className="bg-amber-500 transition-transform duration-200"
                title="แอป Homebrew .3DSX"
              />
              <div
                style={{
                  width: `${Math.max(2, (storage.byCategory.saveDataBytes / storage.totalBytes) * 100)}%`,
                }}
                className="bg-emerald-600 transition-transform duration-200"
                title="ข้อมูลเซฟเกม Checkpoint"
              />
              <div
                style={{
                  width: `${Math.max(8, (storage.byCategory.systemBytes / storage.totalBytes) * 100)}%`,
                }}
                className="bg-slate-400 transition-transform duration-200"
                title="ไฟล์ระบบและ NAND Backup"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">เกม (.CIA / .NDS)</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatBytes(storage.byCategory.ciaAndNdsBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">เซฟเกม (Checkpoint)</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatBytes(storage.byCategory.saveDataBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Homebrew (.3DSX)</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatBytes(storage.byCategory.homebrewBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">ระบบ / NAND</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatBytes(storage.byCategory.systemBytes)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span>ใช้ไปแล้ว {formatBytes(storage.usedBytes)} จาก 32.00 GB</span>
            <button
              type="button"
              onClick={() => onNavigateToExplorer('/cias')}
              className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:text-rose-700 whitespace-nowrap"
            >
              เปิดดูการ์ด SD
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Main Two-Column Upload & Sample Library Workspace */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left 7 Cols: Drag & Drop + Binary Inspector Stager + Routing Rules */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                1. เลือกไฟล์เกมที่ต้องการส่งเข้า Nintendo 3DS
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                วิเคราะห์ Binary Header (.CIA / .3DSX / .NDS), ถอดรหัสไอคอน SMDH 48×48 และแยกโฟลเดอร์อัตโนมัติ
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="auto-route-toggle" className="text-xs font-medium text-slate-700 cursor-pointer">
                แยกโฟลเดอร์อัตโนมัติตามนามสกุลไฟล์
              </label>
              <input
                id="auto-route-toggle"
                type="checkbox"
                checked={autoRoute}
                onChange={(e) => setAutoRoute(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
            </div>
          </div>

          {!autoRoute && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="manual-target-dir" className="text-xs font-medium text-slate-700">
                เลือกโฟลเดอร์ปลายทางบนการ์ด SD ด้วยตนเอง:
              </label>
              <select
                id="manual-target-dir"
                value={selectedTargetDir}
                onChange={(e) => setSelectedTargetDir(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono text-slate-900 focus:border-rose-500 focus:outline-none"
              >
                {directories.map((dir) => (
                  <option key={dir} value={dir}>
                    sdmc:{dir}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Drag and drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              isDragging
                ? 'border-rose-600 bg-rose-50/50'
                : 'border-slate-300 bg-slate-50/70 hover:border-slate-400'
            }`}
          >
            <input
              ref={fileInputRef}
              id="game-file-upload-input"
              type="file"
              multiple
              accept=".cia,.3dsx,.nds,.sav,.dat,.bin,.firm,.zip"
              onChange={handleBrowserFileChange}
              className="sr-only"
            />
            <Upload className="mx-auto h-8 w-8 text-slate-500" />
            <p className="mt-3 text-sm font-semibold text-slate-900">
              ลากไฟล์เกมมาวางที่นี่ หรือเลือกไฟล์จากอุปกรณ์ของคุณ
            </p>
            <p className="mt-1 text-xs text-slate-500">
              อ่านข้อมูล Header ด้วย <span className="font-mono text-slate-700">File.slice()</span> ทันทีโดยไม่กิน RAM · แยกส่งเข้า{' '}
              <span className="font-mono text-slate-700">/cias</span>,{' '}
              <span className="font-mono text-slate-700">/3ds</span>,{' '}
              <span className="font-mono text-slate-700">/roms/nds</span>
            </p>
            <div className="mt-4">
              <label
                htmlFor="game-file-upload-input"
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
              >
                <FolderOutput className="h-4 w-4" />
                เลือกไฟล์เกมจากเครื่อง (.CIA / .3DSX / .NDS)
              </label>
            </div>
          </div>

          {/* Quick Custom Filename Builder for testing or remote network package staging */}
          <form onSubmit={handleAddCustomFileToStage} className="border-t border-slate-200 pt-5 space-y-3">
            <p className="text-xs font-semibold text-slate-800">
              หรือจำลองการสร้างแพ็กเกจไฟล์เกมเพื่อเตรียมส่งผ่าน Wi-Fi:
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
              <div className="sm:col-span-7">
                <label htmlFor="custom-game-filename" className="block text-xs font-medium text-slate-600 mb-1">
                  ชื่อไฟล์เกม (ระบุนามสกุล .cia, .3dsx, .nds)
                </label>
                <input
                  id="custom-game-filename"
                  type="text"
                  placeholder="เช่น Dragon_Quest_VIII_TH.cia"
                  value={customFileName}
                  onChange={(e) => setCustomFileName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-600 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label htmlFor="custom-game-size" className="block text-xs font-medium text-slate-600 mb-1">
                  ขนาดไฟล์ (MB)
                </label>
                <input
                  id="custom-game-size"
                  type="number"
                  min={1}
                  max={4096}
                  value={customFileSizeMb}
                  onChange={(e) => setCustomFileSizeMb(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-rose-600 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2 flex items-end">
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200 transition-colors whitespace-nowrap"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  พักไฟล์
                </button>
              </div>
            </div>
            {customFileError && (
              <p role="alert" className="text-xs font-medium text-red-600">
                {customFileError}
              </p>
            )}
          </form>

          {/* Staged Files Ready to Send (with Binary Header & SMDH Icon Preview) */}
          {stagedFiles.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Cpu className="h-4 w-4 text-rose-600" />
                  รายการไฟล์ที่ผ่านการตรวจวิเคราะห์โครงสร้างแล้ว ({stagedFiles.length} ไฟล์)
                </h3>
                <button
                  type="button"
                  onClick={() => setStagedFiles([])}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  ล้างรายการพัก
                </button>
              </div>
              <ul className="divide-y divide-slate-200">
                {stagedFiles.map((item, idx) => {
                  const route = detectGameFileFormat(item.fileName);
                  const destDir = autoRoute ? route.targetDirectory : selectedTargetDir;
                  return (
                    <li key={`${item.fileName}-${idx}`} className="py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {item.iconDataUrl && (
                          <img
                            src={item.iconDataUrl}
                            alt={`ไอคอน ${item.fileName}`}
                            className="h-10 w-10 rounded-lg border border-slate-300 bg-slate-900 object-cover shrink-0"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-semibold text-slate-900 truncate">{item.fileName}</p>
                            {item.productCode && (
                              <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-800">
                                {item.productCode}
                              </span>
                            )}
                            {item.isAuthenticBinaryHeader && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                Binary Header แท้
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                            {formatBytes(item.sizeBytes)} · ปลายทาง sdmc:{destDir}
                            {item.titleId ? ` · TID:${item.titleId}` : ''}
                            {item.titleTypeLabel ? ` · ${item.titleTypeLabel}` : ''}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setStagedFiles((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label={`นำไฟล์ ${item.fileName} ออกจากรายการเตรียมส่ง`}
                        className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={handleSendStagedTo3ds}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors"
              >
                <Wifi className="h-4 w-4" />
                ส่งไฟล์เข้าเครื่อง 3DS ทันที ({stagedFiles.length} ไฟล์)
              </button>
            </div>
          )}

          {/* Local Server ROMs Directory (./data/local-roms) */}
          {localServerFiles.length > 0 && (
            <div className="border-t border-slate-200 pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-slate-700" />
                  <h3 className="text-xs font-bold text-slate-900">
                    ไฟล์ในโฟลเดอร์เซิร์ฟเวอร์ (./data/local-roms และ ./data/staging)
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  พร้อมสตรีมผ่าน HTTP 206 ทันที
                </span>
              </div>

              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50 px-3.5">
                {localServerFiles.slice(0, 4).map((srvFile) => {
                  const route = detectGameFileFormat(srvFile.fileName);
                  return (
                    <div
                      key={`${srvFile.sourceFolder}-${srvFile.fileName}`}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {srvFile.iconDataUrl && (
                          <img
                            src={srvFile.iconDataUrl}
                            alt={srvFile.fileName}
                            className="h-8 w-8 rounded border border-slate-300 shrink-0"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {srvFile.fileName}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {formatBytes(srvFile.sizeBytes)} · {srvFile.productCode || 'CTR-P-XXXX'}
                            {srvFile.titleId ? ` · ${srvFile.titleId}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onQueueFilesAndTransfer([
                              {
                                fileName: srvFile.fileName,
                                sizeBytes: srvFile.sizeBytes,
                                titleId: srvFile.titleId,
                                productCode: srvFile.productCode,
                                titleTypeLabel: srvFile.titleTypeLabel,
                                iconDataUrl: srvFile.iconDataUrl,
                                customDir: autoRoute ? route.targetDirectory : selectedTargetDir,
                              },
                            ])
                          }
                          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          ส่งเข้า 3DS
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenQrInstall({
                              fileName: srvFile.fileName,
                              sizeBytes: srvFile.sizeBytes,
                              titleId: srvFile.titleId,
                            })
                          }
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          QR
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right 5 Cols: Ready-to-Send 3DS Game Patches & Homebrew Packages */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              2. แพ็กเกจเกมและ Homebrew ยอดนิยมพร้อมส่งด่วน
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ทดสอบส่งไฟล์เข้าการ์ด SD ผ่าน Wi-Fi หรือเปิด QR Code เพื่อสแกนติดตั้งผ่าน FBI ได้ในคลิกเดียว
            </p>
          </div>

          <div className="divide-y divide-slate-200">
            {QUICK_SAMPLE_PACKAGES.map((pkg) => {
              const route = detectGameFileFormat(pkg.fileName);
              const badgeIcon = generateFallbackBadgeIcon(
                pkg.titleId || pkg.fileName,
                route.category === '3dsx' ? '3dsx' : route.category === 'nds' ? 'nds' : 'cia'
              );
              return (
                <div key={pkg.id} className="py-4 first:pt-1 last:pb-1 space-y-2">
                  <div className="flex items-start gap-3">
                    <img
                      src={badgeIcon}
                      alt={pkg.title}
                      className="h-10 w-10 rounded-lg border border-slate-200 shrink-0 mt-0.5"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900">{pkg.title}</h3>
                      <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        {pkg.productCode} · {pkg.version} · {formatBytes(pkg.sizeBytes)} · sdmc:{route.targetDirectory}
                      </p>
                      <p className="text-xs text-slate-600 mt-1">{pkg.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleQuickSendPackage(pkg)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap"
                    >
                      <Wifi className="h-3.5 w-3.5" />
                      ส่งเข้า 3DS ({route.targetDirectory})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenQrInstall({
                          fileName: pkg.fileName,
                          sizeBytes: pkg.sizeBytes,
                          titleId: pkg.titleId,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      QR / FBI Remote
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Active & Recent Wi-Fi Transfer Queue with Real-Time Progress */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              คิวการโอนย้ายไฟล์ผ่าน Wi-Fi แบบเรียลไทม์ (FTPD & FBI Stream Queue)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              แสดงความเร็วโอนย้าย เวลาที่เหลือ (ETA) และบันทึกลงในโครงสร้างการ์ด microSD ของเครื่อง 3DS
            </p>
          </div>
          {transferQueue.some((t) => t.status === 'completed') && (
            <button
              type="button"
              onClick={onClearCompletedTransfers}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap"
            >
              ล้างประวัติที่เสร็จแล้ว
            </button>
          )}
        </div>

        {transferQueue.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-slate-700">ยังไม่มีรายการโอนย้ายไฟล์ในขณะนี้</p>
            <p className="mt-1 text-xs text-slate-500">
              เลือกไฟล์เกมด้านบน หรือกดปุ่ม &ldquo;ส่งเข้า 3DS&rdquo; จากแพ็กเกจตัวอย่างเพื่อเริ่มโอนย้ายผ่าน Wi-Fi
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-200">
            {transferQueue.map((item) => (
              <div key={item.id} className="py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 flex items-center gap-3">
                  {item.iconDataUrl && (
                    <img
                      src={item.iconDataUrl}
                      alt={item.fileName}
                      className="h-9 w-9 rounded-lg border border-slate-200 shrink-0"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {item.status === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : item.status === 'failed' ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                      ) : (
                        <Loader2 className="h-4 w-4 shrink-0 text-rose-600 animate-spin" />
                      )}
                      <p className="text-sm font-semibold text-slate-900 truncate">{item.fileName}</p>
                      {item.productCode && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                          {item.productCode}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
                      {formatBytes(item.sizeBytes)} · ปลายทาง sdmc:{item.targetDirectory} · {item.protocolHint} ·{' '}
                      {item.status === 'completed'
                        ? `ส่งสำเร็จเมื่อ ${item.completedAt}`
                        : item.status === 'failed'
                        ? 'การส่งข้อมูลล้มเหลว'
                        : `กำลังส่ง ${item.speedMbps.toFixed(2)} MB/s (${item.progress}% · เหลือ ~${
                            item.etaSeconds ?? 1
                          } วินาที)`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 sm:w-64 shrink-0">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      style={{ width: `${item.progress}%` }}
                      className={`h-full transition-all duration-150 ${
                        item.status === 'completed'
                          ? 'bg-emerald-600'
                          : item.status === 'failed'
                          ? 'bg-red-600'
                          : 'bg-rose-600'
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateToExplorer(item.targetDirectory)}
                    className="text-xs font-semibold text-rose-600 hover:text-rose-700 whitespace-nowrap"
                  >
                    ดูในโฟลเดอร์
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
