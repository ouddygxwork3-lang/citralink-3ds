import net from 'net';
import { Readable, PassThrough } from 'stream';

export interface FtpFileEntry {
  name: string;
  size: number;
  isDirectory: boolean;
  modifiedAt?: string;
}

export interface FtpResponse {
  code: number;
  message: string;
}

export class FtpClient {
  private socket: net.Socket | null = null;
  private buffer = '';
  private pendingCallback: ((res: FtpResponse) => void) | null = null;
  private activeHost = '';
  private activePort = 21;
  private timeoutMs = 8000;

  constructor(timeoutMs = 8000) {
    this.timeoutMs = timeoutMs;
  }

  /** Connects to FTP server, receives greeting banner, and logs in. */
  async connect(host: string, port = 21, user = 'anonymous', pass = ''): Promise<FtpResponse> {
    this.activeHost = host;
    this.activePort = port;

    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      this.socket = sock;
      sock.setTimeout(this.timeoutMs);

      const onConnectError = (err: Error) => {
        this.cleanup();
        reject(new Error(`FTP connection to ${host}:${port} failed: ${err.message}`));
      };

      sock.once('error', onConnectError);
      sock.once('timeout', () => {
        this.cleanup();
        reject(new Error(`FTP connection to ${host}:${port} timed out`));
      });

      this.setupDataHandling();

      sock.connect(port, host, () => {
        sock.removeListener('error', onConnectError);

        // Wait for 220 banner
        this.waitForResponse()
          .then(async (greeting) => {
            if (greeting.code !== 220) {
              throw new Error(`Unexpected FTP banner code: ${greeting.code} (${greeting.message})`);
            }
            // Send USER
            const userRes = await this.sendCommand(`USER ${user}`);
            if (userRes.code === 331) {
              const passRes = await this.sendCommand(`PASS ${pass}`);
              if (passRes.code !== 230 && passRes.code !== 202) {
                throw new Error(`FTP authentication failed: ${passRes.message}`);
              }
              resolve(passRes);
            } else if (userRes.code === 230 || userRes.code === 200) {
              resolve(userRes);
            } else {
              throw new Error(`FTP USER rejected: ${userRes.code} ${userRes.message}`);
            }
          })
          .catch((err) => {
            this.cleanup();
            reject(err);
          });
      });
    });
  }

  private setupDataHandling() {
    if (!this.socket) return;
    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf-8');
      this.checkBufferForReply();
    });

    this.socket.on('error', (err) => {
      if (this.pendingCallback) {
        const cb = this.pendingCallback;
        this.pendingCallback = null;
        cb({ code: 500, message: `Control socket error: ${err.message}` });
      }
    });

    this.socket.on('close', () => {
      if (this.pendingCallback) {
        const cb = this.pendingCallback;
        this.pendingCallback = null;
        cb({ code: 421, message: 'FTP control connection closed unexpectedly' });
      }
    });
  }

  /** Parses FTP responses according to RFC 959 (supporting single and multi-line replies). */
  private checkBufferForReply() {
    if (!this.pendingCallback) return;

    let searchPos = 0;
    let code: number | null = null;
    let isMulti = false;

    while (true) {
      const nl = this.buffer.indexOf('\n', searchPos);
      if (nl === -1) return;

      const raw = this.buffer.slice(searchPos, nl);
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      const nextLineStart = nl + 1;

      if (code === null) {
        const matchSingle = /^(\d{3})\s(.*)$/.exec(line);
        const matchMulti = /^(\d{3})-(.*)$/.exec(line);

        if (matchSingle) {
          code = Number(matchSingle[1]);
          const fullMessage = this.buffer.slice(0, nextLineStart).trim();
          this.buffer = this.buffer.slice(nextLineStart);
          const cb = this.pendingCallback;
          this.pendingCallback = null;
          cb({ code, message: fullMessage });
          return;
        } else if (matchMulti) {
          code = Number(matchMulti[1]);
          isMulti = true;
          searchPos = nextLineStart;
        } else {
          // Skip leading non-response lines
          searchPos = nextLineStart;
        }
      } else if (isMulti) {
        const matchEnd = new RegExp(`^${code}\\s(.*)$`).exec(line);
        if (matchEnd) {
          const fullMessage = this.buffer.slice(0, nextLineStart).trim();
          this.buffer = this.buffer.slice(nextLineStart);
          const cb = this.pendingCallback;
          this.pendingCallback = null;
          cb({ code, message: fullMessage });
          return;
        }
        searchPos = nextLineStart;
      }
    }
  }

  waitForResponse(): Promise<FtpResponse> {
    return new Promise((resolve) => {
      this.pendingCallback = resolve;
      this.checkBufferForReply();
    });
  }

  /** Sends a raw FTP command and waits for the server reply. */
  async sendCommand(cmd: string): Promise<FtpResponse> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('FTP control socket is not connected');
    }
    const cleanCmd = cmd.trim();
    return new Promise((resolve, reject) => {
      this.pendingCallback = resolve;
      this.socket!.write(`${cleanCmd}\r\n`, (err) => {
        if (err) {
          this.pendingCallback = null;
          reject(err);
        } else {
          this.checkBufferForReply();
        }
      });
    });
  }

  /** Enters Passive Mode (PASV) and returns connection coordinates for the data socket. */
  async pasv(): Promise<{ host: string; port: number }> {
    const res = await this.sendCommand('PASV');
    if (res.code !== 227) {
      throw new Error(`PASV failed: ${res.code} ${res.message}`);
    }
    const match = /227[^\d]+(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(res.message);
    if (!match) {
      throw new Error(`Could not parse PASV response: ${res.message}`);
    }
    const pasvIp = `${match[1]}.${match[2]}.${match[3]}.${match[4]}`;
    const port = Number(match[5]) * 256 + Number(match[6]);
    const host = pasvIp === '0.0.0.0' || pasvIp.startsWith('127.') ? this.activeHost : pasvIp;
    return { host, port };
  }

  /** Lists directory contents using LIST (or MLSD). */
  async list(remotePath = '/'): Promise<FtpFileEntry[]> {
    await this.sendCommand('TYPE A');
    const { host, port } = await this.pasv();

    return new Promise((resolve, reject) => {
      const dataSock = new net.Socket();
      let rawData = '';

      dataSock.setTimeout(this.timeoutMs);
      dataSock.on('data', (c) => {
        rawData += c.toString('utf-8');
      });

      dataSock.once('error', (err) => {
        reject(new Error(`FTP data connection error during LIST: ${err.message}`));
      });

      dataSock.connect(port, host, async () => {
        try {
          const listRes = await this.sendCommand(`LIST ${remotePath}`);
          if (listRes.code !== 150 && listRes.code !== 125) {
            dataSock.destroy();
            reject(new Error(`LIST failed: ${listRes.code} ${listRes.message}`));
            return;
          }

          const dataClosed = new Promise<void>((r) => dataSock.once('close', () => r()));
          const ctrlComplete = this.waitForResponse();

          const [_, completeRes] = await Promise.all([dataClosed, ctrlComplete]);
          if (completeRes.code !== 226 && completeRes.code !== 250) {
            reject(new Error(`LIST transfer completion failed: ${completeRes.code} ${completeRes.message}`));
            return;
          }
          const entries = parseFtpListOutput(rawData);
          resolve(entries);
        } catch (e) {
          dataSock.destroy();
          reject(e);
        }
      });
    });
  }

  /** Uploads a file stream via STOR with real progress reporting. */
  async upload(
    remotePath: string,
    stream: NodeJS.ReadableStream,
    onProgress?: (bytes: number) => void
  ): Promise<{ bytesWritten: number }> {
    await this.sendCommand('TYPE I');
    const { host, port } = await this.pasv();

    return new Promise((resolve, reject) => {
      const dataSock = new net.Socket();
      let bytesTransferred = 0;

      dataSock.setTimeout(this.timeoutMs);
      dataSock.once('error', (err) => {
        reject(new Error(`FTP data connection error during STOR: ${err.message}`));
      });

      dataSock.connect(port, host, async () => {
        try {
          const storRes = await this.sendCommand(`STOR ${remotePath}`);
          if (storRes.code !== 150 && storRes.code !== 125) {
            dataSock.destroy();
            reject(new Error(`STOR failed: ${storRes.code} ${storRes.message}`));
            return;
          }

          stream.on('data', (chunk: Buffer | Uint8Array) => {
            bytesTransferred += chunk.length;
            if (onProgress) onProgress(bytesTransferred);
          });

          stream.on('error', (err) => {
            dataSock.destroy();
            reject(err);
          });

          stream.pipe(dataSock);

          const dataClosed = new Promise<void>((r) => dataSock.once('close', () => r()));
          const ctrlComplete = this.waitForResponse();

          const [_, completeRes] = await Promise.all([dataClosed, ctrlComplete]);
          if (completeRes.code !== 226 && completeRes.code !== 250) {
            reject(new Error(`Upload transfer completion failed: ${completeRes.code} ${completeRes.message}`));
            return;
          }
          resolve({ bytesWritten: bytesTransferred });
        } catch (e) {
          dataSock.destroy();
          reject(e);
        }
      });
    });
  }

  /** Downloads a remote file directly into a Writable stream, ensuring control channel sync. */
  async downloadToStream(
    remotePath: string,
    writable: NodeJS.WritableStream
  ): Promise<{ bytesDownloaded: number }> {
    await this.sendCommand('TYPE I');
    const { host, port } = await this.pasv();

    return new Promise((resolve, reject) => {
      const dataSock = new net.Socket();
      let bytesDownloaded = 0;

      dataSock.setTimeout(this.timeoutMs);
      dataSock.once('error', (err) => {
        reject(new Error(`FTP data connection error during RETR: ${err.message}`));
      });

      dataSock.connect(port, host, async () => {
        try {
          const retrRes = await this.sendCommand(`RETR ${remotePath}`);
          if (retrRes.code !== 150 && retrRes.code !== 125) {
            dataSock.destroy();
            reject(new Error(`RETR failed: ${retrRes.code} ${retrRes.message}`));
            return;
          }

          dataSock.on('data', (chunk: Buffer) => {
            bytesDownloaded += chunk.length;
          });

          dataSock.pipe(writable, { end: false });

          const dataClosed = new Promise<void>((r) => dataSock.once('close', () => r()));
          const ctrlComplete = this.waitForResponse();

          const [_, completeRes] = await Promise.all([dataClosed, ctrlComplete]);
          if (completeRes.code !== 226 && completeRes.code !== 250) {
            reject(new Error(`Download transfer completion failed: ${completeRes.code} ${completeRes.message}`));
            return;
          }
          resolve({ bytesDownloaded });
        } catch (e) {
          dataSock.destroy();
          reject(e);
        }
      });
    });
  }

  /** Downloads a remote file completely into a Buffer. */
  async downloadToBuffer(remotePath: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const pass = new PassThrough();
    pass.on('data', (c: Buffer) => chunks.push(c));
    await this.downloadToStream(remotePath, pass);
    return Buffer.concat(chunks);
  }

  /** Creates a directory via MKD. */
  async mkdir(remotePath: string): Promise<FtpResponse> {
    const res = await this.sendCommand(`MKD ${remotePath}`);
    if (res.code !== 257 && res.code !== 250) {
      throw new Error(`MKD failed: ${res.code} ${res.message}`);
    }
    return res;
  }

  /** Deletes a file via DELE (falls back to RMD if directory). */
  async delete(remotePath: string): Promise<FtpResponse> {
    const deleRes = await this.sendCommand(`DELE ${remotePath}`);
    if (deleRes.code === 250) return deleRes;
    const rmdRes = await this.sendCommand(`RMD ${remotePath}`);
    if (rmdRes.code === 250) return rmdRes;
    throw new Error(`Delete failed: ${deleRes.code} / ${rmdRes.code}`);
  }

  /** Closes FTP connection gracefully. */
  async quit(): Promise<void> {
    try {
      if (this.socket && !this.socket.destroyed) {
        await this.sendCommand('QUIT');
      }
    } catch {
      // Ignore errors on quit
    } finally {
      this.cleanup();
    }
  }

  cleanup() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = '';
    this.pendingCallback = null;
  }
}

/** Parses standard Unix & DOS FTP LIST directory output. */
export function parseFtpListOutput(rawText: string): FtpFileEntry[] {
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const entries: FtpFileEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // MLSD format: type=dir;size=0;modify=20261104; filename
    if (trimmed.includes('type=') && trimmed.includes(';')) {
      const match = /type=(dir|file|cdir|pdir);(?:size=(\d+);)?(?:modify=([^;]+);)?\s*(.+)$/i.exec(trimmed);
      if (match) {
        const type = match[1].toLowerCase();
        if (type === 'cdir' || type === 'pdir') continue;
        const size = match[2] ? Number(match[2]) : 0;
        const name = match[4].trim();
        if (name === '.' || name === '..') continue;
        entries.push({
          name,
          size,
          isDirectory: type === 'dir',
          modifiedAt: match[3],
        });
        continue;
      }
    }

    // UNIX format: drwxr-xr-x 1 owner group 4096 Nov 04 12:34 dirname
    //              -rw-r--r-- 1 owner group 123456 Nov 04 12:34 filename.cia
    const unixMatch = /^([drwx-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d+\s+[\d:]+)\s+(.+)$/.exec(trimmed);
    if (unixMatch) {
      const isDir = unixMatch[1].startsWith('d');
      const size = Number(unixMatch[2]);
      const name = unixMatch[4].trim();
      if (name === '.' || name === '..') continue;
      entries.push({
        name,
        size: isDir ? 0 : size,
        isDirectory: isDir,
        modifiedAt: unixMatch[3],
      });
      continue;
    }

    // Windows/DOS format: 11-04-26 04:30PM <DIR> dirname
    //                     11-04-26 04:30PM 12345 filename.cia
    const dosMatch = /^(\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}(?:[AP]M)?)\s+(<DIR>|\d+)\s+(.+)$/i.exec(trimmed);
    if (dosMatch) {
      const isDir = dosMatch[2].toUpperCase() === '<DIR>';
      const size = isDir ? 0 : Number(dosMatch[2]);
      const name = dosMatch[3].trim();
      if (name === '.' || name === '..') continue;
      entries.push({
        name,
        size,
        isDirectory: isDir,
        modifiedAt: dosMatch[1],
      });
      continue;
    }

    // Fallback: simple word splitting if line ends with a file name
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 4) {
      const last = parts[parts.length - 1];
      if (last !== '.' && last !== '..') {
        const isDir = parts[0].startsWith('d') || parts.includes('<DIR>');
        const size = Number(parts[parts.length - 2]) || 0;
        entries.push({
          name: last,
          size: isDir ? 0 : size,
          isDirectory: isDir,
        });
      }
    }
  }

  return entries;
}
