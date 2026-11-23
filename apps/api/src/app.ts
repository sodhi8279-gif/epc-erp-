import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from './lib/errors';
import { prisma } from './lib/db';
import authRoutes from './routes/auth';
import orgRoutes from './routes/org';
import documentRoutes from './routes/documents';
import boqRoutes from './routes/boq';
import activityRoutes from './routes/activities';
import subcontractorRoutes from './routes/subcontractors';
import workOrderRoutes from './routes/workorders';
import allocationRoutes from './routes/allocations';
import measurementRoutes from './routes/measurements';
import materialRoutes from './routes/materials';
import reportRoutes from './routes/reports';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set (≥32 chars)');

  await app.register(cors, { origin: process.env.CORS_ORIGIN?.split(',') ?? true, credentials: true });
  await app.register(cookie);
  await app.register(jwt, { secret, cookie: { cookieName: 'epc_token', signed: false }, sign: { expiresIn: '12h' } });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'EPC Contract, BOQ, Subcontractor Billing & Material Reconciliation API', version: '0.1.0' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  // Every /api route except login/docs requires a valid token whose user is still active.
  app.addHook('onRequest', async (req) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || url === '/api/auth/login' || url.startsWith('/api/docs') || url === '/api/health') return;
    try {
      const payload = await req.jwtVerify<{ sub: string }>();
      const u = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!u || !u.active) throw new Error('inactive');
      req.user = { id: u.id, name: u.name, email: u.email, isSuperAdmin: u.isSuperAdmin };
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'VALIDATION', message: 'Invalid input', details: err.issues });
    const anyErr = err as { validation?: unknown; statusCode?: number; message: string; code?: string };
    if (anyErr.validation) return reply.status(400).send({ error: 'VALIDATION', message: anyErr.message, details: anyErr.validation });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: 'DUPLICATE', message: `A record with this ${(err.meta?.target as string[] | undefined)?.join(', ') ?? 'value'} already exists` });
      if (err.code === 'P2025') return reply.status(404).send({ error: 'NOT_FOUND', message: 'Record not found' });
    }
    // Database integrity triggers raise P0001 with a human-readable message.
    const m = /P0001|raise|cannot be|append-only|locked/i.test(anyErr.message) ? anyErr.message.match(/(?:Message: `|ERROR: )?([^`\n]*(?:cannot|append-only|locked|only be|read-only)[^`\n]*)/i) : null;
    if (m) return reply.status(409).send({ error: 'INTEGRITY', message: m[1].replace(/^.*?ERROR:\s*/, '') });
    if (anyErr.statusCode && anyErr.statusCode < 500) return reply.status(anyErr.statusCode).send({ error: anyErr.code ?? 'ERROR', message: anyErr.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'INTERNAL', message: 'Unexpected server error' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(orgRoutes, { prefix: '/api' });
  await app.register(documentRoutes, { prefix: '/api' });
  await app.register(boqRoutes, { prefix: '/api' });
  await app.register(activityRoutes, { prefix: '/api' });
  await app.register(subcontractorRoutes, { prefix: '/api' });
  await app.register(workOrderRoutes, { prefix: '/api' });
  await app.register(allocationRoutes, { prefix: '/api' });
  await app.register(measurementRoutes, { prefix: '/api' });
  await app.register(materialRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  return app;
}
