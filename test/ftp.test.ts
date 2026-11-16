import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { Readable } from 'stream';
import { FtpClient, parseFtpListOutput } from '../server/ftpClient.ts';

/**
 * Creates an in-memory mock RFC 959 FTP server on a random loopback port.
 */
function createMockFtpServer(): Promise<{
  port: number;
  close: () => Promise<void>;
  storage: Map<string, Buffer>;
}> {
  return new Promise((resolve) => {
    const storage = new Map<string, Buffer>();
    const activeSockets = new Set<net.Socket>();
    let pasvDataServer: net.Server | null = null;
    let pasvDataPort = 0;
    let currentDataSocket: net.Socket | null = null;
    let nextDataHandler: ((sock: net.Socket) => void) | null = null;

    const attachDataHandler = (h: (sock: net.Socket) => void) => {
      if (currentDataSocket && !currentDataSocket.destroyed) {
        h(currentDataSocket);
      } else {
        nextDataHandler = h;
      }
    };

    const server = net.createServer((ctrlSock) => {
      activeSockets.add(ctrlSock);
      ctrlSock.on('close', () => activeSockets.delete(ctrlSock));
      ctrlSock.write('220 CitraLink Mock FTP Server Ready\r\n');

      let currentDir = '/';
      ctrlSock.on('data', (buf) => {
        const text = buf.toString('utf-8');
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

        for (const line of lines) {
          const parts = line.split(' ');
          const cmd = parts[0].toUpperCase();
          const arg = parts.slice(1).join(' ');

          if (cmd === 'USER') {
            ctrlSock.write('331 User name okay, need password.\r\n');
          } else if (cmd === 'PASS') {
            ctrlSock.write('230 User logged in, proceed.\r\n');
          } else if (cmd === 'TYPE') {
            ctrlSock.write('200 Type set to ' + arg + '.\r\n');
          } else if (cmd === 'CWD') {
            currentDir = arg;
            ctrlSock.write('250 Directory changed to ' + currentDir + '.\r\n');
          } else if (cmd === 'PASV') {
            if (pasvDataServer) {
              pasvDataServer.close();
            }
            currentDataSocket = null;
            nextDataHandler = null;
            pasvDataServer = net.createServer((dataSock) => {
              currentDataSocket = dataSock;
              activeSockets.add(dataSock);
              dataSock.on('close', () => {
                activeSockets.delete(dataSock);
                if (currentDataSocket === dataSock) currentDataSocket = null;
              });
              if (nextDataHandler) {
                const h = nextDataHandler;
                nextDataHandler = null;
                h(dataSock);
              }
            });
            pasvDataServer.listen(0, '127.0.0.1', () => {
              pasvDataPort = (pasvDataServer!.address() as net.AddressInfo).port;
              const p1 = Math.floor(pasvDataPort / 256);
              const p2 = pasvDataPort % 256;
              ctrlSock.write(`227 Entering Passive Mode (127,0,0,1,${p1},${p2})\r\n`);
            });
          } else if (cmd === 'LIST') {
            ctrlSock.write('150 Opening ASCII mode data connection for file list.\r\n');
            attachDataHandler((dataSock) => {
              let listing = 'drwxr-xr-x 1 owner group 0 Nov 04 12:00 cias\r\n';
              for (const [key, val] of storage.entries()) {
                listing += `-rw-r--r-- 1 owner group ${val.length} Nov 04 12:00 ${key}\r\n`;
              }
              dataSock.write(listing, () => {
                dataSock.end();
                ctrlSock.write('226 Transfer complete.\r\n');
              });
            });
          } else if (cmd === 'STOR') {
            ctrlSock.write('150 Ok to send data.\r\n');
            const targetName = arg.replace(/^.*[/\\]/, '');
            attachDataHandler((dataSock) => {
              const chunks: Buffer[] = [];
              dataSock.on('data', (c) => chunks.push(c));
              dataSock.on('end', () => {
                storage.set(targetName, Buffer.concat(chunks));
                ctrlSock.write('226 Transfer complete.\r\n');
              });
            });
          } else if (cmd === 'RETR') {
            const targetName = arg.replace(/^.*[/\\]/, '');
            const content = storage.get(targetName);
            if (!content) {
              ctrlSock.write('550 File not found.\r\n');
            } else {
              ctrlSock.write('150 Opening BINARY mode data connection.\r\n');
              attachDataHandler((dataSock) => {
                dataSock.end(content, () => {
                  ctrlSock.write('226 Transfer complete.\r\n');
                });
              });
            }
          } else if (cmd === 'MKD') {
            ctrlSock.write(`257 "${arg}" created successfully.\r\n`);
          } else if (cmd === 'DELE') {
            const targetName = arg.replace(/^.*[/\\]/, '');
            if (storage.has(targetName)) {
              storage.delete(targetName);
              ctrlSock.write('250 File deleted successfully.\r\n');
            } else {
              ctrlSock.write('550 File not found.\r\n');
            }
          } else if (cmd === 'QUIT') {
            ctrlSock.write('221 Goodbye.\r\n');
            ctrlSock.end();
          } else {
            ctrlSock.write('502 Command not implemented.\r\n');
          }
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        storage,
        close: () =>
          new Promise((done) => {
            for (const s of activeSockets) s.destroy();
            if (pasvDataServer) pasvDataServer.close();
            server.close(() => done());
          }),
      });
    });
  });
}

test('parseFtpListOutput handles UNIX, DOS, and MLSD listing formats', () => {
  const unixText = `
drwxr-xr-x 1 owner group 0 Nov 04 12:00 cias
-rw-r--r-- 1 owner group 1048576 Nov 04 12:00 game.cia
`;
  const parsedUnix = parseFtpListOutput(unixText);
  assert.equal(parsedUnix.length, 2);
  assert.equal(parsedUnix[0].name, 'cias');
  assert.equal(parsedUnix[0].isDirectory, true);
  assert.equal(parsedUnix[1].name, 'game.cia');
  assert.equal(parsedUnix[1].size, 1048576);
  assert.equal(parsedUnix[1].isDirectory, false);

  const dosText = `
11-04-26  04:30PM       <DIR>          3ds
11-04-26  04:32PM             20971520 game.3dsx
`;
  const parsedDos = parseFtpListOutput(dosText);
  assert.equal(parsedDos.length, 2);
  assert.equal(parsedDos[0].name, '3ds');
  assert.equal(parsedDos[0].isDirectory, true);
  assert.equal(parsedDos[1].name, 'game.3dsx');
  assert.equal(parsedDos[1].size, 20971520);
});

test('FtpClient connects, authenticates, uploads with progress, downloads, and deletes against RFC 959 server', async () => {
  const mock = await createMockFtpServer();
  const client = new FtpClient(3000);

  try {
    // 1. Connect & Login
    const loginRes = await client.connect('127.0.0.1', mock.port, 'anonymous', '');
    assert.equal(loginRes.code, 230);

    // 2. Upload with progress
    const payload = Buffer.from('TEST_CIA_CONTENT_PAYLOAD_1234567890');
    const uploadStream = Readable.from(payload);
    let progressReported = 0;

    const upRes = await client.upload('/cias/test.cia', uploadStream, (bytes) => {
      progressReported = bytes;
    });

    assert.equal(upRes.bytesWritten, payload.length);
    assert.equal(progressReported, payload.length);
    assert.equal(mock.storage.get('test.cia')?.toString('utf-8'), payload.toString('utf-8'));

    // 3. List
    const list = await client.list('/cias');
    assert.ok(list.some((f) => f.name === 'test.cia' && f.size === payload.length));

    // 4. Download
    const downloaded = await client.downloadToBuffer('/cias/test.cia');
    assert.equal(downloaded.toString('utf-8'), payload.toString('utf-8'));

    // 5. Mkdir
    const mkdRes = await client.mkdir('/new_folder');
    assert.equal(mkdRes.code, 257);

    // 6. Delete
    const delRes = await client.delete('/cias/test.cia');
    assert.equal(delRes.code, 250);
    assert.equal(mock.storage.has('test.cia'), false);

    // 7. Quit
    await client.quit();
  } finally {
    client.cleanup();
    await mock.close();
  }
});
