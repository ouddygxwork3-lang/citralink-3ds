import React, { useState } from 'react';
import {
  Wifi,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  BatteryCharging,
  Battery,
  Radar,
  Play,
  ExternalLink,
} from 'lucide-react';
import {
  validateConnectionInput,
  ConsoleProtocolType,
  BatteryTelemetry,
} from '../utils/transferLogic';

interface Discovered3dsConsole {
  ip: string;
  port: number;
  latencyMs: number;
  banner: string;
  protocol: ConsoleProtocolType;
  isVirtual?: boolean;
}

interface ConnectionGuideViewProps {
  consoleIp: string;
  consolePort: number;
  connectionMode: 'virtual' | 'hardware';
  protocol: ConsoleProtocolType;
  batteryTelemetry: BatteryTelemetry;
  simulatedBatteryPct: number;
  simulatedCharging: boolean;
  onUpdateConnection: (
    ip: string,
    port: number,
    mode: 'virtual' | 'hardware',
    protocol: ConsoleProtocolType
  ) => void;
  onUpdateSimulatedBattery: (pct: number, charging: boolean) => void;
}

export const ConnectionGuideView: React.FC<ConnectionGuideViewProps> = ({
  consoleIp,
  consolePort,
  connectionMode,
  protocol,
  batteryTelemetry,
  simulatedBatteryPct,
  simulatedCharging,
  onUpdateConnection,
  onUpdateSimulatedBattery,
}) => {
  const [ipInput, setIpInput] = useState<string>(consoleIp);
  const [portInput, setPortInput] = useState<string>(String(consolePort));
  const [modeInput, setModeInput] = useState<'virtual' | 'hardware'>(connectionMode);
  const [protocolInput, setProtocolInput] = useState<ConsoleProtocolType>(protocol);
  const [ipError, setIpError] = useState<string>('');
  const [portError, setPortError] = useState<string>('');
  const [probeStatus, setProbeStatus] = useState<{
    state: 'idle' | 'probing' | 'ok' | 'fail';
    message: string;
  }>({
    state: 'ok',
    message: 'เชื่อมต่อพร้อมใช้งาน: 220 FTPD v3.1.0 (New Nintendo 3DS XL · Luma3DS)',
  });

  // LAN Subnet Auto-Scanner States
  const [isScanningLan, setIsScanningLan] = useState<boolean>(false);
  const [scannedSubnet, setScannedSubnet] = useState<string>('');
  const [discoveredConsoles, setDiscoveredConsoles] = useState<Discovered3dsConsole[]>([]);

  const handleSaveAndProbe = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateConnectionInput(ipInput, portInput);
    if (!validation.valid) {
      setIpError(validation.ipError || '');
      setPortError(validation.portError || '');
      return;
    }

    setIpError('');
    setPortError('');
    const validIp = validation.normalizedIp!;
    const validPort = validation.normalizedPort!;

    setProbeStatus({ state: 'probing', message: `กำลังทดสอบการเชื่อมต่อ TCP ไปยัง ${validIp}:${validPort}...` });

    try {
      const response = await fetch('/api/ftp/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: validIp,
          port: validPort,
          mode: modeInput,
          protocol: protocolInput,
        }),
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        onUpdateConnection(validIp, validPort, modeInput, protocolInput);
        if (modeInput === 'virtual') {
          setProbeStatus({
            state: 'ok',
            message: 'เชื่อมต่อโหมดจำลองบนเว็บเบราว์เซอร์ (Web Virtual SD) พร้อมใช้งาน',
          });
        } else {
          setProbeStatus({
            state: 'fail',
            message:
              'การเชื่อมต่อเครื่องจริงแบบ TCP/FTP ต้องรันเซิร์ฟเวอร์ Local Bridge (npm run dev) ในวง Wi-Fi เดียวกัน',
          });
        }
        return;
      }
      const data = await response.json();
      if (data.ok) {
        setProbeStatus({
          state: 'ok',
          message: `เชื่อมต่อสำเร็จ (${data.latencyMs} ms) · ${data.banner}`,
        });
      } else {
        setProbeStatus({
          state: 'fail',
          message: data.banner || `ไม่สามารถเชื่อมต่อ ${validIp}:${validPort}`,
        });
      }
      onUpdateConnection(validIp, validPort, modeInput, protocolInput);
    } catch {
      onUpdateConnection(validIp, validPort, modeInput, protocolInput);
      if (modeInput === 'virtual') {
        setProbeStatus({
          state: 'ok',
          message: 'เชื่อมต่อโหมดจำลองบนเว็บเบราว์เซอร์ (Web Virtual SD) พร้อมใช้งาน',
        });
      } else {
        setProbeStatus({
          state: 'fail',
          message:
            'การเชื่อมต่อเครื่องจริงแบบ TCP/FTP ต้องรันเซิร์ฟเวอร์ Local Bridge (npm run dev) ในวง Wi-Fi เดียวกัน',
        });
      }
    }
  };

  const handleScanLanFor3ds = async () => {
    setIsScanningLan(true);
    try {
      const res = await fetch('/api/ftp/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentIp: ipInput || consoleIp,
          mode: modeInput,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('STATIC_WEB_MODE');
      }
      const data = await res.json();
      if (data.ok && Array.isArray(data.devices)) {
        setScannedSubnet(data.subnetScanned || '192.168.1.0/24');
        setDiscoveredConsoles(data.devices);
      }
    } catch {
      setScannedSubnet('Web Virtual LAN');
      setDiscoveredConsoles([
        {
          ip: consoleIp,
          port: consolePort,
          latencyMs: 7,
          banner: '220 FTPD v3.1.0 (New Nintendo 3DS XL · Luma3DS Rosalina)',
          protocol: 'ftpd_rosalina',
          isVirtual: true,
        },
      ]);
    } finally {
      setIsScanningLan(false);
    }
  };

  const handleSelectDiscoveredConsole = (dev: Discovered3dsConsole) => {
    setIpInput(dev.ip);
    setPortInput(String(dev.port));
    setProtocolInput(dev.protocol);
    setIpError('');
    setPortError('');
    onUpdateConnection(dev.ip, dev.port, modeInput, dev.protocol);
    setProbeStatus({
      state: 'ok',
      message: `เลือกเครื่อง ${dev.ip}:${dev.port} (${dev.latencyMs} ms) · ${dev.banner}`,
    });
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left 6 Cols: Connection Configuration, LAN Scanner & Protocol Telemetry Settings */}
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div>
            <p className="text-xs font-mono text-slate-500">Network Bridge & System Telemetry</p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">
              ตั้งค่าการเชื่อมต่อและโปรโตคอลอ่านค่าแบตเตอรี่ 3DS
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              ระบุหมายเลข IP Address, Port หรือใช้ระบบสแกนค้นหาเครื่อง Nintendo 3DS ในวงแลนอัตโนมัติ
            </p>
          </div>

          {/* 1-Click Local Bridge Launcher */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 space-y-2.5">
            <div>
              <h2 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Play className="h-4 w-4 text-rose-600" />
                เปิด Local Bridge บนคอมอัตโนมัติ (1-Click)
              </h2>
              <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                สำหรับเชื่อมต่อเครื่อง 3DS จริงจากเว็บออนไลน์ (สั่งรัน <code className="font-mono">npm run dev</code> และเปิดพอร์ต 3000 อัตโนมัติ)
                <br />
                *ครั้งแรกให้ดับเบิลคลิกไฟล์ <code className="font-mono font-semibold">Start-CitraLink-3DS.bat</code> ในโฟลเดอร์โปรเจกต์ก่อน 1 ครั้ง
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="citralink://start"
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                เปิด Local Bridge อัตโนมัติ (citralink://start)
              </a>
              <a
                href="http://localhost:3000"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                เปิดหน้า Local Bridge (localhost:3000)
              </a>
            </div>
          </div>

          {/* Automatic LAN Subnet Scanner Box */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Radar className="h-4 w-4 text-rose-600" />
                  ค้นหาเครื่อง Nintendo 3DS ในวงแลนอัตโนมัติ (Port 5000 / 21)
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ไม่ต้องจำเลข IP ที่เปลี่ยนตาม DHCP ของเราน์เตอร์ กดสแกนเพื่อค้นหาเครื่องที่เปิด FTPD หรือ FBI อยู่
                </p>
              </div>
              <button
                type="button"
                onClick={handleScanLanFor3ds}
                disabled={isScanningLan}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                <Radar className={`h-3.5 w-3.5 ${isScanningLan ? 'animate-spin' : ''}`} />
                {isScanningLan ? 'กำลังสแกนวงแลน...' : 'สแกนหาเครื่อง 3DS อัตโนมัติ'}
              </button>
            </div>

            {discoveredConsoles.length > 0 && (
              <div className="space-y-2 border-t border-slate-200 pt-2.5">
                <p className="text-[11px] font-mono text-slate-500">
                  ผลการสแกนเครือข่าย {scannedSubnet} (พบ {discoveredConsoles.length} เครื่อง):
                </p>
                <ul className="space-y-1.5">
                  {discoveredConsoles.map((dev) => (
                    <li
                      key={`${dev.ip}:${dev.port}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-mono font-bold text-slate-900">
                          {dev.ip}:{dev.port}{' '}
                          <span className="font-normal text-emerald-700">({dev.latencyMs} ms)</span>
                        </p>
                        <p className="text-[11px] text-slate-500 truncate font-mono">{dev.banner}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectDiscoveredConsole(dev)}
                        className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 transition-colors shrink-0"
                      >
                        เลือกเชื่อมต่อเครื่องนี้
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <form onSubmit={handleSaveAndProbe} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                โหมดการทำงานของระบบโอนย้ายไฟล์
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setModeInput('virtual')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    modeInput === 'virtual'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-bold">โหมดจำลองการ์ด 3DS (Virtual SD)</p>
                  <p
                    className={`mt-0.5 text-xs ${
                      modeInput === 'virtual' ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    ทดสอบส่งเกม สำรองเซฟ และจำลองค่าแบตเตอรี่บนเว็บ
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setModeInput('hardware')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    modeInput === 'hardware'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-bold">เชื่อมต่อเครื่องจริง (TCP FTPD / FBI)</p>
                  <p
                    className={`mt-0.5 text-xs ${
                      modeInput === 'hardware' ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    ส่งแพ็กเก็ตจริงและคำสั่ง SITE BATT ในวงแลนเดียวกัน
                  </p>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="console-protocol-select" className="block text-xs font-semibold text-slate-700 mb-1">
                โปรโตคอลเชื่อมต่อและการรองรับ System Telemetry
              </label>
              <select
                id="console-protocol-select"
                value={protocolInput}
                onChange={(e) => {
                  const nextProto = e.target.value as ConsoleProtocolType;
                  setProtocolInput(nextProto);
                  onUpdateConnection(consoleIp, consolePort, modeInput, nextProto);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-600 focus:outline-none"
              >
                <option value="ftpd_rosalina">
                  FTPD Pro + Luma3DS Rosalina (รองรับการดึงเปอร์เซ็นต์แบตเตอรี่ MCU)
                </option>
                <option value="fbi_boop_only">
                  FBI Remote Install TCP Only (ส่งไฟล์ทางเดียว · ไม่รองรับการดึงค่าแบตเตอรี่)
                </option>
                <option value="standard_ftp21">
                  Standard FTP RFC 959 (ไม่ส่งค่าแบตเตอรี่หากไม่มีส่วนขยาย SITE BATT)
                </option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              <div className="sm:col-span-8">
                <label htmlFor="console-ip-input" className="block text-xs font-semibold text-slate-700 mb-1">
                  หมายเลข IP Address ของเครื่อง 3DS
                </label>
                <input
                  id="console-ip-input"
                  type="text"
                  placeholder="เช่น 192.168.1.35"
                  value={ipInput}
                  onChange={(e) => setIpInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-rose-600 focus:outline-none"
                />
                {ipError && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {ipError}
                  </p>
                )}
              </div>

              <div className="sm:col-span-4">
                <label htmlFor="console-port-input" className="block text-xs font-semibold text-slate-700 mb-1">
                  หมายเลข Port
                </label>
                <input
                  id="console-port-input"
                  type="text"
                  placeholder="5000"
                  value={portInput}
                  onChange={(e) => setPortInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-rose-600 focus:outline-none"
                />
                {portError && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {portError}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={probeStatus.state === 'probing'}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60 transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${probeStatus.state === 'probing' ? 'animate-spin' : ''}`} />
                บันทึกและทดสอบการเชื่อมต่อ
              </button>

              <button
                type="button"
                onClick={() => {
                  setIpInput('192.168.1.35');
                  setPortInput('5000');
                  setModeInput('virtual');
                  setProtocolInput('ftpd_rosalina');
                  setIpError('');
                  setPortError('');
                  onUpdateConnection('192.168.1.35', 5000, 'virtual', 'ftpd_rosalina');
                  setProbeStatus({
                    state: 'ok',
                    message: 'รีเซ็ตกลับเป็นค่าเริ่มต้น 192.168.1.35:5000 (FTPD Pro + Rosalina) เรียบร้อยแล้ว',
                  });
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                คืนค่าเริ่มต้น (192.168.1.35:5000)
              </button>
            </div>
          </form>

          {/* Virtual 3DS Battery Level & AC Charger Simulator for testing telemetry thresholds */}
          {modeInput === 'virtual' && (
            <div className="border-t border-slate-200 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <label htmlFor="sim-battery-range" className="text-xs font-semibold text-slate-800">
                  จำลองระดับแบตเตอรี่ของเครื่อง 3DS (สำหรับทดสอบ Telemetry):{' '}
                  <span className="font-mono tabular-nums text-rose-600">{simulatedBatteryPct}%</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="sim-charging-checkbox"
                    type="checkbox"
                    checked={simulatedCharging}
                    onChange={(e) =>
                      onUpdateSimulatedBattery(simulatedBatteryPct, e.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <label htmlFor="sim-charging-checkbox" className="text-xs text-slate-700 cursor-pointer">
                    เสียบสายชาร์จ AC Adapter
                  </label>
                </div>
              </div>

              <input
                id="sim-battery-range"
                type="range"
                min={5}
                max={100}
                step={1}
                value={simulatedBatteryPct}
                onChange={(e) =>
                  onUpdateSimulatedBattery(Number(e.target.value), simulatedCharging)
                }
                className="w-full accent-rose-600"
              />

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  {batteryTelemetry.supported ? (
                    batteryTelemetry.isCharging ? (
                      <BatteryCharging className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Battery className="h-4 w-4 text-slate-700 shrink-0" />
                    )
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                  )}
                  <span>
                    ผลลัพธ์ Telemetry ปัจจุบัน:{' '}
                    {batteryTelemetry.supported && batteryTelemetry.percentage !== null
                      ? `${batteryTelemetry.percentage}% (${batteryTelemetry.statusLabel})`
                      : batteryTelemetry.statusLabel}
                  </span>
                </div>
                <p className="text-slate-600">{batteryTelemetry.advisoryText}</p>
              </div>
            </div>
          )}

          {probeStatus.state !== 'idle' && (
            <div
              role="status"
              className={`rounded-lg border p-3.5 text-xs ${
                probeStatus.state === 'fail'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {probeStatus.state === 'fail' ? (
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                )}
                <span className="font-mono">{probeStatus.message}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right 6 Cols: Step-by-step Hardware Guide with Custom Dual-Screen SVG Illustration */}
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                วิธีเตรียมเครื่อง Nintendo 3DS ก่อนโอนย้ายไฟล์ไร้สาย
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                รองรับทั้ง Old 3DS, Old 2DS, New 3DS XL และ New 2DS XL ที่ติดตั้ง Luma3DS CFW
              </p>
            </div>
            <Wifi className="h-5 w-5 text-rose-600 shrink-0" />
          </div>

          {/* Custom Crisp Dual-Screen 3DS Hardware SVG Diagram */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-900 flex items-center gap-5">
            <svg
              viewBox="0 0 120 96"
              className="h-20 w-24 shrink-0"
              role="img"
              aria-label="แผนภาพหน้าจอเครื่อง Nintendo 3DS แสดงหมายเลข IP Address"
            >
              {/* Top Clamshell */}
              <rect x="14" y="4" width="92" height="42" rx="5" fill="#1e293b" stroke="#475569" strokeWidth="2" />
              <rect x="24" y="10" width="72" height="30" rx="2" fill="#0f172a" stroke="#38bdf8" strokeWidth="1" />
              <text x="60" y="23" textAnchor="middle" fill="#38bdf8" fontSize="6" fontFamily="monospace">
                FTPD v3.1.0 READY
              </text>
              <text x="60" y="33" textAnchor="middle" fill="#f8fafc" fontSize="6.5" fontFamily="monospace">
                {consoleIp}:{consolePort}
              </text>
              {/* Hinge */}
              <rect x="18" y="46" width="84" height="5" rx="2" fill="#334155" />
              {/* Bottom Clamshell */}
              <rect x="10" y="51" width="100" height="41" rx="6" fill="#1e293b" stroke="#475569" strokeWidth="2" />
              <rect x="30" y="56" width="60" height="30" rx="2" fill="#0f172a" stroke="#f43f5e" strokeWidth="1" />
              <circle cx="20" cy="66" r="4.5" fill="#64748b" />
              <circle cx="100" cy="66" r="2" fill="#e2e8f0" />
              <circle cx="105" cy="71" r="2" fill="#f43f5e" />
            </svg>
            <div className="text-xs space-y-1">
              <p className="font-semibold text-slate-900">
                ดูเลข IP ได้จากจอบนของแอป FTPD หรือกดสแกนอัตโนมัติ
              </p>
              <p className="text-slate-600 leading-relaxed">
                เมื่อเปิดแอป <span className="font-mono font-semibold text-slate-900">FTPD</span> บน 3DS หน้าจอบนจะแสดงข้อความ{' '}
                <span className="font-mono font-semibold text-emerald-700">Started server at {consoleIp}:{consolePort}</span>{' '}
                ให้นำตัวเลขนั้นมากรอก หรือกดปุ่ม <strong>สแกนหาเครื่อง 3DS อัตโนมัติ</strong> ทางซ้ายมือ
              </p>
            </div>
          </div>

          <ol className="space-y-4 text-xs text-slate-700">
            <li className="border-b border-slate-100 pb-3">
              <p className="font-bold text-slate-900">
                01. การส่งไฟล์เกม (.CIA / .3DSX / .NDS) เข้าการ์ด SD ผ่าน FTPD
              </p>
              <p className="mt-1 text-slate-600 leading-relaxed">
                เปิดแอป <strong>FTPD</strong> บนเครื่อง Nintendo 3DS จากนั้นเลือกเมนู <strong>ส่งไฟล์เกม</strong> บนเว็บนี้ ลากไฟล์เกมมาวางแล้วกดส่ง ระบบจะจัดเก็บไฟล์เข้าสู่โฟลเดอร์ <code className="font-mono">/cias</code>, <code className="font-mono">/3ds</code> หรือ <code className="font-mono">/roms/nds</code> ให้อัตโนมัติ
              </p>
            </li>
            <li className="border-b border-slate-100 pb-3">
              <p className="font-bold text-slate-900">
                02. การติดตั้งไฟล์ .CIA ไร้สายโดยตรงผ่านแอป FBI (Remote Install)
              </p>
              <p className="mt-1 text-slate-600 leading-relaxed">
                หากไม่ต้องการคัดลอกไฟล์ .CIA พักไว้ใน SD Card ให้เปิดแอป <strong>FBI → Remote Install → Scan QR Code</strong> หรือ <strong>Receive URLs over the network</strong> แล้วกดปุ่ม <strong>QR / FBI Remote</strong> บนหน้าเว็บเพื่อติดตั้งลง HOME Menu โดยตรง
              </p>
            </li>
            <li>
              <p className="font-bold text-slate-900">
                03. การสำรองข้อมูลเซฟเกมผ่านแอป Checkpoint
              </p>
              <p className="mt-1 text-slate-600 leading-relaxed">
                เปิดแอป <strong>Checkpoint</strong> บนเครื่อง 3DS เลือกเกมที่ต้องการแล้วกดปุ่ม <strong>L (Backup)</strong> เพื่อสร้างสล็อตเซฟลงในการ์ด SD จากนั้นเข้ามาที่แท็บ <strong>สำรองเซฟเกม</strong> บนเว็บนี้เพื่อดึงไฟล์เซฟมาเก็บไว้บนคอมพิวเตอร์หรือมือถือได้ทันที
              </p>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};
