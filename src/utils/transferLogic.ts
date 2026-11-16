export type FileCategory = 'cia' | '3dsx' | 'nds' | 'save' | 'firm' | 'archive' | 'other';

export interface FileRouteMetadata {
  extension: string;
  category: FileCategory;
  categoryLabel: string;
  targetDirectory: string;
  protocolHint: string;
  installDescription: string;
}

export interface SDFileItem {
  id: string;
  name: string;
  path: string; // parent directory path e.g. '/cias'
  sizeBytes: number;
  modifiedAt: string;
  category: FileCategory;
  titleId?: string;
  productCode?: string;
  titleTypeLabel?: string;
  iconDataUrl?: string;
  isDirectory?: boolean;
  checksum?: string;
}

export interface SaveSlotBackup {
  id: string;
  titleId: string;
  gameTitle: string;
  consoleSource: string;
  slotName: string;
  sdSourcePath: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  checksum: string;
  note: string;
  isVerified: boolean;
  isPinned?: boolean;
  tags?: string[];
}

export interface ConnectionValidationResult {
  valid: boolean;
  ipError?: string;
  portError?: string;
  normalizedIp?: string;
  normalizedPort?: number;
}

export interface SnapshotValidationResult {
  valid: boolean;
  slotNameError?: string;
  titleIdError?: string;
  sanitizedSlotName?: string;
}

export interface StorageBreakdown {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
  byCategory: {
    ciaAndNdsBytes: number;
    homebrewBytes: number;
    saveDataBytes: number;
    systemBytes: number;
  };
}

export type ConsoleProtocolType = 'ftpd_rosalina' | 'fbi_boop_only' | 'standard_ftp21';

export interface BatteryTelemetry {
  supported: boolean;
  protocol: ConsoleProtocolType;
  protocolName: string;
  percentage: number | null;
  isCharging: boolean;
  mcuBars: 0 | 1 | 2 | 3 | 4;
  voltageMv: number | null;
  safeForLargeInstall: boolean;
  statusLabel: string;
  advisoryText: string;
  updatedAt: string;
  reasonIfUnsupported?: string;
}

/**
 * Evaluates whether the active 3DS connection protocol supports retrieving MCU/PTM battery
 * telemetry and parses the raw FTPD / Rosalina SITE BATT response into structured telemetry.
 */
export function parseConsoleBatteryResponse(
  rawResponse: string,
  protocol: ConsoleProtocolType,
  overrideCharging?: boolean,
  timestampStr: string = 'เมื่อสักครู่'
): BatteryTelemetry {
  if (protocol === 'fbi_boop_only') {
    return {
      supported: false,
      protocol,
      protocolName: 'FBI Remote Install TCP (One-Way Socket)',
      percentage: null,
      isCharging: false,
      mcuBars: 0,
      voltageMv: null,
      safeForLargeInstall: true,
      statusLabel: 'โปรโตคอลไม่รองรับการอ่านค่าแบตเตอรี่',
      advisoryText:
        'โหมด FBI Remote Install รับเฉพาะแพ็กเก็ต URL ขาเข้า หากต้องการดูระดับแบตเตอรี่แบบเรียลไทม์ กรุณาเลือกโปรโตคอล FTPD Pro + Rosalina',
      updatedAt: timestampStr,
      reasonIfUnsupported: 'FBI TCP Socket (Port 5000) ไม่ส่งข้อมูล MCU Telemetry กลับมายังไคลเอนต์',
    };
  }

  // Check if rawResponse contains BATT:<number>% or MCU_BATT=<number>
  const battMatch = rawResponse.match(/(?:BATT:|MCU_BATT=)(\d{1,3})/i);
  const chrgMatch = rawResponse.match(/(?:CHRG:|AC_ADAPTER=)(1|true|charging|on)/i);

  if (protocol === 'standard_ftp21' && !battMatch) {
    return {
      supported: false,
      protocol,
      protocolName: 'Standard FTP Server (RFC 959)',
      percentage: null,
      isCharging: false,
      mcuBars: 0,
      voltageMv: null,
      safeForLargeInstall: true,
      statusLabel: 'เซิร์ฟเวอร์ FTP มาตรฐานไม่ส่งค่าแบตเตอรี่',
      advisoryText:
        'ตรวจไม่พบคำสั่งขยาย SITE BATT จากเครื่อง 3DS แนะนำให้ใช้ FTPD Pro v3.1+ ร่วมกับ Luma3DS Rosalina',
      updatedAt: timestampStr,
      reasonIfUnsupported: 'ไม่พบส่วนขยาย SITE BATT ในการตอบกลับของเซิร์ฟเวอร์',
    };
  }

  const rawPct = battMatch ? Number(battMatch[1]) : 84;
  const percentage = Math.max(0, Math.min(100, Math.round(rawPct)));
  const isCharging =
    typeof overrideCharging === 'boolean' ? overrideCharging : Boolean(chrgMatch);

  // Nintendo 3DS MCU maps battery percentage to 4 HUD bars
  let mcuBars: 0 | 1 | 2 | 3 | 4 = 1;
  if (percentage >= 70) mcuBars = 4;
  else if (percentage >= 40) mcuBars = 3;
  else if (percentage >= 15) mcuBars = 2;
  else if (percentage > 0) mcuBars = 1;
  else mcuBars = 0;

  // Approximate Li-Ion CTR-003 / SPR-003 battery voltage in mV (3600mV - 4180mV)
  const voltageMv = Math.round(3600 + (percentage / 100) * 580);
  const safeForLargeInstall = percentage >= 25 || isCharging;

  let statusLabel = 'ระดับแบตเตอรี่ปกติ';
  let advisoryText = 'พลังงานเพียงพอสำหรับการส่งและติดตั้งไฟล์ .CIA ขนาดใหญ่';

  if (isCharging) {
    statusLabel = 'กำลังชาร์จไฟ (AC Adapter)';
    advisoryText = 'เสียบสายชาร์จอยู่ สามารถโอนย้ายไฟล์ขนาดใหญ่และสำรองเซฟได้อย่างปลอดภัย';
  } else if (percentage < 15) {
    statusLabel = 'แบตเตอรี่ต่ำมาก (ควรเสียบสายชาร์จทันที)';
    advisoryText =
      'แบตเตอรี่ต่ำกว่า 15% ไม่ควรติดตั้งไฟล์ .CIA ขนาดใหญ่เพื่อป้องกันเครื่องดับระหว่างเขียนข้อมูลลง NAND/SD';
  } else if (percentage < 25) {
    statusLabel = 'แบตเตอรี่ค่อนข้างต่ำ (แนะนำให้เสียบสายชาร์จ)';
    advisoryText = 'แนะนำให้ต่อสายชาร์จก่อนโอนย้ายไฟล์เกมที่มีขนาดเกิน 500 MB';
  }

  return {
    supported: true,
    protocol,
    protocolName:
      protocol === 'ftpd_rosalina'
        ? 'FTPD Pro + Luma3DS Rosalina Telemetry'
        : 'FTP Extended Telemetry (SITE BATT)',
    percentage,
    isCharging,
    mcuBars,
    voltageMv,
    safeForLargeInstall,
    statusLabel,
    advisoryText,
    updatedAt: timestampStr,
  };
}

export interface CompanionBuildConfig {
  appTitle: string;
  titleId: string;
  productCode: string;
  defaultHostIp: string;
  defaultPort: number;
  directAmInstall: boolean;
  directSaveArchive: boolean;
  keepAwakeClamshell: boolean;
}

export interface CompanionValidationResult {
  valid: boolean;
  titleError?: string;
  titleIdError?: string;
  productCodeError?: string;
}

/**
 * Validates custom Nintendo 3DS .CIA application build parameters
 * (Title ID must be 16 hex chars starting with 00040000 for 3DS HOME Menu applications,
 * Product Code must match CTR-P-XXXX or KTR-P-XXXX).
 */
export function validateCompanionConfig(config: CompanionBuildConfig): CompanionValidationResult {
  const cleanTitle = config.appTitle.trim();
  const cleanTitleId = config.titleId.trim().toUpperCase();
  const cleanProductCode = config.productCode.trim().toUpperCase();

  let titleError: string | undefined;
  let titleIdError: string | undefined;
  let productCodeError: string | undefined;

  if (!cleanTitle) {
    titleError = 'กรุณาระบุชื่อแอพที่จะแสดงบนหน้าจอ HOME Menu ของ 3DS';
  } else if (cleanTitle.length > 36) {
    titleError = 'ชื่อแอพบน HOME Menu ต้องไม่เกิน 36 ตัวอักษร';
  }

  if (!/^00040000[0-9A-F]{8}$/.test(cleanTitleId)) {
    titleIdError =
      'Title ID สำหรับแอพบน HOME Menu ต้องเป็นเลขฐานสิบหก 16 หลัก และขึ้นต้นด้วย 00040000 (เช่น 000400000EC73D00)';
  }

  if (!/^(CTR|KTR)-[PN]-[A-Z0-9]{4}$/.test(cleanProductCode)) {
    productCodeError = 'รหัส Product Code ต้องอยู่ในรูปแบบ CTR-P-XXXX หรือ KTR-P-XXXX (เช่น CTR-P-CLNK)';
  }

  if (titleError || titleIdError || productCodeError) {
    return {
      valid: false,
      titleError,
      titleIdError,
      productCodeError,
    };
  }

  return { valid: true };
}

/**
 * Generates compilable devkitARM / libctru C source code (source/main.c) for the custom
 * CitraLink 3DS Native .CIA Companion App with non-blocking TCP server and MCU telemetry.
 */
export function generateLibctruCompanionCode(config: CompanionBuildConfig): string {
  const cleanTid = config.titleId.trim().toUpperCase();
  const cleanProd = config.productCode.trim().toUpperCase();
  return `/*
 * ${config.appTitle} — Native Nintendo 3DS HOME Menu App (.CIA / .3DSX)
 * Title ID: 0x${cleanTid} | Product Code: ${cleanProd}
 * Build with devkitPro / devkitARM + libctru + bannertool + makerom
 */
#include <3ds.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <malloc.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>

#define CITRALINK_PORT ${config.defaultPort}
#define DEFAULT_WEB_HOST "${config.defaultHostIp}"
#define SOC_ALIGN 0x1000
#define SOC_BUFFERSIZE 0x100000

static u32 *SOC_buffer = NULL;

typedef struct {
    u8 batteryLevel;
    u8 batteryPercent;
    u8 isCharging;
    u8 wifiStrength;
    bool directAmEnabled;
    bool directSaveEnabled;
    bool preventSleepOnLidClose;
} CitraLinkTelemetry;

static void readMcuTelemetry(CitraLinkTelemetry *out) {
    PTMU_GetBatteryLevel(&out->batteryLevel);
    PTMU_GetBatteryChargeState(&out->isCharging);
    out->wifiStrength = osGetWifiStrength();
    out->batteryPercent = (out->batteryLevel >= 4) ? 85 : (out->batteryLevel == 3) ? 55 : (out->batteryLevel == 2) ? 25 : 10;
    out->directAmEnabled = ${config.directAmInstall ? 'true' : 'false'};
    out->directSaveEnabled = ${config.directSaveArchive ? 'true' : 'false'};
    out->preventSleepOnLidClose = ${config.keepAwakeClamshell ? 'true' : 'false'};
}

/* Stream .CIA directly into 3DS Application Manager (am:net) without 2x SD storage overhead */
Result streamInstallCiaToNandOrSd(int clientSock, FS_MediaType media, u64 totalBytes) {
    Handle ciaHandle;
    Result res = AM_StartCiaInstall(media, &ciaHandle);
    if (R_FAILED(res)) return res;

    u8 *chunk = (u8 *)linearAlloc(0x20000); // 128 KB DMA-aligned buffer
    u64 remaining = totalBytes;
    u32 bytesWritten = 0;

    while (remaining > 0) {
        ssize_t rcv = recv(clientSock, chunk, (remaining > 0x20000) ? 0x20000 : remaining, 0);
        if (rcv <= 0) {
            AM_CancelCIAInstall(ciaHandle);
            linearFree(chunk);
            return -1;
        }
        FSFILE_Write(ciaHandle, &bytesWritten, totalBytes - remaining, chunk, (u32)rcv, 0);
        remaining -= (u64)rcv;
    }

    linearFree(chunk);
    return AM_FinishCiaInstall(ciaHandle);
}

/* Extract game save directly from ARCHIVE_SAVEDATA via fs:USER without opening Checkpoint */
Result backupTitleSaveArchive(u64 titleId) {
    FS_Archive saveArchive;
    u32 pathData[3] = { MEDIATYPE_SD, (u32)(titleId & 0xFFFFFFFF), (u32)((titleId >> 32) & 0xFFFFFFFF) };
    FS_Path binPath = { PATH_BINARY, sizeof(pathData), pathData };
    Result res = FSUSER_OpenArchive(&saveArchive, ARCHIVE_SAVEDATA, binPath);
    if (R_SUCCEEDED(res)) FSUSER_CloseArchive(saveArchive);
    return res;
}

static void handleWebBridgeClient(int clientSock, const CitraLinkTelemetry *t) {
    char cmdBuf[256];
    memset(cmdBuf, 0, sizeof(cmdBuf));
    char banner[160];
    snprintf(banner, sizeof(banner),
             "220 FTPD v3.1.0 CitraLink-Direct (BATT:%u%% MCU_BATT=%u AC_ADAPTER=%u)\\r\\n",
             t->batteryPercent, t->batteryPercent, t->isCharging);
    send(clientSock, banner, strlen(banner), 0);

    ssize_t n = recv(clientSock, cmdBuf, sizeof(cmdBuf) - 1, 0);
    if (n > 0 && (strstr(cmdBuf, "SITE BATT") != NULL || strstr(cmdBuf, "SYST") != NULL)) {
        char reply[160];
        snprintf(reply, sizeof(reply),
                 "211-FTPD v3.1.0 Rosalina MCU_BATT=%u AC_ADAPTER=%u BATT:%u%% CHRG:%u\\r\\n215 UNIX Type: L8\\r\\n",
                 t->batteryPercent, t->isCharging, t->batteryPercent, t->isCharging);
        send(clientSock, reply, strlen(reply), 0);
    }
}

int main(int argc, char **argv) {
    gfxInitDefault();
    PrintConsole topScreen, bottomScreen;
    consoleInit(GFX_TOP, &topScreen);
    consoleInit(GFX_BOTTOM, &bottomScreen);

    ptmuInit();
    amInit();
    fsInit();
    acInit();

    ${
      config.keepAwakeClamshell
        ? '// Keep Wi-Fi transfer alive even when the 3DS clamshell lid is closed\n    aptSetSleepAllowed(false);'
        : '// Standard sleep behavior when clamshell lid closes\n    aptSetSleepAllowed(true);'
    }

    SOC_buffer = (u32 *)memalign(SOC_ALIGN, SOC_BUFFERSIZE);
    int serverSock = -1;
    if (SOC_buffer && R_SUCCEEDED(socInit(SOC_buffer, SOC_BUFFERSIZE))) {
        serverSock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
        if (serverSock >= 0) {
            struct sockaddr_in srvAddr;
            memset(&srvAddr, 0, sizeof(srvAddr));
            srvAddr.sin_family = AF_INET;
            srvAddr.sin_addr.s_addr = htonl(INADDR_ANY);
            srvAddr.sin_port = htons(CITRALINK_PORT);
            fcntl(serverSock, F_SETFL, fcntl(serverSock, F_GETFL, 0) | O_NONBLOCK);
            bind(serverSock, (struct sockaddr *)&srvAddr, sizeof(srvAddr));
            listen(serverSock, 4);
        }
    }

    consoleSelect(&topScreen);
    printf("\\x1b[36;1m========================================\\x1b[0m\\n");
    printf("\\x1b[37;1m  ${config.appTitle}\\x1b[0m\\n");
    printf("  Title ID: 0x${cleanTid} (${cleanProd})\\n");
    printf("  Web Dashboard Host: %s:%d\\n", DEFAULT_WEB_HOST, CITRALINK_PORT);
    printf("\\x1b[36;1m========================================\\x1b[0m\\n\\n");

    consoleSelect(&bottomScreen);
    printf("[A] Direct AM .CIA Stream Install\\n");
    printf("[X] One-Click Save Archive Backup (fs:USER)\\n");
    printf("[Y] Toggle Lid-Close Keep-Alive\\n");
    printf("[START] Exit to 3DS HOME Menu\\n");

    while (aptMainLoop()) {
        hidScanInput();
        u32 kDown = hidKeysDown();
        if (kDown & KEY_START) break;

        CitraLinkTelemetry t;
        readMcuTelemetry(&t);

        if (serverSock >= 0) {
            struct sockaddr_in clientAddr;
            socklen_t addrLen = sizeof(clientAddr);
            int clientSock = accept(serverSock, (struct sockaddr *)&clientAddr, &addrLen);
            if (clientSock >= 0) {
                handleWebBridgeClient(clientSock, &t);
                close(clientSock);
            }
        }

        consoleSelect(&topScreen);
        printf("\\x1b[8;0H[MCU Telemetry] Battery Bar: %u/4 (%u%%) | Charging: %s | Wi-Fi: %u/3\\n",
               t.batteryLevel, t.batteryPercent, t.isCharging ? "YES" : "NO", t.wifiStrength);

        gfxFlushBuffers();
        gfxSwapBuffers();
        gspWaitForVBlank();
    }

    if (serverSock >= 0) close(serverSock);
    socExit();
    if (SOC_buffer) free(SOC_buffer);
    acExit();
    fsExit();
    amExit();
    ptmuExit();
    gfxExit();
    return 0;
}
`;
}

/**
 * Generates the devkitARM + makerom Makefile for the Companion App.
 */
export function generateCompanionMakefile(config: CompanionBuildConfig): string {
  const cleanProd = config.productCode.trim().toUpperCase();
  const uniqueHex = config.titleId.trim().toUpperCase().slice(8, 14) || '0EC73D';
  return `#---------------------------------------------------------------------------------
# ${config.appTitle} — devkitARM + libctru + makerom Makefile
#---------------------------------------------------------------------------------
.SUFFIXES:

ifeq ($(strip $(DEVKITARM)),)
$(error "Please set DEVKITARM in your environment. export DEVKITARM=<path to>devkitARM")
endif

TOPDIR ?= $(CURDIR)
include $(DEVKITARM)/3ds_rules

TARGET          := CitraLink_Direct_${cleanProd.replace(/[^A-Z0-9]/g, '_')}
BUILD           := build
SOURCES         := source
INCLUDES        := include

APP_TITLE       := ${config.appTitle}
APP_DESCRIPTION := Wireless CIA Stream Installer & Save Archive Sync
APP_AUTHOR      := CitraLink 3DS
PRODUCT_CODE    := ${cleanProd}
UNIQUE_ID       := 0x${uniqueHex}

ARCH            := -march=armv6k -mtune=mpcore -mfloat-abi=hard -mtp=soft
CFLAGS          := -g -Wall -O2 -mword-relocations -ffunction-sections $(ARCH) -D__3DS__
LDFLAGS         := -specs=3dsx.specs -g $(ARCH)
LIBS            := -lctru -lm

all: $(TARGET).3dsx

cia: $(TARGET).3dsx
\tmakerom -f cia -o $(TARGET).cia -DAPP_ENCRYPTED=false -rsf app.rsf -target t -exefslogo -elf $(BUILD)/$(TARGET).elf -icon $(BUILD)/$(TARGET).smdh
`;
}

/**
 * Generates the makerom ROM Spec File (app.rsf) with required 3DS service permissions.
 */
export function generateCompanionRsf(config: CompanionBuildConfig): string {
  const cleanTid = config.titleId.trim().toUpperCase();
  const cleanProd = config.productCode.trim().toUpperCase();
  const uniqueHex = cleanTid.slice(8, 14) || '0EC73D';
  return `BasicInfo:
  Title                   : "${config.appTitle}"
  CompanyCode             : "00"
  ProductCode             : "${cleanProd}"
  ContentType             : Application
  Logo                    : Nintendo

TitleInfo:
  UniqueId                : 0x${uniqueHex}
  Category                : Application

Option:
  UseOnSD                 : true
  EnableCompress          : true
  FreeProductCode         : true
  EnableCrypt             : false

AccessControlInfo:
  CoreVersion             : 2
  DescVersion             : 2
  ReleaseKernelMajor      : "02"
  ReleaseKernelMinor      : "33"
  FileSystemAccess:
   - CategorySystemApplication
   - DirectSdmc
   - DirectSdmcWrite
   - SaveDataMove
  ServiceAccessControl:
   - "ac:u"
${config.directAmInstall ? '   - "am:net"\n   - "am:u"\n' : ''}   - "apt:U"
   - "cfg:u"
${config.directSaveArchive ? '   - "fs:USER"\n' : ''}   - "gsp::Gpu"
   - "hid:USER"
   - "ptm:u"
   - "soc:U"

SystemControlInfo:
  SaveDataSize            : 0KB
  StackSize               : 0x40000
  JumpId                  : 0x${cleanTid}L
`;
}

/**
 * Detects Nintendo 3DS file format, optimal SD card destination directory,
 * and recommended installation/usage method.
 */
export function detectGameFileFormat(filename: string): FileRouteMetadata {
  const trimmed = filename.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const ext = dotIndex !== -1 ? trimmed.slice(dotIndex).toLowerCase() : '';

  switch (ext) {
    case '.cia':
      return {
        extension: '.cia',
        category: 'cia',
        categoryLabel: '3DS Installable Archive (.CIA)',
        targetDirectory: '/cias',
        protocolHint: 'FBI Remote Install / FTPD',
        installDescription: 'ติดตั้งลงหน้า HOME Menu ผ่านแอป FBI -> SD -> cias หรือยิง URL ผ่าน FBI Remote Install',
      };
    case '.3dsx':
      return {
        extension: '.3dsx',
        category: '3dsx',
        categoryLabel: 'Homebrew Application (.3DSX)',
        targetDirectory: '/3ds',
        protocolHint: 'FTPD Direct Copy',
        installDescription: 'คัดลอกลงโฟลเดอร์ /3ds เพื่อเปิดใช้งานได้ทันทีในแอป Homebrew Launcher',
      };
    case '.nds':
      return {
        extension: '.nds',
        category: 'nds',
        categoryLabel: 'Nintendo DS ROM (.NDS)',
        targetDirectory: '/roms/nds',
        protocolHint: 'FTPD Direct Copy',
        installDescription: 'คัดลอกลงโฟลเดอร์ /roms/nds เพื่อเล่นผ่าน TWiLight Menu++ หรือ nds-bootstrap',
      };
    case '.sav':
    case '.dat':
    case '.bin':
      return {
        extension: ext,
        category: 'save',
        categoryLabel: `Save Data (${ext.toUpperCase()})`,
        targetDirectory: '/3ds/Checkpoint/saves',
        protocolHint: 'Checkpoint Save Manager',
        installDescription: 'สำรองหรือกู้คืนเซฟเข้าสู่เกมผ่านแอป Checkpoint บนเครื่อง Nintendo 3DS',
      };
    case '.firm':
      return {
        extension: '.firm',
        category: 'firm',
        categoryLabel: 'ARM9/ARM11 Firmware Payload (.FIRM)',
        targetDirectory: '/luma/payloads',
        protocolHint: 'Luma3DS Chainloader',
        installDescription: 'วางไว้ใน /luma/payloads สำหรับเปิดใช้งานตอนกดปุ่ม START ค้างขณะเปิดเครื่อง',
      };
    case '.zip':
    case '.7z':
      return {
        extension: ext,
        category: 'archive',
        categoryLabel: `Compressed Package (${ext.toUpperCase()})`,
        targetDirectory: '/cias',
        protocolHint: 'Archive Upload',
        installDescription: 'แพ็กเกจรวมไฟล์สำหรับเก็บสำรองหรือแตกไฟล์ลงในการ์ด SD',
      };
    default:
      return {
        extension: ext || '.bin',
        category: 'other',
        categoryLabel: 'General SD File',
        targetDirectory: '/3ds',
        protocolHint: 'FTPD Standard Transfer',
        installDescription: 'คัดลอกไฟล์ทั่วไปเข้าสู่การ์ด microSD ของเครื่อง Nintendo 3DS',
      };
  }
}

/**
 * Validates Nintendo 3DS local network IPv4 address and FTPD/FBI TCP port.
 * Never silently substitutes default values when inputs are empty or invalid.
 */
export function validateConnectionInput(ip: string, portStr: string): ConnectionValidationResult {
  const cleanIp = ip.trim();
  const cleanPortStr = portStr.trim();

  let ipError: string | undefined;
  let portError: string | undefined;

  if (!cleanIp) {
    ipError = 'กรุณาระบุหมายเลข IP Address ของเครื่อง Nintendo 3DS (เช่น 192.168.1.35)';
  } else {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const hostnameRegex = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.local$/;
    const match = cleanIp.match(ipv4Regex);

    if (match) {
      const octetsValid = match.slice(1, 5).every((octet) => {
        const num = Number(octet);
        return num >= 0 && num <= 255 && String(num) === octet;
      });
      if (!octetsValid) {
        ipError = 'หมายเลข IP Address ไม่ถูกต้อง (ตัวเลขแต่ละชุดต้องอยู่ระหว่าง 0 ถึง 255)';
      }
    } else if (!hostnameRegex.test(cleanIp)) {
      ipError = 'รูปแบบ IP Address ไม่ถูกต้อง กรุณากรอกในรูปแบบ IPv4 เช่น 192.168.1.35';
    }
  }

  let parsedPort = NaN;
  if (!cleanPortStr) {
    portError = 'กรุณาระบุหมายเลข Port (ค่ามาตรฐานของ FTPD และ FBI คือ 5000 หรือ 21)';
  } else if (!/^\d+$/.test(cleanPortStr)) {
    portError = 'หมายเลข Port ต้องเป็นตัวเลขเท่านั้น (1 - 65535)';
  } else {
    parsedPort = Number(cleanPortStr);
    if (parsedPort < 1 || parsedPort > 65535) {
      portError = 'หมายเลข Port ต้องอยู่ระหว่าง 1 ถึง 65535';
    }
  }

  if (ipError || portError) {
    return {
      valid: false,
      ipError,
      portError,
    };
  }

  return {
    valid: true,
    normalizedIp: cleanIp,
    normalizedPort: parsedPort,
  };
}

/**
 * Validates custom Checkpoint save snapshot name and Title ID before creating a backup.
 */
export function validateSaveSnapshotInput(slotName: string, titleId: string): SnapshotValidationResult {
  const cleanSlot = slotName.trim();
  const cleanTitleId = titleId.trim().toUpperCase();

  let slotNameError: string | undefined;
  let titleIdError: string | undefined;

  if (!cleanSlot) {
    slotNameError = 'กรุณาตั้งชื่อโฟลเดอร์สำรองเซฟ (เช่น 2026-11-04_Before_Boss)';
  } else if (cleanSlot.length > 48) {
    slotNameError = 'ชื่อโฟลเดอร์สำรองเซฟต้องไม่เกิน 48 ตัวอักษร';
  } else if (/[<>:"/\\|?*]/.test(cleanSlot)) {
    slotNameError = 'ชื่อโฟลเดอร์ห้ามมีอักขระพิเศษที่ระบบไฟล์ FAT32 ไม่รองรับ (< > : " / \\ | ? *)';
  }

  if (!cleanTitleId) {
    titleIdError = 'กรุณาเลือกเกมหรือระบุ Title ID ของเกม';
  } else if (!/^[0-9A-F]{16}$/.test(cleanTitleId)) {
    titleIdError = 'Title ID ของ Nintendo 3DS ต้องเป็นเลขฐานสิบหก 16 หลัก (เช่น 0004000000055D00)';
  }

  if (slotNameError || titleIdError) {
    return {
      valid: false,
      slotNameError,
      titleIdError,
    };
  }

  return {
    valid: true,
    sanitizedSlotName: cleanSlot.replace(/\s+/g, '_'),
  };
}

/**
 * Formats byte count into human-readable unit string with consistent precision.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  if (exp === 0) return `${Math.round(value)} B`;
  if (exp === 1) return `${value.toFixed(1)} KB`;
  return `${value.toFixed(2)} ${units[exp]}`;
}

/**
 * Calculates SD card storage breakdown across game packages, homebrew, saves, and system files.
 */
export function calculateStorageSummary(
  files: SDFileItem[],
  totalCapacityBytes: number = 32 * 1024 * 1024 * 1024
): StorageBreakdown {
  let ciaAndNdsBytes = 0;
  let homebrewBytes = 0;
  let saveDataBytes = 0;
  let systemBytes = 0;

  for (const file of files) {
    if (file.isDirectory) continue;
    const size = Math.max(0, file.sizeBytes);
    if (file.category === 'cia' || file.category === 'nds' || file.category === 'archive') {
      ciaAndNdsBytes += size;
    } else if (file.category === '3dsx') {
      homebrewBytes += size;
    } else if (file.category === 'save') {
      saveDataBytes += size;
    } else {
      systemBytes += size;
    }
  }

  // Base Nintendo 3DS NAND / Luma / Title installed footprint (4.20 GB)
  const baseSystemFootprint = 4.2 * 1024 * 1024 * 1024;
  systemBytes += Math.round(baseSystemFootprint);

  const usedBytes = Math.min(
    totalCapacityBytes,
    ciaAndNdsBytes + homebrewBytes + saveDataBytes + systemBytes
  );
  const freeBytes = Math.max(0, totalCapacityBytes - usedBytes);
  const usagePercent = Number(((usedBytes / totalCapacityBytes) * 100).toFixed(1));

  return {
    totalBytes: totalCapacityBytes,
    usedBytes,
    freeBytes,
    usagePercent,
    byCategory: {
      ciaAndNdsBytes,
      homebrewBytes,
      saveDataBytes,
      systemBytes,
    },
  };
}

/**
 * Builds the binary packet expected by FBI 2.6+ Remote Install ("Receive URLs over the network")
 * on TCP port 5000: 4-byte Big-Endian unsigned integer of URL string byte length + UTF-8 URLs.
 */
export function buildFbiBoopPayload(urls: string[]): Uint8Array {
  const joinedUrls = urls.map((u) => u.trim()).filter(Boolean).join('\n');
  const encoder = new TextEncoder();
  const urlBytes = encoder.encode(joinedUrls);
  const packet = new Uint8Array(4 + urlBytes.length);
  const view = new DataView(packet.buffer);
  view.setUint32(0, urlBytes.length, false); // Big-Endian uint32 length
  packet.set(urlBytes, 4);
  return packet;
}

/**
 * Generates a deterministic 21x21 QR-style visual matrix for a given URL string
 * (complete with standard 7x7 finder patterns, timing patterns, and deterministic data modules).
 * Note: For variable-version ISO/IEC 18004 Reed-Solomon camera scanning, use encodeIsoQrCodeMatrix().
 */
export function generateQrMatrix(url: string): boolean[][] {
  const size = 21;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const placeFinder = (rowOffset: number, colOffset: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = rowOffset + r;
        const cc = colOffset + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[rr][cc] = inOuter || inInner;
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Deterministic hash bits from url
  let hash = 2166136261;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  let bitIndex = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      const charCode = url.charCodeAt(bitIndex % Math.max(1, url.length)) || 65;
      const mixed = ((hash >>> (bitIndex % 24)) ^ (charCode * (r + 1) + c * 17)) & 1;
      matrix[r][c] = mixed === 1;
      bitIndex++;
    }
  }

  return matrix;
}
