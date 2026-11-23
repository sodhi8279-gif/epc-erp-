/**
 * Entry point for the standalone desktop mode: the desktop app starts a private PostgreSQL, applies migrations,
 * then runs this file with Electron's bundled Node. Listens on 127.0.0.1 only and serves the built web app.
 */
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { buildApp } from './app';

const app = await buildApp({ logger: false, docs: false });
const webDist = process.env.WEB_DIST!;
if (webDist && fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.status(404).send({ error: 'NOT_FOUND' }) : reply.sendFile('index.html')));
}
const address = await app.listen({ port: Number(process.env.PORT ?? 0), host: '127.0.0.1' });
process.send?.({ type: 'ready', address });
console.log('listening', address);
const stop = async () => { await app.close().catch(() => undefined); process.exit(0); };
process.on('SIGTERM', stop);
process.on('disconnect', stop);
