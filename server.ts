import path from 'path';
import { createServer as createViteServer } from 'vite';
import express from 'express';
import { createApp, detectHostLanIp } from './server/app.ts';

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const dataRoot = path.join(process.cwd(), 'data');

  const { app } = createApp({ dataRoot, port: PORT });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const lanIp = detectHostLanIp();
    console.log(`CitraLink 3DS Server listening on http://${lanIp}:${PORT} (0.0.0.0:${PORT})`);
  });
}

startServer();
