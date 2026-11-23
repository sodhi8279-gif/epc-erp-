import { buildApp } from './app';
import path from 'node:path';
import fs from 'node:fs';
import fastifyStatic from '@fastify/static';

const app = await buildApp({ logger: true });
// In production the built web app is served from the same origin.
const webDist = path.resolve(import.meta.dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.status(404).send({ error: 'NOT_FOUND' }) : reply.sendFile('index.html')));
}
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '0.0.0.0' });
