import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '../src/lib/db';

export async function setupApp() {
  const app = await buildApp();
  const email = `admin+${Date.now()}@test.local`;
  await prisma.user.create({ data: { email, name: 'Test Admin', passwordHash: await bcrypt.hash('Admin@12345', 4), isSuperAdmin: true } });
  const token = await login(app, email, 'Admin@12345');
  return { app, token, api: client(app, token) };
}
export async function login(app: FastifyInstance, email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login failed ${r.body}`);
  return r.json().token as string;
}
export function client(app: FastifyInstance, token: string) {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const r = await app.inject({ method, url: `/api${url}`, payload: payload as never, headers: { authorization: `Bearer ${token}` } });
    return { status: r.statusCode, body: r.body ? (r.headers['content-type']?.toString().includes('json') ? r.json() : r.body) : null };
  };
  const ok = async (method: Parameters<typeof call>[0], url: string, payload?: unknown) => {
    const r = await call(method, url, payload);
    if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { call, ok, get: (u: string) => ok('GET', u), post: (u: string, p?: unknown) => ok('POST', u, p ?? {}), put: (u: string, p: unknown) => ok('PUT', u, p) };
}
/** Creates a user with a role (by code) in the company and returns an API client for them. */
export async function userWithRole(app: FastifyInstance, admin: ReturnType<typeof client>, companyId: string, roleCode: string, opts: { projectId?: string; financialLimit?: string } = {}) {
  const roles = await admin.get(`/companies/${companyId}/roles`);
  const role = roles.find((r: { code: string }) => r.code === roleCode);
  const email = `${roleCode.toLowerCase()}+${Math.random().toString(36).slice(2)}@test.local`;
  await admin.post(`/companies/${companyId}/users`, { name: roleCode, email, password: 'Password@123', roleId: role.id, projectId: opts.projectId ?? null, financialLimit: opts.financialLimit ?? null });
  return client(app, await login(app, email, 'Password@123'));
}
