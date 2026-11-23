import { z } from 'zod';
import { D } from '@epc/shared';

/** Decimal input accepted as string or number, stored as exact decimal string. */
export const zDec = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try { const d = D(v); if (!d.isFinite()) throw 0; return d.toString(); } catch { ctx.addIssue({ code: 'custom', message: 'Invalid number' }); return z.NEVER; }
});
export const zDecPos = zDec.refine((v) => D(v).gte(0), 'Must be zero or more');
export const zDecOpt = z.union([zDec, z.null()]).optional();
export const zDate = z.coerce.date();
export const zId = z.string().uuid();
export const pid = z.object({ projectId: zId });
export const idParam = z.object({ id: zId });
