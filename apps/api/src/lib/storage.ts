import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** Content-addressed local object storage. Swap for S3-compatible storage by reimplementing these two functions. */
const root = () => path.resolve(process.env.STORAGE_DIR ?? './storage');

export async function putObject(buf: Buffer): Promise<{ sha256: string; storagePath: string }> {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const rel = path.join(sha256.slice(0, 2), sha256);
  const abs = path.join(root(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try { await fs.access(abs); } catch { await fs.writeFile(abs, buf, { flag: 'wx' }).catch(() => undefined); }
  return { sha256, storagePath: rel };
}
export async function getObject(storagePath: string): Promise<Buffer> {
  const abs = path.join(root(), storagePath);
  if (!abs.startsWith(root())) throw new Error('Invalid path');
  return fs.readFile(abs);
}
