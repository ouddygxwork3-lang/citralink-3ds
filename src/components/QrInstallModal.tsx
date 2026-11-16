import React, { useState, useEffect } from 'react';
import { X, Send, Copy, Check, Wifi, QrCode, ShieldCheck, RotateCcw } from 'lucide-react';
import { formatBytes } from '../utils/transferLogic';
import { encodeIsoQrCodeMatrix } from '../utils/qrCodeEncoder';

interface QrInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  fileSizeBytes: number;
  titleId?: string;
  consoleIp: string;
  consolePort: number;
  connectionMode: 'virtual' | 'hardware';
  onBoopPushSuccess: (fileName: string, message: string) => void;
}

export const QrInstallModal: React.FC<QrInstallModalProps> = ({
  isOpen,
  onClose,
  fileName,
  fileSizeBytes,
  titleId,
  consoleIp,
  consolePort,
  connectionMode,
  onBoopPushSuccess,
}) => {
  const [copied, setCopied] = useState(false);
  const [pushState, setPushState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [lanHostOrigin, setLanHostOrigin] = useState<string>('');
  const [customStreamUrl, setCustomStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCustomStreamUrl(null);
    setPushState('idle');
    setStatusMessage('');
    let cancelled = false;
    const query = `targetIp=${encodeURIComponent(consoleIp)}`;

    const fetchBridgeInfo = async (base: string) => {
      const r = await fetch(`${base}/api/bridge/info?${query}`);
      const contentType = r.headers.get('content-type') || '';
      if (!r.ok || !contentType.includes('application/json')) {
        throw new Error('Bridge info unavailable');
      }
      return r.json();
    };

    fetchBridgeInfo('')
      .catch(() => fetchBridgeInfo('http://localhost:3000'))
      .then((data) => {
        if (!cancelled && data?.hostUrl) {
          setLanHostOrigin(data.hostUrl);
        }
      })
      .catch(() => {
        // Fallback below
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, fileName, consoleIp]);

  if (!isOpen) return null;

  const fallbackOrigin =
    typeof window !== 'undefined'
      ? window.location.hostname.endsWith('github.io')
        ? consoleIp.startsWith('172.20.10.')
          ? 'http://172.20.10.9:3000'
          : 'http://localhost:3000'
        : window.location.origin
      : 'http://192.168.1.10:3000';
  const effectiveOrigin =
    lanHostOrigin && !lanHostOrigin.includes('127.0.0.1') && !lanHostOrigin.includes('localhost')
      ? lanHostOrigin
      : fallbackOrigin;

  const defaultStreamUrl = `${effectiveOrigin}/api/stream/${encodeURIComponent(fileName)}`;
  const streamUrl = customStreamUrl !== null ? customStreamUrl : defaultStreamUrl;

  let qrEncoded: ReturnType<typeof encodeIsoQrCodeMatrix> | null = null;
  let qrError = '';
  try {
    qrEncoded = encodeIsoQrCodeMatrix(streamUrl.trim() || defaultStreamUrl);
  } catch (err) {
    qrError = err instanceof Error ? err.message : 'ไม่สามารถสร้าง QR Code สำหรับ URL นี้ได้';
  }
  const quietZone = 3;
  const viewBoxSize = qrEncoded ? qrEncoded.size + quietZone * 2 : 31;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(streamUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleBoopPush = async () => {
    setPushState('sending');
    setStatusMessage('กำลังส่งแพ็กเก็ต URL ไปยังแอป FBI บนเครื่อง Nintendo 3DS...');
    try {
      const payload = JSON.stringify({
        ip: consoleIp,
        port: consolePort,
        urls: [streamUrl.trim() || defaultStreamUrl],
        mode: connectionMode,
      });

      const sendPush = async (base: string) => {
        const res = await fetch(`${base}/api/fbi/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error('NON_JSON_RESPONSE');
        }
        return res.json();
      };

      let data: { ok: boolean; message?: string };
      try {
        data = await sendPush('');
      } catch {
        if (typeof window !== 'undefined' && window.location.origin !== 'http://localhost:3000') {
          data = await sendPush('http://localhost:3000');
        } else {
          throw new Error('PUSH_FAILED');
        }
      }

      if (data.ok) {
        setPushState('success');
        setStatusMessage(data.message || 'ส่งแพ็กเก็ต URL ไปยัง FBI สำเร็จ');
        onBoopPushSuccess(fileName, data.message || 'ส่งแพ็กเก็ต URL ไปยัง FBI สำเร็จ');
      } else {
        setPushState('error');
        setStatusMessage(data.message || 'ไม่สามารถเชื่อมต่อพอร์ต 5000 ของ FBI ได้');
      }
    } catch {
      if (connectionMode === 'virtual') {
        const msg = `จำลองส่งแพ็กเก็ต URL ไปยัง FBI (${consoleIp}:${consolePort}) สำเร็จแล้ว (โหมดเว็บเบราว์เซอร์)`;
        setPushState('success');
        setStatusMessage(msg);
        onBoopPushSuccess(fileName, msg);
      } else {
        setPushState('error');
        setStatusMessage('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ส่งไฟล์ไร้สาย');
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-medium text-rose-600">
              FBI Remote Install · Port {consolePort} · ISO/IEC 18004 QR{' '}
              {qrEncoded ? `(V${qrEncoded.version}-M)` : '(URL Error)'}
            </p>
            <h2 id="qr-modal-title" className="mt-1 text-lg font-bold text-slate-900">
              ติดตั้งเกมไร้สายผ่าน FBI (QR Code สแกนจริง & Boop TCP)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างติดตั้งผ่าน FBI"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-12 items-center">
          {/* ISO/IEC 18004 Reed-Solomon Scannable SVG QR Code */}
          <div className="sm:col-span-5 flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-4">
            {qrEncoded ? (
              <svg
                viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
                shapeRendering="crispEdges"
                className="h-48 w-48 rounded bg-white p-1.5 border border-slate-200 shadow-xs"
                role="img"
                aria-label={`QR Code สำหรับติดตั้งไฟล์ ${fileName}`}
              >
                <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
                {qrEncoded.matrix.map((row, rIdx) =>
                  row.map((cell, cIdx) =>
                    cell ? (
                      <rect
                        key={`${rIdx}-${cIdx}`}
                        x={cIdx + quietZone}
                        y={rIdx + quietZone}
                        width="1"
                        height="1"
                        fill="#000000"
                      />
                    ) : null
                  )
                )}
              </svg>
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded border border-red-200 bg-red-50 p-3 text-center text-xs text-red-700">
                {qrError}
              </div>
            )}
            <p className="mt-2.5 text-center text-xs text-slate-600">
              เปิดแอป <strong className="font-semibold text-slate-900">FBI</strong> →{' '}
              <strong className="font-semibold text-slate-900">Remote Install</strong> →{' '}
              <strong className="font-semibold text-slate-900">Scan QR Code</strong>
            </p>
            {qrEncoded && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                Reed-Solomon ECC ({qrEncoded.size}×{qrEncoded.size})
              </p>
            )}
          </div>

          {/* File details & direct network push */}
          <div className="sm:col-span-7 flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 break-all">{fileName}</h3>
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                ขนาดไฟล์ {formatBytes(fileSizeBytes)}
                {titleId ? ` · Title ID ${titleId}` : ''} · ปลายทาง {consoleIp}:{consolePort}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="fbi-stream-url" className="block text-xs font-medium text-slate-700">
                  ลิงก์ดาวน์โหลดไฟล์ .CIA (แก้ไขได้เพื่อสร้าง QR จาก URL สาธารณะ)
                </label>
                {customStreamUrl !== null && (
                  <button
                    type="button"
                    onClick={() => setCustomStreamUrl(null)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-700"
                  >
                    <RotateCcw className="h-3 w-3" />
                    รีเซ็ตลิงก์
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="fbi-stream-url"
                  type="text"
                  value={streamUrl}
                  onChange={(e) => setCustomStreamUrl(e.target.value)}
                  placeholder="https://example.com/game.cia"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 focus:border-rose-500 focus:bg-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 transition-colors"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
                </button>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <p className="text-xs text-slate-600 mb-3">
                หรือเลือกเมนู <strong className="font-semibold text-slate-900">Receive URLs over the network</strong> บนหน้าจอ FBI แล้วกดปุ่มด้านล่างเพื่อยิงไฟล์เข้าเครื่องทันที:
              </p>
              <button
                type="button"
                onClick={handleBoopPush}
                disabled={pushState === 'sending'}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <Send className="h-4 w-4" />
                {pushState === 'sending'
                  ? 'กำลังส่งข้อมูลเข้าเครื่อง 3DS...'
                  : `ยิงไฟล์เข้า FBI ทันที (${consoleIp}:${consolePort})`}
              </button>
            </div>

            {statusMessage && (
              <div
                role="status"
                className={`rounded-lg border px-3 py-2.5 text-xs ${
                  pushState === 'error'
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  {pushState === 'error' ? <QrCode className="h-4 w-4 shrink-0" /> : <Wifi className="h-4 w-4 shrink-0" />}
                  <span>{statusMessage}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
};
