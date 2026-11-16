import React, { useState } from 'react';
import {
  Folder,
  FolderPlus,
  Search,
  Download,
  Trash2,
  QrCode,
  ArchiveRestore,
  Upload,
} from 'lucide-react';
import { SDFileItem, formatBytes, FileCategory } from '../utils/transferLogic';
import { inspectBrowserGameFile, generateFallbackBadgeIcon } from '../utils/binary3dsParser';

interface SdExplorerViewProps {
  currentPath: string;
  onSelectPath: (path: string) => void;
  directories: string[];
  files: SDFileItem[];
  onCreateDirectory: (newPath: string) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  onDeleteFile: (fileId: string) => void;
  onDownloadFileToDevice: (file: SDFileItem) => void;
  onQuickBackupSaveFromSd: (file: SDFileItem) => void;
  onOpenQrInstall: (file: { fileName: string; sizeBytes: number; titleId?: string }) => void;
  onUploadFileToCurrentDir: (
    fileName: string,
    sizeBytes: number,
    dirPath: string,
    meta?: { titleId?: string; productCode?: string; iconDataUrl?: string }
  ) => void;
}

export const SdExplorerView: React.FC<SdExplorerViewProps> = ({
  currentPath,
  onSelectPath,
  directories,
  files,
  onCreateDirectory,
  onDeleteFile,
  onDownloadFileToDevice,
  onQuickBackupSaveFromSd,
  onOpenQrInstall,
  onUploadFileToCurrentDir,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | FileCategory>('all');
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [folderError, setFolderError] = useState<string>('');
  const [showAllFolders, setShowAllFolders] = useState<boolean>(false);

  const visibleFiles = files.filter((file) => {
    const matchesFolder = showAllFolders || searchQuery.trim() !== '' ? true : file.path === currentPath;
    const matchesCategory = categoryFilter === 'all' ? true : file.category === categoryFilter;
    const matchesSearch =
      searchQuery.trim() === ''
        ? true
        : file.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
          (file.titleId && file.titleId.toLowerCase().includes(searchQuery.trim().toLowerCase())) ||
          (file.productCode && file.productCode.toLowerCase().includes(searchQuery.trim().toLowerCase()));
    return matchesFolder && matchesCategory && matchesSearch;
  });

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFolderName.trim();
    if (!clean) {
      setFolderError('กรุณาตั้งชื่อโฟลเดอร์ที่ต้องการสร้างบนการ์ด SD');
      return;
    }
    if (/[<>:"/\\|?*]/.test(clean)) {
      setFolderError('ชื่อโฟลเดอร์ห้ามมีอักขระพิเศษ (< > : " / \\ | ? *)');
      return;
    }
    const targetPath = currentPath === '/' ? `/${clean}` : `${currentPath}/${clean}`;
    const res = await onCreateDirectory(targetPath);
    if (!res.ok) {
      setFolderError(res.error || 'ไม่สามารถสร้างโฟลเดอร์นี้ได้');
      return;
    }
    setFolderError('');
    setNewFolderName('');
    onSelectPath(targetPath);
  };

  const handleDirectUploadInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const destPath = currentPath === '/' ? '/cias' : currentPath;
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const effectiveSize = f.size > 0 ? f.size : 16 * 1024 * 1024;
      try {
        const meta = await inspectBrowserGameFile(f);
        onUploadFileToCurrentDir(f.name, effectiveSize, destPath, {
          titleId: meta.titleId,
          productCode: meta.productCode,
          iconDataUrl: meta.iconDataUrl,
        });
      } catch {
        onUploadFileToCurrentDir(f.name, effectiveSize, destPath);
      }
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-slate-500">
              FTPD File Explorer · พาธปัจจุบัน sdmc:{currentPath}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              จัดการไฟล์บนการ์ด microSD ของเครื่อง Nintendo 3DS
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="sd-direct-upload"
              type="file"
              multiple
              onChange={handleDirectUploadInput}
              className="sr-only"
            />
            <label
              htmlFor="sd-direct-upload"
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap"
            >
              <Upload className="h-4 w-4" />
              อัปโหลดไฟล์ลงโฟลเดอร์นี้
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left 4 Cols: SD Directory Tree & Create Folder */}
        <aside className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">โฟลเดอร์ในการ์ด microSD</h2>
              <button
                type="button"
                onClick={() => setShowAllFolders((prev) => !prev)}
                className="text-xs font-medium text-rose-600 hover:text-rose-700"
              >
                {showAllFolders ? 'แสดงเฉพาะโฟลเดอร์ที่เลือก' : 'แสดงไฟล์ทุกโฟลเดอร์'}
              </button>
            </div>
            <ul className="mt-3 space-y-1">
              {directories.map((dir) => {
                const count = files.filter((f) => f.path === dir).length;
                const isActive = !showAllFolders && currentPath === dir;
                return (
                  <li key={dir}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAllFolders(false);
                        onSelectPath(dir);
                      }}
                      className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-mono transition-colors ${
                        isActive
                          ? 'bg-slate-900 text-white font-semibold'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Folder className="h-4 w-4 shrink-0" />
                        <span className="truncate">sdmc:{dir}</span>
                      </span>
                      <span className="tabular-nums opacity-75">{count} ไฟล์</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <form onSubmit={handleCreateFolderSubmit} className="border-t border-slate-200 pt-4 space-y-2.5">
            <label htmlFor="new-sd-folder-input" className="block text-xs font-semibold text-slate-800">
              สร้างโฟลเดอร์ใหม่ใน sdmc:{currentPath}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="new-sd-folder-input"
                type="text"
                placeholder="เช่น mods หรือ custom_themes"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-600 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200 whitespace-nowrap shrink-0 transition-colors"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                สร้างโฟลเดอร์
              </button>
            </div>
            {folderError && (
              <p role="alert" className="text-xs font-medium text-red-600">
                {folderError}
              </p>
            )}
          </form>
        </aside>

        {/* Right 8 Cols: File Table with Search, Category Filter & Actions */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
            {/* Search Input */}
            <div className="relative flex-1">
              <label htmlFor="sd-file-search" className="sr-only">
                ค้นหาชื่อไฟล์หรือ Title ID
              </label>
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                id="sd-file-search"
                type="search"
                placeholder="ค้นหาชื่อไฟล์เกม, นามสกุล .cia / .sav, Product Code หรือ Title ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-600 focus:outline-none"
              />
            </div>

            {/* Interactive Category Filter Segmented Controls */}
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
              {[
                { key: 'all', label: 'ทั้งหมด' },
                { key: 'cia', label: '.CIA' },
                { key: '3dsx', label: '.3DSX' },
                { key: 'nds', label: '.NDS' },
                { key: 'save', label: 'เซฟเกม' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setCategoryFilter(tab.key as 'all' | FileCategory)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    categoryFilter === tab.key
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {visibleFiles.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-800">
                ไม่พบไฟล์ในโฟลเดอร์ sdmc:{currentPath} ที่ตรงกับเงื่อนไข
              </p>
              <p className="text-xs text-slate-500">
                ลองเปลี่ยนโฟลเดอร์ทางด้านซ้าย หรือกดปุ่ม &ldquo;แสดงไฟล์ทุกโฟลเดอร์&rdquo; เพื่อดูไฟล์ทั้งหมดในการ์ด SD
              </p>
              {!showAllFolders && (
                <button
                  type="button"
                  onClick={() => setShowAllFolders(true)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  แสดงไฟล์ทุกโฟลเดอร์ในการ์ด SD
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="pb-3 pr-4">ไอคอน ชื่อไฟล์ และข้อมูลไบนารี</th>
                    <th className="pb-3 px-4 text-right">ขนาดไฟล์</th>
                    <th className="pb-3 pl-4 text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {visibleFiles.map((file) => {
                    const iconSrc =
                      file.iconDataUrl ||
                      generateFallbackBadgeIcon(
                        file.titleId || file.name,
                        file.category === 'archive' ? 'other' : file.category
                      );
                    return (
                      <tr key={file.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 pr-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={iconSrc}
                              alt={`ไอคอน ${file.name}`}
                              className="h-9 w-9 rounded-lg border border-slate-200 shrink-0"
                              style={{ imageRendering: 'pixelated' }}
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="font-semibold text-slate-900 break-all">{file.name}</p>
                                {file.productCode && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                                    {file.productCode}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-slate-500 font-mono tabular-nums">
                                sdmc:{file.path} · แก้ไขเมื่อ {file.modifiedAt}
                                {file.titleId ? ` · Title ID ${file.titleId}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-medium text-slate-800 whitespace-nowrap">
                          {formatBytes(file.sizeBytes)}
                        </td>
                        <td className="py-3.5 pl-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {file.category === 'cia' && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenQrInstall({
                                    fileName: file.name,
                                    sizeBytes: file.sizeBytes,
                                    titleId: file.titleId,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                              >
                                <QrCode className="h-3.5 w-3.5" />
                                QR ติดตั้ง
                              </button>
                            )}
                            {file.category === 'save' && (
                              <button
                                type="button"
                                onClick={() => onQuickBackupSaveFromSd(file)}
                                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                                สำรองเซฟ
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onDownloadFileToDevice(file)}
                              aria-label={`ดาวน์โหลดไฟล์ ${file.name} ลงอุปกรณ์หลัก`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                              <Download className="h-3.5 w-3.5" />
                              คัดลอกลงเครื่องนี้
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteFile(file.id)}
                              aria-label={`ลบไฟล์ ${file.name}`}
                              className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
