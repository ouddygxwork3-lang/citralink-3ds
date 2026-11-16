import React, { useState, useMemo } from 'react';
import {
  ArchiveRestore,
  Download,
  RotateCcw,
  ShieldCheck,
  PlusCircle,
  CheckCircle2,
  Trash2,
  Pin,
  Tag,
  Search,
  FolderArchive,
  Upload,
} from 'lucide-react';
import {
  SaveSlotBackup,
  validateSaveSnapshotInput,
  formatBytes,
} from '../utils/transferLogic';
import { computeSha256ShortDigest } from '../utils/zipBuilder';
import { ConsoleGameTitle } from '../data/initial3dsData';

const PRESET_SAVE_TAGS = ['เซฟหลัก', 'ก่อนบอสใหญ่', '100% Clear', 'Shiny', 'ห้ามลบ'];

interface SaveBackupVaultViewProps {
  consoleTitles: ConsoleGameTitle[];
  saveVault: SaveSlotBackup[];
  consoleIp: string;
  onCreateSaveBackup: (params: {
    titleId: string;
    gameTitle: string;
    slotName: string;
    note: string;
    fileName: string;
    sizeBytes: number;
    checksum?: string;
    isPinned?: boolean;
    tags?: string[];
  }) => void;
  onBackupAllTitles: () => void;
  onRestoreBackupTo3ds: (backup: SaveSlotBackup) => void;
  onDownloadBackupToDevice: (backup: SaveSlotBackup) => void;
  onDeleteBackupFromVault: (backupId: string) => void;
  onTogglePinBackup: (backupId: string) => void;
  onToggleTagOnBackup: (backupId: string, tag: string) => void;
  onExportAllVaultAsZip: () => void;
}

export const SaveBackupVaultView: React.FC<SaveBackupVaultViewProps> = ({
  consoleTitles,
  saveVault,
  consoleIp,
  onCreateSaveBackup,
  onBackupAllTitles,
  onRestoreBackupTo3ds,
  onDownloadBackupToDevice,
  onDeleteBackupFromVault,
  onTogglePinBackup,
  onToggleTagOnBackup,
  onExportAllVaultAsZip,
}) => {
  const [selectedTitleId, setSelectedTitleId] = useState<string>(
    consoleTitles[0]?.titleId || '0004000000055D00'
  );
  const [slotName, setSlotName] = useState<string>('');
  const [backupNote, setBackupNote] = useState<string>('');
  const [selectedNewTags, setSelectedNewTags] = useState<string[]>(['เซฟหลัก']);
  const [pinOnCreate, setPinOnCreate] = useState<boolean>(false);
  const [slotError, setSlotError] = useState<string>('');
  const [feedbackBanner, setFeedbackBanner] = useState<string>('');

  // Vault Search & Filter States
  const [vaultSearch, setVaultSearch] = useState<string>('');
  const [filterGameTitleId, setFilterGameTitleId] = useState<string>('all');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [onlyPinned, setOnlyPinned] = useState<boolean>(false);

  const selectedGame =
    consoleTitles.find((t) => t.titleId === selectedTitleId) || consoleTitles[0];

  const filteredVault = useMemo(() => {
    const q = vaultSearch.trim().toLowerCase();
    return [...saveVault]
      .filter((b) => {
        if (onlyPinned && !b.isPinned) return false;
        if (filterGameTitleId !== 'all' && b.titleId !== filterGameTitleId) return false;
        if (filterTag !== 'all' && !(b.tags || []).includes(filterTag)) return false;
        if (!q) return true;
        return (
          b.gameTitle.toLowerCase().includes(q) ||
          b.slotName.toLowerCase().includes(q) ||
          b.titleId.toLowerCase().includes(q) ||
          b.note.toLowerCase().includes(q) ||
          (b.tags || []).some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)));
  }, [saveVault, vaultSearch, filterGameTitleId, filterTag, onlyPinned]);

  const handleToggleCreateTag = (tag: string) => {
    setSelectedNewTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleCreateCustomSnapshot = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateSaveSnapshotInput(slotName, selectedTitleId);
    if (!validation.valid) {
      setSlotError(validation.slotNameError || validation.titleIdError || 'ข้อมูลไม่ถูกต้อง');
      return;
    }

    setSlotError('');
    const sanitized = validation.sanitizedSlotName!;
    onCreateSaveBackup({
      titleId: selectedGame.titleId,
      gameTitle: selectedGame.name,
      slotName: sanitized,
      note: backupNote.trim() || 'สำรองข้อมูลเซฟผ่าน Wi-Fi จากโฟลเดอร์ Checkpoint',
      fileName: selectedGame.primarySaveFileName,
      sizeBytes: selectedGame.primarySaveSizeBytes,
      isPinned: pinOnCreate,
      tags: selectedNewTags,
    });

    setSlotName('');
    setBackupNote('');
    setFeedbackBanner(
      `คัดลอกไฟล์เซฟ "${selectedGame.primarySaveFileName}" ของเกม ${selectedGame.name} (${sanitized}) มาเก็บไว้บนอุปกรณ์หลักเรียบร้อยแล้ว`
    );
  };

  const handleQuickGameBackup = (game: ConsoleGameTitle) => {
    const todayStr = '2026-11-04_WiFi_Backup';
    onCreateSaveBackup({
      titleId: game.titleId,
      gameTitle: game.name,
      slotName: todayStr,
      note: `สำรองเซฟด่วนผ่าน Wi-Fi จากเครื่อง ${consoleIp}`,
      fileName: game.primarySaveFileName,
      sizeBytes: game.primarySaveSizeBytes,
      tags: ['เซฟหลัก'],
    });
    setFeedbackBanner(
      `ดึงข้อมูลเซฟเกม ${game.name} (${game.primarySaveFileName}) มายังอุปกรณ์หลักสำเร็จ`
    );
  };

  const handleImportSaveFileFromDevice = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const f = fileList[0];
    const bytes = new Uint8Array(await f.arrayBuffer());
    const checksum = await computeSha256ShortDigest(bytes);
    const cleanSlot = `Imported_${f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(
      0,
      40
    );

    onCreateSaveBackup({
      titleId: selectedGame.titleId,
      gameTitle: selectedGame.name,
      slotName: cleanSlot,
      note: `นำเข้าไฟล์เซฟ "${f.name}" จากอุปกรณ์หลักพร้อมตรวจสอบ SHA-256`,
      fileName: f.name,
      sizeBytes: f.size > 0 ? f.size : 128 * 1024,
      checksum,
      isPinned: true,
      tags: ['เซฟหลัก'],
    });
    setFeedbackBanner(
      `นำเข้าไฟล์เซฟ "${f.name}" เข้าสู่คลังสำรองของเกม ${selectedGame.name} (${checksum}) สำเร็จ`
    );
    e.target.value = '';
  };

  return (
    <div className="space-y-8">
      {/* Header & 1-Click Backup All Saves + Export ZIP */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-slate-500">
              Checkpoint & JKSM Save Sync · sdmc:/3ds/Checkpoint/saves
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              สำรองและกู้คืนข้อมูลเซฟเกม Nintendo 3DS
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              จัดระเบียบคลังเซฟด้วยระบบปักหมุด (Pin), ป้ายกำกับ (Tag), ค้นหาตามเกม และส่งออกคลังเซฟทั้งหมดเป็นไฟล์ <code className="font-mono text-xs">.ZIP</code> เดียว
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                onExportAllVaultAsZip();
                setFeedbackBanner(
                  `ส่งออกคลังสำรองเซฟทั้งหมด (${saveVault.length} สล็อต) เป็นไฟล์แพ็กเกจ .ZIP เรียบร้อยแล้ว`
                );
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <FolderArchive className="h-4 w-4 text-slate-700" />
              ส่งออกคลังเซฟทั้งหมด (.ZIP)
            </button>

            <button
              type="button"
              onClick={() => {
                onBackupAllTitles();
                setFeedbackBanner(
                  `สำรองข้อมูลเซฟของเกมทั้งหมด (${consoleTitles.length} เกม) จาก Nintendo 3DS มายังอุปกรณ์หลักเรียบร้อยแล้ว`
                );
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap"
            >
              <ArchiveRestore className="h-4 w-4" />
              สำรองเซฟทุกเกมพร้อมกัน ({consoleTitles.length} เกม)
            </button>
          </div>
        </div>

        {feedbackBanner && (
          <div
            role="status"
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{feedbackBanner}</span>
            </span>
            <button
              type="button"
              onClick={() => setFeedbackBanner('')}
              className="text-emerald-700 hover:underline whitespace-nowrap"
            >
              รับทราบ
            </button>
          </div>
        )}
      </section>

      {/* Two-Column Split: Detected 3DS Titles vs Create Custom Named Save Snapshot */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left 7 Cols: Games detected on 3DS SD Card */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                เกมที่ตรวจพบในเครื่อง Nintendo 3DS ({consoleTitles.length} เกม)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                กดปุ่ม &ldquo;ดึงเซฟมาเก็บไว้&rdquo; เพื่อคัดลอกไฟล์เซฟล่าสุดจากเครื่อง 3DS มายังคลังสำรองบนอุปกรณ์นี้ทันที
              </p>
            </div>

            <div>
              <input
                id="import-save-file-input"
                type="file"
                accept=".sav,.dat,.bin"
                onChange={handleImportSaveFileFromDevice}
                className="sr-only"
              />
              <label
                htmlFor="import-save-file-input"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                นำเข้าไฟล์เซฟจากเครื่อง (.sav/.dat)
              </label>
            </div>
          </div>

          <div className="divide-y divide-slate-200">
            {consoleTitles.map((game) => (
              <div
                key={game.titleId}
                className="py-2.5 first:pt-1 last:pb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900">{game.name}</h3>
                  <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
                    {game.titleId} · {game.region} · ไฟล์ {game.primarySaveFileName} (
                    {formatBytes(game.primarySaveSizeBytes)}) · {game.lastPlayed}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleQuickGameBackup(game)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5 text-rose-600" />
                    ดึงเซฟมาเก็บไว้
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right 5 Cols: Custom Named Checkpoint Snapshot Form with Tags & Pin */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">
            สร้างจุดสำรองเซฟแบบระบุชื่อโฟลเดอร์ (Snapshot)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ตั้งชื่อสล็อตสำรองเซฟ ติดป้ายกำกับ (Tag) และบันทึกช่วยจำ
          </p>

          <form onSubmit={handleCreateCustomSnapshot} className="mt-3.5 space-y-3">
            <div>
              <label htmlFor="snapshot-game-select" className="block text-xs font-semibold text-slate-700 mb-1">
                เลือกเกมจากเครื่อง Nintendo 3DS
              </label>
              <select
                id="snapshot-game-select"
                value={selectedTitleId}
                onChange={(e) => setSelectedTitleId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-600 focus:outline-none"
              >
                {consoleTitles.map((game) => (
                  <option key={game.titleId} value={game.titleId}>
                    {game.name} ({game.titleId})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="snapshot-slot-name" className="block text-xs font-semibold text-slate-700 mb-1">
                ชื่อโฟลเดอร์สล็อตสำรองเซฟ (จำเป็น)
              </label>
              <input
                id="snapshot-slot-name"
                type="text"
                placeholder="เช่น 2026-11-04_Before_Champion"
                value={slotName}
                onChange={(e) => setSlotName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:border-rose-600 focus:outline-none"
              />
              {slotError && (
                <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                  {slotError}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="snapshot-note" className="block text-xs font-semibold text-slate-700 mb-1">
                บันทึกช่วยจำของเซฟนี้ (ไม่บังคับ)
              </label>
              <input
                id="snapshot-note"
                type="text"
                placeholder="เช่น มี Master Ball 2 ลูก หน้าห้องบอส"
                value={backupNote}
                onChange={(e) => setBackupNote(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-600 focus:outline-none"
              />
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                ติดป้ายกำกับ (Tags):
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {PRESET_SAVE_TAGS.map((tag) => {
                  const active = selectedNewTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleToggleCreateTag(tag)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? 'bg-rose-600 text-white font-semibold'
                          : 'border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={pinOnCreate}
                onChange={(e) => setPinOnCreate(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <span>ปักหมุดเซฟนี้ไว้บนสุดของคลังสำรอง (Pin Save)</span>
            </label>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              <PlusCircle className="h-4 w-4" />
              คัดลอกเซฟจาก 3DS มาเก็บไว้ในคลังสำรอง
            </button>
          </form>
        </div>
      </section>

      {/* Local Save Backup Vault Table with Search, Filter by Game/Tag & Pinning */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              คลังสำรองข้อมูลเซฟบนอุปกรณ์หลัก ({filteredVault.length} จาก {saveVault.length} รายการ)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ข้อมูลเซฟทั้งหมดผ่านการตรวจสอบค่า SHA-256 Checksum สามารถปักหมุด กรองตามป้ายกำกับ ดาวน์โหลด หรือกู้คืนเข้า 3DS ได้ทันที
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOnlyPinned((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              onlyPinned
                ? 'border-rose-600 bg-rose-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Pin className="h-3.5 w-3.5" />
            {onlyPinned ? 'แสดงเฉพาะที่ปักหมุดอยู่' : 'ดูเฉพาะเซฟที่ปักหมุด'}
          </button>
        </div>

        {/* Search & Filter Controls */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="sm:col-span-5 relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="ค้นหาชื่อเกม, ชื่อสล็อต, บันทึกช่วยจำ หรือป้ายกำกับ..."
              value={vaultSearch}
              onChange={(e) => setVaultSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-600 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-4">
            <select
              aria-label="กรองตามรายชื่อเกม"
              value={filterGameTitleId}
              onChange={(e) => setFilterGameTitleId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-600 focus:outline-none"
            >
              <option value="all">ทุกเกมในคลังสำรอง ({saveVault.length})</option>
              {consoleTitles.map((g) => (
                <option key={g.titleId} value={g.titleId}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <select
              aria-label="กรองตามป้ายกำกับ"
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-600 focus:outline-none"
            >
              <option value="all">ทุกป้ายกำกับ (Tags)</option>
              {PRESET_SAVE_TAGS.map((t) => (
                <option key={t} value={t}>
                  ป้ายกำกับ: {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredVault.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-slate-700">ไม่พบข้อมูลเซฟที่ตรงกับเงื่อนไขการค้นหา</p>
            <p className="mt-1 text-xs text-slate-500">
              ลองล้างตัวกรองด้านบน หรือกดปุ่ม &ldquo;ดึงเซฟมาเก็บไว้&rdquo; จากรายชื่อเกมเพื่อสำรองข้อมูลเซฟใหม่
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="pb-3 pr-4">เกมและชื่อสล็อตสำรองเซฟ</th>
                  <th className="pb-3 px-4">ป้ายกำกับและบันทึกช่วยจำ</th>
                  <th className="pb-3 px-4 text-right">ขนาดไฟล์</th>
                  <th className="pb-3 pl-4 text-right">จัดการ / กู้คืนเข้า 3DS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredVault.map((backup) => (
                  <tr key={backup.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onTogglePinBackup(backup.id)}
                          aria-label={backup.isPinned ? 'เลิกปักหมุดเซฟนี้' : 'ปักหมุดเซฟนี้ไว้บนสุด'}
                          title={backup.isPinned ? 'ปักหมุดอยู่ (คลิกเพื่อยกเลิก)' : 'คลิกเพื่อปักหมุดไว้บนสุด'}
                          className={`rounded p-1 transition-colors ${
                            backup.isPinned
                              ? 'bg-rose-100 text-rose-600'
                              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                          }`}
                        >
                          <Pin className="h-3.5 w-3.5" />
                        </button>
                        <p className="font-semibold text-slate-900">{backup.gameTitle}</p>
                        {backup.isPinned && (
                          <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            ปักหมุด
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-mono text-slate-700">
                        สล็อต: {backup.slotName} · ไฟล์ {backup.fileName}
                      </p>
                      <p className="mt-0.5 font-mono tabular-nums text-slate-500 flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span>
                          Title ID {backup.titleId} · {backup.createdAt} · {backup.checksum}
                        </span>
                      </p>
                    </td>
                    <td className="py-4 px-4 max-w-xs space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {(backup.tags || []).map((tag) => (
                          <span
                            key={tag}
                            onClick={() => onToggleTagOnBackup(backup.id, tag)}
                            title="คลิกเพื่อลบป้ายกำกับนี้"
                            className="cursor-pointer inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-red-100 hover:text-red-700"
                          >
                            <Tag className="h-2.5 w-2.5" />
                            {tag}
                          </span>
                        ))}
                        <select
                          aria-label={`เพิ่มป้ายกำกับให้สล็อต ${backup.slotName}`}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              onToggleTagOnBackup(backup.id, e.target.value);
                            }
                          }}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600"
                        >
                          <option value="">+ ป้ายกำกับ</option>
                          {PRESET_SAVE_TAGS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="text-slate-600">{backup.note}</p>
                    </td>
                    <td className="py-4 px-4 text-right font-mono tabular-nums font-medium text-slate-800 whitespace-nowrap">
                      {formatBytes(backup.sizeBytes)}
                    </td>
                    <td className="py-4 pl-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onDownloadBackupToDevice(backup)}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          ดาวน์โหลดเซฟ
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onRestoreBackupTo3ds(backup);
                            setFeedbackBanner(
                              `ส่งไฟล์เซฟ "${backup.slotName}" กลับไปยังโฟลเดอร์ Checkpoint บนเครื่อง Nintendo 3DS เรียบร้อยแล้ว`
                            );
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          กู้คืนเข้า 3DS
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteBackupFromVault(backup.id)}
                          aria-label={`ลบข้อมูลสำรองเซฟ ${backup.slotName}`}
                          className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
