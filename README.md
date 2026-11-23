# EPC Contract, BOQ, Subcontractor Billing & Material Reconciliation

One integrated record for client contract BOQ, subcontractor work, measurements, materials and (next) bills and payments, for a company with a headquarters and multiple project sites.

**Status: phase 1 (foundation modules) complete.** Billing, deductions, GST/TDS, payments and reports follow once the rest of the specification is received (the brief was cut off in Part 9).

## What works today

| Module | Highlights |
|---|---|
| Organisation & access | Companies, projects, users; 14 configurable roles; permissions scoped to company or project with financial limits; segregation of duties; append-only audit log with before/after diff |
| Contracts & BOQ | Contracts, BOQ sections/items, original / revised / variation revisions with item identity kept across revisions, extra / substituted / deviated items, item-by-item comparison, submit → approve workflow. Approved revisions are locked by the database itself |
| BOQ import wizard | Upload .xlsx/.csv → header and column detection (multi-row headers) → mapping → review grid with per-row errors/warnings (missing/unknown units, non-numeric values, qty × rate ≠ amount, duplicate item numbers) → bulk corrections → confirm into a **draft** revision that still needs approval. Original file kept with SHA-256. Tested on RA Bill 32 (676 rows) |
| Activity breakup | Split a BOQ item into activities by % or fixed ₹/unit (or mixed), each with its own unit and an approved conversion basis; must reconcile to the client rate; rate layers screen: client rate → internal budget → subcontract rates → margin |
| Subcontractors & work orders | Master with GSTIN/PAN/IFSC validation, compliance documents with expiry and verification, onboarding → active; bank-detail changes need authority + reason. Work orders against approved activities, approval within financial limit, amendments with prospective rate history |
| Work allocation | Allocation matrix keeping contract → revised → allocated → executed → measured → approved → certified separate; detects scope overrun, WO limit, chainage/zone overlap, wrong BOQ linkage, unapproved rate; exceptions need a reason and a second approver; daily site progress |
| Measurement book | Pipeline (chainage), excavation, RCC, rebar (d²/162) and generic formulas with live preview; draft → SE verification → billing scrutiny → PM approval → commercial review → certification; return with comments, revision snapshots, reversal entries; blocks overlapping chainage and quantities beyond allocation, WO or BOQ scope |
| Materials | Material master with dual units (e.g. Bag/Kg), stores, GRN, requisitions, issue vouchers (recoverable / free issue / returnable…), acknowledgement, printable voucher, returns by condition, transfers between subcontractors or work orders, weighted-average stock ledger, contractor material ledger |
| Reconciliation | Consumption norms with wastage; A–J statement per material in both units; excess consumption (recovered) kept distinct from unconsumed balance (carried forward, recovered only on final reconciliation); approval workflow |

## Run locally

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL and a long JWT_SECRET
cd apps/api && npx prisma migrate deploy
pnpm seed            # company + super admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
pnpm seed --demo     # optional: clearly labelled DEMO project and one user per role
cd ../.. && pnpm dev:api    # http://localhost:4000, API docs at /api/docs
pnpm dev:web                # http://localhost:5173
```

Default local login `admin@epc.local` / `Admin@12345` (change it). Demo users: `<role>@demo.local` / `Demo@12345`, e.g. `billing.engineer@demo.local`.

Production: `docker compose up --build` (single container serving API + web, plus PostgreSQL). The Dockerfile has not been built in the development environment (no Docker daemon there); treat it as a starting point.

## Tests

```bash
pnpm --filter @epc/shared test   # 16 calculation-engine tests (breakup, reconciliation, MB formulas, parsing)
pnpm --filter @epc/api test      # 16 API tests on a real PostgreSQL *_test database (recreated each run)
node scripts/smoke.cjs           # browser smoke test: 4 roles × every screen (needs servers + demo seed)
```

The API tests walk the full chain: BOQ approval and DB lock, 80/12/5/3 breakup, GSTIN validation, financial limits and segregation, over-allocation and chainage overlap, MB workflow with return/resubmit/certify/reversal, cement reconciliation (41,500 kg issued vs 38,000 kg theoretical = 3,500 kg), prospective rate amendments, audit trail, and the import wizard on a messy PDF-converted bill.

## Layout

```
apps/api       Fastify REST API, Prisma schema + migrations (incl. integrity triggers), services, tests
apps/web       React app (pages per module, components/ui.tsx design kit)
packages/shared Decimal-safe engines shared by API and browser: breakup, reconciliation, MB formulas, units, permissions, workflow
docs           ARCHITECTURE.md (decisions, safeguards), openapi.json
```

## Assumptions

- Measurements count against allocation, work order and BOQ scope from the moment they are drafted, so two people cannot draft the same chainage.
- "Measured" in reports means submitted or later; "approved" means PM-approved or later; reversal entries carry the original's status so totals net correctly and the negative flows into the next bill.
- Rate in force is taken on the measurement date and frozen at PM approval.
- Opening material balance = closing of the last approved reconciliation; otherwise the book balance before the period.
- Excess consumption is recovered at the weighted recovery rate on issue (issue rate for free-issue material) unless a penal rate is entered.
- Indian number formatting and ₹; money rounded half-up to paise.

## Not yet done (known gaps)

- **Billing & payments** (subcontractor RA bills, retention, security deposit, advance recovery, material recovery into bills, GST/TDS, payment recording, client RA bills), **reports & exports** (PDF/Excel), **subcontractor portal**: waiting for the rest of the specification. Billed/paid columns in the allocation matrix show "—" until then.
- PDF BOQ extraction: PDFs are stored; tables must be converted to Excel for import. Legacy .xls must be saved as .xlsx.
- No login rate limiting or password reset email yet; set `CORS_ORIGIN` in production.
- Stores can be created but not edited; GRNs cannot be reversed (use an adjustment workflow, to be added).
