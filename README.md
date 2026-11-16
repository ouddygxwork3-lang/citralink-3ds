# CitraLink 3DS — Wireless Game, Homebrew & Save Manager

CitraLink 3DS is a comprehensive web interface and backend bridge for managing Nintendo 3DS consoles over Wi-Fi, supporting both physical consoles (via FTPD Pro / FBI Remote Install) and virtual microSD environments (`./data/virtual-sd`).

---

## Features

- **Binary 3DS/DS Parser (`src/utils/binary3dsParser.ts`)**:
  - Slice-based byte reader (`inspect3dsFile`) reading only specific header offsets.
  - Authentic Title ID extraction from TMD/Ticket bodies (RSA-2048/SHA-256 signatures).
  - Product code inspection from NCCH headers (`CTR-P-XXXX`, `TWL-XXXX`, `NTR-XXXX`).
  - Morton Z-order 8x8 curve unswizzling for SMDH 48x48 app icons.
  - 4-bpp palette tile decoding for Nintendo DS 32x32 banner icons.
  - NoCrypto flag detection distinguishing decrypted ROMs from encrypted CDN content.

- **Compliant ISO/IEC 18004 QR Matrix Generator (`src/utils/qrCodeEncoder.ts`)**:
  - Multi-version Reed-Solomon Error Correction Level M generator (Versions 1–40).
  - Compliant penalty masking and alignment patterns.
  - Independently verified with `jsQR`.
  - Throws `QrDataTooLongError` on oversized inputs instead of silent truncation.

- **Modular Backend Architecture (`server/`)**:
  - `server/pathUtils.ts`: Sandboxing preventing path traversal (`..`, null-byte injections) and SSRF protection (private LAN host filtering).
  - `server/ftpClient.ts`: RFC 959 TCP client over Node `net.Socket` with sequential command-response state loop, PASV socket handling, and progress tracking.
  - `server/sdBackend.ts`: Common `SdBackend` abstraction implemented by `VirtualSdBackend` (sandboxed in `./data/virtual-sd`) and `HardwareFtpBackend` (communicating with 3DS FTPD).
  - `server/transferManager.ts`: Asynchronous job tracking with real byte progress and transfer speed.
  - `server/vaultManager.ts`: Checkpoint save scanning, SHA-256 integrity digests, tagging, pinning, restore, and PKZIP exports verified with `fflate`.
  - `server/app.ts`: `createApp({ dataRoot })` factory providing clean REST endpoints.

- **HTTP Byte-Range Streamer (`/api/stream/:filename` & `/api/s/:id`)**:
  - HTTP Range 206 streaming for FBI Remote Install / QR code scanning.
  - Returns proper HTTP 404 for missing files (never fabricates dummy CIA data).
  - Short URL mapping (`/api/s/:id`) generating compact, quick-scanning QR codes.

- **Nintendo 3DS Homebrew Companion (`3ds-companion/`)**:
  - Native libctru / devkitARM C source (`source/main.c`) with non-blocking socket loop.
  - `AM_StartCiaInstall` direct streaming installer via `am:net`.
  - MCU battery and AC adapter telemetry reporting.
  - Direct save archive extraction via `FSUSER_OpenArchive` (`ARCHIVE_SAVEDATA`).

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation & Run

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (Express server + Vite SPA middleware)
npm run dev

# 3. Build production bundle
npm run build

# 4. Start production server
npm start
```

### Running Tests & Linting

```bash
# Run unit and integration tests (Node built-in runner)
npm test

# Type-check TypeScript codebase
npm run lint
```

---

## REST API Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/bridge/info` | Host LAN IP, active protocols, and directory paths |
| `GET` | `/api/local-roms` | ROMs on server disk with binary header inspection |
| `GET` | `/api/sd/list?path=...` | List SD card files (Virtual SD or Hardware FTP) |
| `GET` | `/api/sd/usage` | SD card capacity and categorized usage summary |
| `POST` | `/api/sd/mkdir` | Create folder on SD card |
| `POST` | `/api/sd/delete` | Delete file/folder on SD card |
| `GET` | `/api/sd/download?path=...` | Download file from SD card |
| `POST` | `/api/staging/upload` | Stage file, compute SHA-256, and enqueue SD transfer |
| `GET` | `/api/transfers/:id` | Poll transfer job byte progress and transfer speed |
| `GET` | `/api/stream/:filename` | HTTP Range 206 stream for FBI installation |
| `GET` | `/api/s/:id` | Short URL redirect/stream for compact QR codes |
| `GET` | `/api/checkpoint/titles` | Discover installed Checkpoint games on SD |
| `GET` | `/api/vault/list` | List all local save backups |
| `POST` | `/api/vault/backup` | Create save backup with SHA-256 digest |
| `POST` | `/api/vault/restore` | Restore save backup to SD Checkpoint directory |
| `GET` | `/api/vault/export-zip` | Download save backups as PKZIP archive |
| `POST` | `/api/ftp/probe` | Test TCP connection to 3DS console |
| `POST` | `/api/ftp/scan` | Subnet scan for 3DS FTPD / FBI services |
| `POST` | `/api/console/telemetry` | Query battery level and charging state |
| `POST` | `/api/fbi/push` | Push remote installation URL to FBI |
