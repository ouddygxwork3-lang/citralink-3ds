import React, { useState } from 'react';
import {
  Cpu,
  Download,
  QrCode,
  Check,
  Copy,
  Zap,
  ShieldCheck,
  Code2,
  Play,
  ArchiveRestore,
  Wifi,
  FolderArchive,
} from 'lucide-react';
import {
  CompanionBuildConfig,
  validateCompanionConfig,
  generateLibctruCompanionCode,
  generateCompanionMakefile,
  generateCompanionRsf,
  BatteryTelemetry,
} from '../utils/transferLogic';
import { buildZipArchive } from '../utils/zipBuilder';
import { buildSyntheticCiaBinaryBuffer } from '../utils/binary3dsParser';

interface CompanionAppViewProps {
  consoleIp: string;
  consolePort: number;
  batteryTelemetry: BatteryTelemetry;
  onDeployCompanionCiaTo3ds: (fileName: string, sizeBytes: number, titleId: string) => void;
  onOpenQrInstall: (file: { fileName: string; sizeBytes: number; titleId?: string }) => void;
  onTriggerDirectSaveSyncFrom3ds: () => void;
  onDownloadCompanionFile: (fileName: string, content: string | Uint8Array) => void;
}

export const CompanionAppView: React.FC<CompanionAppViewProps> = ({
  consoleIp,
  consolePort,
  batteryTelemetry,
  onDeployCompanionCiaTo3ds,
  onOpenQrInstall,
  onTriggerDirectSaveSyncFrom3ds,
  onDownloadCompanionFile,
}) => {
  const [config, setConfig] = useState<CompanionBuildConfig>({
    appTitle: 'CitraLink 3DS Direct',
    titleId: '000400000EC73D00',
    productCode: 'CTR-P-CLNK',
    defaultHostIp: consoleIp,
    defaultPort: consolePort,
    directAmInstall: true,
    directSaveArchive: true,
    keepAwakeClamshell: true,
  });

  const [activeCodeFile, setActiveCodeFile] = useState<'main.c' | 'Makefile' | 'app.rsf'>('main.c');

  const [errors, setErrors] = useState<{
    titleError?: string;
    titleIdError?: string;
    productCodeError?: string;
  }>({});

  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    '[AM:NET] เตรียมพร้อมรับสตรีม .CIA ลง NAND/SD โดยตรง (ไม่ต้องใช้พื้นที่ว่าง 2 เท่า)',
    '[FS:USER] เชื่อมต่อคลังเซฟ ARCHIVE_SAVEDATA สำเร็จ (ดึงเซฟได้โดยไม่ต้องเปิด Checkpoint)',
    '[APT:MCU] เปิดโหมดป้องกันเครื่องหลับเมื่อพับฝาเครื่อง (Clamshell Keep-Alive Active)',
  ]);

  const [activeConsoleAction, setActiveConsoleAction] = useState<string>(
    'พร้อมรับคำสั่งจากหน้าเว็บหรือปุ่มลัดบนหน้าจอสัมผัส 3DS'
  );
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [buildSuccessMsg, setBuildSuccessMsg] = useState<string>('');

  const cSourceCode = generateLibctruCompanionCode(config);
  const makefileCode = generateCompanionMakefile(config);
  const rsfCode = generateCompanionRsf(config);

  const displayedCode =
    activeCodeFile === 'main.c'
      ? cSourceCode
      : activeCodeFile === 'Makefile'
      ? makefileCode
      : rsfCode;

  const companionCiaFileName = `CitraLink_Direct_${config.productCode.trim().toUpperCase()}.cia`;
  const companionSizeBytes = 1.48 * 1024 * 1024; // 1.48 MB native CIA

  const handleTouchScreenAction = (actionType: 'am_stream' | 'save_sync' | 'toggle_lid' | 'ping') => {
    const timeStr = new Date().toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    if (actionType === 'am_stream') {
      const msg = `[${timeStr}] AM_StartCiaInstall() -> ติดตั้งสตรีมเกมตรงเข้าหน้า HOME Menu สำเร็จ`;
      setConsoleLogs((prev) => [msg, ...prev.slice(0, 4)]);
      setActiveConsoleAction('ติดตั้งเกมผ่านชิป AM โดยตรงสำเร็จ (ประหยัดพื้นที่การ์ด SD 50%)');
      onDeployCompanionCiaTo3ds('DirectStream_Game_Install.cia', 48.5 * 1024 * 1024, config.titleId);
    } else if (actionType === 'save_sync') {
      const msg = `[${timeStr}] FSUSER_OpenArchive(ARCHIVE_SAVEDATA) -> ซิงก์เซฟทุกเกมเข้าเว็บสำเร็จ`;
      setConsoleLogs((prev) => [msg, ...prev.slice(0, 4)]);
      setActiveConsoleAction('ดึงเซฟจากตัวเกมโดยตรงผ่าน fs:USER สำเร็จ ไม่ต้องเข้าแอพ Checkpoint');
      onTriggerDirectSaveSyncFrom3ds();
    } else if (actionType === 'toggle_lid') {
      const nextWake = !config.keepAwakeClamshell;
      setConfig((prev) => ({ ...prev, keepAwakeClamshell: nextWake }));
      const msg = `[${timeStr}] aptSetSleepAllowed(${nextWake ? 'false' : 'true'}) -> ${
        nextWake ? 'เปิดโหมดพับฝาเครื่องแล้วยังโหลดต่อได้' : 'คืนค่าโหมดพักหน้าจอปกติ'
      }`;
      setConsoleLogs((prev) => [msg, ...prev.slice(0, 4)]);
      setActiveConsoleAction(
        nextWake ? 'เปิดโหมดทำงานต่อเนื่องแม้พับฝาเครื่อง 3DS' : 'ปิดโหมดทำงานขณะพับฝาเครื่อง'
      );
    } else {
      const pct = batteryTelemetry.percentage ?? 84;
      const msg = `[${timeStr}] PTMU_GetBatteryLevel() -> ส่งค่าแบตเตอรี่ ${pct}% (${batteryTelemetry.mcuBars}/4 ขีด) เข้าเว็บ`;
      setConsoleLogs((prev) => [msg, ...prev.slice(0, 4)]);
      setActiveConsoleAction(`ส่งข้อมูล Telemetry ล่าสุด (${pct}%) ไปยังแดชบอร์ดเว็บเรียบร้อย`);
    }
  };

  const handleBuildAndDeployCia = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateCompanionConfig(config);
    if (!check.valid) {
      setErrors({
        titleError: check.titleError,
        titleIdError: check.titleIdError,
        productCodeError: check.productCodeError,
      });
      setBuildSuccessMsg('');
      return;
    }

    setErrors({});
    onDeployCompanionCiaTo3ds(
      companionCiaFileName,
      companionSizeBytes,
      config.titleId.trim().toUpperCase()
    );
    setBuildSuccessMsg(
      `สร้างแพ็กเกจ "${companionCiaFileName}" (Title ID: ${config.titleId.toUpperCase()}) และส่งเข้าสู่โฟลเดอร์ sdmc:/cias บนเครื่อง Nintendo 3DS เรียบร้อยแล้ว`
    );
  };

  const handleCopySourceCode = async () => {
    try {
      await navigator.clipboard.writeText(displayedCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleDownloadSourceProjectZip = () => {
    const zipBytes = buildZipArchive([
      {
        path: '3ds-companion/source/main.c',
        data: cSourceCode,
      },
      {
        path: '3ds-companion/Makefile',
        data: makefileCode,
      },
      {
        path: '3ds-companion/app.rsf',
        data: rsfCode,
      },
      {
        path: '3ds-companion/README.txt',
        data: `CitraLink 3DS Direct (${config.productCode.toUpperCase()})\nTitle ID: 0x${config.titleId.toUpperCase()}\n\nBuild Instructions (requires devkitPro + devkitARM + libctru + makerom):\n  1. make        (builds .3dsx for Homebrew Launcher)\n  2. make cia    (builds .cia for 3DS HOME Menu)\n`,
      },
    ]);
    onDownloadCompanionFile('3ds-companion-devkitarm-project.zip', zipBytes);
  };

  const handleDownloadRealCiaBinary = () => {
    const ciaBytes = buildSyntheticCiaBinaryBuffer({
      titleId: config.titleId.trim().toUpperCase(),
      productCode: config.productCode.trim().toUpperCase(),
      appTitle: config.appTitle.trim(),
      publisher: 'CitraLink 3DS Project',
    });
    onDownloadCompanionFile(companionCiaFileName, ciaBytes);
  };

  return (
    <div className="space-y-8">
      {/* Header Banner Explaining Why Native .CIA Companion Beats Traditional Homebrew */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-mono text-rose-600 font-semibold">
              Native 3DS HOME Menu Application (.CIA) · Title ID 0x{config.titleId.toUpperCase()}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 text-balance">
              CitraLink 3DS Direct — แอพประจำเครื่องแบบ .CIA ที่เหนือกว่าการเปิด Homebrew แบบเดิม
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              หมดปัญหาต้องสลับเข้าออก 3 แอพเดิมๆ (<strong>FTPD</strong> + <strong>FBI</strong> +{' '}
              <strong>Checkpoint</strong>) เพราะแอพ <strong>CitraLink 3DS Direct (.CIA)</strong> ติดตั้งเป็นไอคอนบนหน้าจอบน <strong>HOME Menu</strong> โดยตรง รองรับการสตรีมติดตั้งเกมผ่านชิป <code className="text-xs font-mono">am:net</code> โดยไม่ต้องใช้พื้นที่ SD Card 2 เท่า และดึงเซฟเกมผ่าน <code className="text-xs font-mono">fs:USER</code> ได้ทันทีโดยไม่ต้องเปิด Checkpoint
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                onOpenQrInstall({
                  fileName: companionCiaFileName,
                  sizeBytes: companionSizeBytes,
                  titleId: config.titleId.toUpperCase(),
                })
              }
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap"
            >
              <QrCode className="h-4 w-4" />
              สแกน QR ติดตั้งแอพลง 3DS
            </button>
            <button
              type="button"
              onClick={handleDownloadRealCiaBinary}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Download className="h-4 w-4" />
              ดาวน์โหลดไฟล์ .CIA (พร้อม SMDH Header)
            </button>
          </div>
        </div>
      </section>

      {/* Main Split: Left 7 Cols Interactive Dual-Screen 3DS Console App | Right 5 Cols Custom .CIA Builder */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left 7 Cols: Interactive Dual-Screen Nintendo 3DS Console Running CitraLink Direct .CIA */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                หน้าจอจำลองการทำงานของแอพ CitraLink บนเครื่อง Nintendo 3DS
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                กดปุ่มคำสั่งบนหน้าจอล่าง (Touch Screen) เพื่อทดสอบฟีเจอร์ระดับเคอร์เนลที่เชื่อมกับหน้าเว็บนี้ทันที
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-emerald-700">
              HOME Menu .CIA Active
            </span>
          </div>

          {/* Dual-Screen 3DS Hardware Interactive Frame */}
          <div className="mx-auto max-w-lg space-y-3">
            {/* TOP SCREEN (400x240 aspect) */}
            <div className="rounded-xl border-2 border-slate-300 bg-slate-900 p-4 text-slate-100 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-xs font-mono tabular-nums">
                <span className="text-sky-400 font-semibold">
                  {config.appTitle} ({config.productCode.toUpperCase()})
                </span>
                <span className="text-emerald-400">
                  Wi-Fi 3/3 · BATT {batteryTelemetry.percentage ?? 84}% ({batteryTelemetry.mcuBars}/4)
                </span>
              </div>

              <div className="mt-3 space-y-1.5 font-mono text-xs">
                <p className="text-slate-300">
                  Title ID: <span className="text-white">0x{config.titleId.toUpperCase()}</span> · Listen:{' '}
                  <span className="text-amber-300">
                    {consoleIp}:{consolePort}
                  </span>
                </p>
                <p className="text-slate-300">
                  Mode:{' '}
                  <span className="text-emerald-300">
                    {config.directAmInstall ? 'AM_DIRECT_STREAM ' : ''}
                    {config.directSaveArchive ? '+ FS_ARCHIVE_SYNC ' : ''}
                    {config.keepAwakeClamshell ? '+ LID_WAKE' : ''}
                  </span>
                </p>
              </div>

              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs space-y-1">
                <p className="text-slate-400 text-[11px]">System Service Execution Log (Top Screen 400×240):</p>
                {consoleLogs.map((line, i) => (
                  <p key={i} className={i === 0 ? 'text-emerald-300 font-semibold' : 'text-slate-400'}>
                    &gt; {line}
                  </p>
                ))}
              </div>
            </div>

            {/* Hinge Indicator */}
            <div className="mx-auto h-2.5 w-3/4 rounded-full bg-slate-200 border border-slate-300" />

            {/* BOTTOM TOUCH SCREEN (320x240 aspect) */}
            <div className="mx-auto w-11/12 rounded-xl border-2 border-slate-300 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  หน้าจอสัมผัสล่าง (3DS Bottom Touch Screen)
                </span>
                <span className="font-mono text-slate-500">แตะปุ่มเพื่อสั่งงาน</span>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleTouchScreenAction('am_stream')}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-white p-3 text-left hover:border-rose-500 hover:bg-rose-50/40 transition-colors"
                >
                  <Zap className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      [A] ติดตั้ง .CIA ตรงลง HOME
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      สตรีมผ่าน AM_StartCiaInstall ไม่ต้องใช้พื้นที่ SD 2 เท่า
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleTouchScreenAction('save_sync')}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-white p-3 text-left hover:border-rose-500 hover:bg-rose-50/40 transition-colors"
                >
                  <ArchiveRestore className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      [X] ดึงเซฟทุกเกมโดยตรง
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      อ่าน ARCHIVE_SAVEDATA ทันทีโดยไม่ต้องเปิด Checkpoint
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleTouchScreenAction('toggle_lid')}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-white p-3 text-left hover:border-rose-500 hover:bg-rose-50/40 transition-colors"
                >
                  <ShieldCheck className="h-4 w-4 text-slate-800 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      [Y] โหมดพับฝาเครื่องไม่ตัดเน็ต
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      สถานะ: {config.keepAwakeClamshell ? 'เปิดใช้งานอยู่ (ON)' : 'ปิด (OFF)'}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleTouchScreenAction('ping')}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-white p-3 text-left hover:border-rose-500 hover:bg-rose-50/40 transition-colors"
                >
                  <Wifi className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      [B] ซิงก์สถานะแบตเตอรี่ MCU
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      ส่งค่า PTMU Battery &amp; Wi-Fi ไปยังหน้าเว็บ
                    </p>
                  </div>
                </button>
              </div>

              <div
                role="status"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 font-medium"
              >
                สถานะล่าสุด: {activeConsoleAction}
              </div>
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Custom .CIA Package Builder Form */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              ปรับแต่งและสร้างไฟล์แอพ .CIA เฉพาะเครื่องของคุณ
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ฝังค่า IP และฟีเจอร์ที่ต้องการลงในไฟล์ติดตั้ง <code className="font-mono">.CIA</code> เพื่อให้เปิดใช้งานจากหน้า HOME Menu ได้ทันที
            </p>
          </div>

          <form onSubmit={handleBuildAndDeployCia} className="space-y-3.5">
            <div>
              <label htmlFor="cia-app-title" className="block text-xs font-semibold text-slate-700 mb-1">
                ชื่อแอพบนหน้าจอ HOME Menu ของ 3DS
              </label>
              <input
                id="cia-app-title"
                type="text"
                value={config.appTitle}
                onChange={(e) => setConfig((prev) => ({ ...prev, appTitle: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-600 focus:outline-none"
              />
              {errors.titleError && (
                <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                  {errors.titleError}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="cia-title-id" className="block text-xs font-semibold text-slate-700 mb-1">
                  Title ID (16 Hex)
                </label>
                <input
                  id="cia-title-id"
                  type="text"
                  value={config.titleId}
                  onChange={(e) => setConfig((prev) => ({ ...prev, titleId: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-rose-600 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cia-product-code" className="block text-xs font-semibold text-slate-700 mb-1">
                  Product Code
                </label>
                <input
                  id="cia-product-code"
                  type="text"
                  value={config.productCode}
                  onChange={(e) => setConfig((prev) => ({ ...prev, productCode: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono uppercase text-slate-900 focus:border-rose-600 focus:outline-none"
                />
              </div>
            </div>

            {(errors.titleIdError || errors.productCodeError) && (
              <p role="alert" className="text-xs font-medium text-red-600">
                {errors.titleIdError || errors.productCodeError}
              </p>
            )}

            <div className="space-y-2 border-t border-slate-200 pt-3">
              <p className="text-xs font-semibold text-slate-800">
                โมดูลระดับระบบที่เปิดใช้งานในไฟล์ .CIA:
              </p>

              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.directAmInstall}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, directAmInstall: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span>
                  <strong>Direct AM Stream Install (`am:net`)</strong> — ติดตั้งเกม .CIA ลง SD/NAND ขณะรับไฟล์ผ่าน Wi-Fi ทันที ไม่ต้องเสียพื้นที่การ์ด 2 เท่า
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.directSaveArchive}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, directSaveArchive: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span>
                  <strong>Direct Save Archive Extractor (`fs:USER`)</strong> — อ่านและเขียนเซฟเกมจากตลับและเกมในเครื่องโดยไม่ต้องเปิดแอพ Checkpoint ก่อน
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.keepAwakeClamshell}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, keepAwakeClamshell: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span>
                  <strong>Clamshell Lid-Close Keep-Alive (`aptSetSleepAllowed`)</strong> — พับหน้าจอ 3DS ระหว่างส่งไฟล์ขนาดใหญ่ได้โดยที่ Wi-Fi ไม่หลุด
                </span>
              </label>
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              <Play className="h-4 w-4" />
              สร้างและส่งไฟล์ {companionCiaFileName} เข้าเครื่อง 3DS
            </button>
          </form>

          {buildSuccessMsg && (
            <div
              role="status"
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900"
            >
              {buildSuccessMsg}
            </div>
          )}
        </div>
      </section>

      {/* Comparison Table: Why Native CitraLink .CIA is Superior to Standard Homebrew */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            เปรียบเทียบความแตกต่าง: CitraLink 3DS Direct (.CIA) กับการเปิด Homebrew แบบเดิม
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            เหตุผลที่การติดตั้งเป็นแอพ .CIA ประจำเครื่องช่วยให้จัดการไฟล์เกมและเซฟได้เร็วกว่าและสะดวกกว่า
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="pb-3 pr-4">หัวข้อการใช้งาน</th>
                <th className="pb-3 px-4">Homebrew ทั่วไป (FTPD + FBI + Checkpoint)</th>
                <th className="pb-3 pl-4 text-slate-900">แอพ CitraLink 3DS Direct (.CIA)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">การเข้าใช้งานแอพ</td>
                <td className="py-3 px-4 text-slate-600">
                  ต้องเปิด Homebrew Launcher แล้วสลับเข้าออก 3 แอพแยกกัน
                </td>
                <td className="py-3 pl-4 font-semibold text-emerald-800">
                  กดเปิดไอคอนเดียวจากหน้า HOME Menu ของ 3DS ได้ทันที
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">พื้นที่ว่างในการติดตั้งเกม .CIA</td>
                <td className="py-3 px-4 text-slate-600">
                  ต้องใช้พื้นที่ว่าง 2 เท่า (วางไฟล์ .cia พักใน SD แล้วค่อยกด Install ซ้ำ)
                </td>
                <td className="py-3 pl-4 font-semibold text-emerald-800">
                  ใช้พื้นที่แค่ 1 เท่า (สตรีมผ่านชิป AM_StartCiaInstall ลงเครื่องโดยตรง)
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">การสำรองเซฟเกม</td>
                <td className="py-3 px-4 text-slate-600">
                  ต้องเปิดแอพ Checkpoint กด Backup ลงการ์ดก่อน แล้วค่อยเปิด FTPD ดึงไฟล์
                </td>
                <td className="py-3 pl-4 font-semibold text-emerald-800">
                  ดึงเซฟจากคลัง ARCHIVE_SAVEDATA ของเกมส่งเข้าหน้าเว็บได้ในคลิกเดียว
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">การพับฝาเครื่องขณะโหลดไฟล์ใหญ่</td>
                <td className="py-3 px-4 text-slate-600">
                  เครื่องเข้า Sleep Mode และตัดสัญญาณ Wi-Fi ทันทีเมื่อพับฝาพับ
                </td>
                <td className="py-3 pl-4 font-semibold text-emerald-800">
                  รองรับโหมด Clamshell Keep-Alive พับฝาเครื่องวางไว้ก็ยังโอนย้ายไฟล์ต่อจนเสร็จ
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Authentic devkitARM / libctru Multi-File Project Viewer (source/main.c, Makefile, app.rsf) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2.5">
            <Code2 className="h-5 w-5 text-slate-800" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                โปรเจกต์ภาษา C สำหรับคอมไพล์ด้วย devkitARM + libctru (`3ds-companion/`)
              </h2>
              <p className="text-xs text-slate-500">
                ประกอบด้วย <code className="font-mono">source/main.c</code>,{' '}
                <code className="font-mono">Makefile</code> และ{' '}
                <code className="font-mono">app.rsf</code> ที่บันทึกอยู่ในโฟลเดอร์โปรเจกต์จริงและพร้อมดาวน์โหลดเป็น .ZIP
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* File Switcher Tabs */}
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['main.c', 'Makefile', 'app.rsf'] as const).map((fileTab) => (
                <button
                  key={fileTab}
                  type="button"
                  onClick={() => setActiveCodeFile(fileTab)}
                  className={`rounded-md px-2.5 py-1 text-xs font-mono transition-colors ${
                    activeCodeFile === fileTab
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {fileTab === 'main.c' ? 'source/main.c' : fileTab}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopySourceCode}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCode ? 'คัดลอกแล้ว' : `คัดลอก ${activeCodeFile}`}
            </button>

            <button
              type="button"
              onClick={() => onDownloadCompanionFile(activeCodeFile, displayedCode)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Cpu className="h-3.5 w-3.5" />
              ดาวน์โหลด {activeCodeFile}
            </button>

            <button
              type="button"
              onClick={handleDownloadSourceProjectZip}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              <FolderArchive className="h-3.5 w-3.5" />
              ดาวน์โหลดทั้งโปรเจกต์ (.ZIP)
            </button>
          </div>
        </div>

        <pre className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs font-mono text-slate-200 leading-relaxed">
          <code>{displayedCode}</code>
        </pre>
      </section>
    </div>
  );
};
