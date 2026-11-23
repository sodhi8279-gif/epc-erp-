import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** Recreates the disposable *_test database schema, then applies migrations (incl. integrity triggers). */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://epc:epc@localhost:5432/epc_test';
  if (!/\/[\w-]*_test(\?|$)/.test(url)) throw new Error('Refusing to reset a database whose name does not end in _test');
  const db = new PrismaClient({ datasources: { db: { url } } });
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await db.$executeRawUnsafe('CREATE SCHEMA public');
  await db.$disconnect();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
}
