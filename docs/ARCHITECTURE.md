# Architecture and decisions

## Stack

| Layer | Choice | Why |
|---|---|---|
| Database | PostgreSQL 16 | Relational integrity, `numeric` for money/quantities, triggers for immutability |
| ORM / migrations | Prisma 6 | Typed queries, versioned SQL migrations checked into git |
| API | Node 22, Fastify 5, Zod, OpenAPI (Swagger UI at `/api/docs`) | See deviation 1 |
| Web | React 19, Vite 7, Tailwind CSS 4, TanStack Query, React Router 7, Lucide icons | See deviation 2 |
| Shared engine | `packages/shared` (TypeScript, decimal.js) | The same calculation code runs in the browser (live previews) and on the server (authoritative) |
| Files | Content-addressed local storage (`STORAGE_DIR`), SHA-256 recorded per document | Swap `apps/api/src/lib/storage.ts` for S3-compatible storage |

### Deviations from the suggested architecture

1. **Fastify instead of NestJS.** Same TypeScript/Node runtime and the same REST + OpenAPI outcome, with far less framework ceremony. Request validation and the OpenAPI document come from one Zod schema per route, so docs cannot drift from behaviour. Business rules live in `apps/api/src/services/*` and are framework-independent.
2. **Vite SPA instead of Next.js.** This is an authenticated internal ERP: no SEO or server rendering need. In production the API serves the built web app from the same origin (`apps/api/src/server.ts`), so it deploys as one container.
3. **No Redis yet.** No workload so far needs a queue or cache: imports are parsed synchronously (a 700-row RA bill parses in about 2 s). Add Redis/BullMQ when PDF generation and bulk exports arrive.
4. **shadcn/ui not installed as a dependency.** The small component kit in `apps/web/src/components/ui.tsx` follows the same patterns (unstyled primitives + Tailwind, native `<dialog>` for modals) without pulling a registry at build time.
5. **Library versions are the latest stable majors with long track records** (Prisma 6, TypeScript 5.9, Zod 3, Vitest 3) rather than this month's new majors.

## Arithmetic

- Money `numeric(18,2)`, rates `numeric(18,2|4)`, quantities `numeric(18,3)`, conversion factors `numeric(18,6)`.
- All calculations use `decimal.js` (40 significant digits, half-up rounding). JavaScript floats never touch a rupee or a cubic metre.
- Amounts are always recomputed as quantity × rate; amounts in imported files are only compared, never trusted.

## Single source of truth: the quantity chain

```
Contract → BOQ revision (versioned, locked once approved)
        → BOQ item (stable itemKey across revisions)
        → Execution activity (breakup: % or fixed ₹/parent unit, own unit + approved conversion)
        → Work order line (subcontractor agreed rate; rate history is prospective)
        → Allocation (quantity, zone/chainage; exceptions need a reason and a second approver)
        → Daily progress (executed)
        → Measurement (MB: draft → SE → billing → PM → commercial → certified)
        → [Bill → payment: next module]
```

Each stage is stored separately and reported separately (allocation matrix), so allocation, execution, measurement, certification and billing are never treated as the same event.

## Integrity safeguards

| Risk | Safeguard | Where |
|---|---|---|
| Approved BOQ edited | Service check + DB trigger blocks any insert/update/delete on items/sections of an APPROVED/SUPERSEDED revision | `migrations/*_integrity_triggers` |
| Approved measurement edited | DB trigger freezes quantity, links, date, chainage, rate once PM-approved; corrections go through a reversal entry | same |
| Double measurement | Chainage overlap (half-open intervals) across all subcontractors of an activity; zone+structure duplicates; cumulative ceilings at allocation, WO line and BOQ scope; re-checked at submission under an advisory lock | `services/measurement.ts` |
| Over-allocation | Scope, WO limit, chainage/zone overlap, wrong BOQ linkage, unapproved rate; exceptions need a reason and a different approver | `services/allocation.ts` |
| Rate tampering | WO edits only in draft; approved rates change only through amendments approved within the approver's financial limit; retrospective changes must cite an authority | `routes/workorders.ts` |
| Bank detail fraud | Changing bank/PAN/GSTIN of an approved subcontractor needs approval permission and a reason, logged as `UPDATE_SENSITIVE` | `routes/subcontractors.ts` |
| Segregation of duties | Drafter cannot approve own WO, amendment, allocation exception, measurement (approve/certify) or reconciliation | routes |
| Silent history loss | Audit log, workflow log, stock ledger and measurement snapshots are append-only (DB triggers) | migrations |
| Concurrency | Document numbers from a row-locked sequence; allocation, measurement, issue and return posting serialised per activity/store/subcontractor with transaction-scoped advisory locks | `lib/sequence.ts`, routes |

## Permissions

Permissions are fine-grained codes (`packages/shared/src/permissions.ts`). Roles are editable sets of permissions per company. A user gets roles through assignments scoped to the whole company or one project, each with an optional financial limit. Approval endpoints check the limit against the amount being approved (WO value, amendment increase, reconciliation recovery, measurement value).
