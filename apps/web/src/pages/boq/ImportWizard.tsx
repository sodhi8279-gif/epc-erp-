import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, FileSpreadsheet, Upload } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { inr } from '../../lib/format';
import { Button, Facts, Field, Input, Notice, PageHeader, Sheet, Status, cx } from '../../components/ui';
import { MappingStep, type SheetPreview } from '../../components/boq/MappingStep';
import { ReviewGrid } from '../../components/boq/ReviewGrid';
import { computeIssues, summarise, toPayload, type ImportRow, type Mapping } from '../../components/boq/importRows';

type Step = 'upload' | 'map' | 'review' | 'confirm';
const STEPS: { value: Step; label: string }[] = [
  { value: 'upload', label: 'Upload file' }, { value: 'map', label: 'Map columns' }, { value: 'review', label: 'Review rows' }, { value: 'confirm', label: 'Create draft' },
];

function Steps({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.value === current);
  return (
    <ol className="mb-4 flex flex-wrap gap-x-1 gap-y-2 border-b border-rule text-[13px]">
      {STEPS.map((s, i) => (
        <li key={s.value} aria-current={i === idx ? 'step' : undefined} className={cx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium', i === idx ? 'border-teal text-ink' : 'border-transparent', i < idx ? 'text-teal-deep' : i > idx ? 'text-ink-soft' : '')}>
          {i < idx && <Check className="size-3.5" aria-hidden />}{s.label}
        </li>
      ))}
    </ol>
  );
}

export function ImportWizard() {
  const { projectId } = useProject();
  const { contractId, importId } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const canEdit = can('boq.edit', { projectId });
  const base = `/p/${projectId}/contracts/${contractId}`;
  const { data: contract } = useApi<any>(`/contracts/${contractId}`);
  const { data: imp, error: loadErr } = useApi<any>(importId ? `/imports/${importId}` : null);
  const [remap, setRemap] = useState(false);
  const { data: withSheets } = useApi<any>(importId && remap ? `/imports/${importId}?sheets=1` : null);

  // Upload
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const upload = useAction((f: File) => { const fd = new FormData(); fd.append('file', f); return api.upload(`/contracts/${contractId}/imports`, fd); }, {
    onSuccess: (r: any) => { if (r.parseError || !r.sheets) setParseError(r.parseError ?? 'The file could not be read.'); else nav(`${base}/import/${r.import.id}`, { replace: true }); },
  });

  // Review state (local until saved)
  const [rows, setRowsRaw] = useState<ImportRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState<'review' | 'confirm'>('review');
  const setRows = useCallback((u: SetStateAction<ImportRow[]>) => { setRowsRaw(u); setDirty(true); }, []);
  useEffect(() => { if (imp?.status === 'MAPPED' && !dirty) setRowsRaw((imp.rows as ImportRow[]) ?? []); }, [imp, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const issues = useMemo(() => computeIssues(rows), [rows]);
  const summary = useMemo(() => summarise(rows, issues), [rows, issues]);

  const map = useAction((v: { sheetName: string; headerRow: number; mapping: Mapping }) => api.post(`/imports/${importId}/map`, v), {
    onSuccess: (r: any) => { setRowsRaw(r.rows); setDirty(false); setRemap(false); setStep('review'); },
  });
  const save = useAction((rs: ImportRow[]) => api.put(`/imports/${importId}/rows`, { rows: toPayload(rs) }), { onSuccess: (r: any) => { setRowsRaw(r.rows); setDirty(false); } });

  const [title, setTitle] = useState('');
  const [ack, setAck] = useState(false);
  const approved = contract?.revisions.find((r: any) => r.status === 'APPROVED');
  const open = contract?.revisions.find((r: any) => ['DRAFT', 'SUBMITTED'].includes(r.status));
  const confirm = useAction(() => api.post(`/imports/${importId}/confirm`, { title: title.trim() || defaultTitle, acknowledgeWarnings: ack }), {
    onSuccess: (r: any) => nav(`${base}/revisions/${r.revision.id}`),
  });
  const defaultTitle = approved ? `Revised BOQ imported from ${imp?.document?.originalName ?? 'Excel'}` : `Original BOQ imported from ${imp?.document?.originalName ?? 'Excel'}`;

  const current: Step = !importId ? 'upload' : imp?.status === 'UPLOADED' || remap ? 'map' : imp?.status === 'MAPPED' ? step : imp?.status === 'CONFIRMED' ? 'confirm' : 'upload';
  const header = (
    <PageHeader back={<><Link to={`/p/${projectId}/contracts`} className="hover:underline">Contracts</Link> / <Link to={base} className="hover:underline">{contract?.contractNo ?? 'Contract'}</Link></>}
      title="Import BOQ from Excel"
      description="Every extracted row is reviewed here before anything enters the BOQ. Confirming creates a draft revision that still has to be submitted and approved."
      actions={imp && <><span className="text-[13px] text-ink-soft"><FileSpreadsheet className="mr-1 inline size-4" />{imp.document?.originalName}</span><Status value={imp.status} /></>} />
  );

  if (!canEdit) return <>{header}<Notice tone="warning" title="You do not have permission to import BOQs on this project">Ask for the “Create / edit draft BOQ revisions and imports” permission.</Notice></>;
  if (loadErr) return <>{header}<Notice error={loadErr} /></>;

  // Step 1: upload
  if (!importId) {
    return (
      <>
        {header}
        <Steps current="upload" />
        {open && <div className="mb-4"><Notice tone="warning" title={`Revision R${open.revisionNo} is still ${open.status.toLowerCase()}`}>An import can be prepared now, but the draft can only be created after R{open.revisionNo} is approved, returned or discarded.</Notice></div>}
        <Sheet title="Source file" className="max-w-2xl">
          <div className="grid gap-3">
            <p className="text-[13px] text-ink-soft">Upload the client BOQ as .xlsx or .csv. The original file is stored as the source document of the revision. PDF BOQs must first be converted to Excel; expect missing units and broken numbers from conversions, which you can fix in the review step.</p>
            <Field label="BOQ file (.xlsx or .csv)">
              <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setParseError(null); upload.reset(); }}
                className="block w-full text-[13px] file:mr-3 file:h-9 file:rounded-[3px] file:border file:border-rule file:bg-sheet file:px-3 file:text-ink hover:file:border-ink-soft" />
            </Field>
            {upload.error ? <Notice error={upload.error} /> : null}
            {parseError && <Notice tone="error" title="The file was stored but could not be read">{parseError}</Notice>}
            <div><Button variant="primary" disabled={!file} busy={upload.isPending} onClick={() => file && upload.mutate(file)}><Upload className="size-4" /> Upload and read file</Button></div>
          </div>
        </Sheet>
      </>
    );
  }
  if (!imp) return header;

  if (imp.status === 'CONFIRMED') {
    return <>{header}<Steps current="confirm" /><Notice tone="success" title="This import has been confirmed">It created a draft BOQ revision. <Link className="text-teal underline" to={`${base}/revisions/${imp.revisionId}`}>Open the revision</Link> to submit it for approval.</Notice></>;
  }
  if (imp.status === 'CANCELLED') {
    return <>{header}<Notice tone="error" title="This file could not be read">The file is kept as a document but no rows were extracted. <Link className="text-teal underline" to={`${base}/import`}>Upload another file</Link>.</Notice></>;
  }

  // Step 2: map
  if (current === 'map') {
    const sheets: SheetPreview[] | undefined = remap ? withSheets?.sheets : imp.sheets;
    return (
      <>
        {header}
        <Steps current="map" />
        {remap && <div className="mb-4"><Notice tone="warning" title="Extracting again replaces the reviewed rows">Corrections made in the review step are discarded when you extract rows again.</Notice></div>}
        {!sheets ? <p className="text-ink-soft">Reading workbook…</p> : (
          <MappingStep key={remap ? 'remap' : 'map'} sheets={sheets} initial={remap ? { sheetName: imp.sheetName, headerRow: imp.headerRow, mapping: imp.mapping } : undefined}
            busy={map.isPending} error={map.error} onSubmit={(v) => map.mutate(v)} onCancel={remap ? () => { setRemap(false); map.reset(); } : undefined} />
        )}
      </>
    );
  }

  const summaryBar = (
    <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[4px] border border-rule bg-sheet px-4 py-2.5 text-[13px]">
      <span><span className="text-ink-soft">Items</span> <span className="num font-semibold">{summary.items}</span></span>
      <span><span className="text-ink-soft">Headings</span> <span className="num font-semibold">{summary.headers}</span></span>
      <span><span className="text-ink-soft">Skipped</span> <span className="num font-semibold">{summary.skipped}</span></span>
      <span className={summary.errors ? 'text-red' : ''}><span className={summary.errors ? '' : 'text-ink-soft'}>Errors</span> <span className="num font-semibold">{summary.errors}</span></span>
      <span className={summary.warnings ? 'text-amber' : ''}><span className={summary.warnings ? '' : 'text-ink-soft'}>Warnings</span> <span className="num font-semibold">{summary.warnings}</span></span>
      <span><span className="text-ink-soft">Total</span> <span className="num font-semibold">{inr(summary.total)}</span></span>
      <span className="ml-auto text-xs text-ink-soft">Sheet “{imp.sheetName}”, header row {imp.headerRow}{dirty ? ' · unsaved corrections' : ' · all corrections saved'}</span>
    </div>
  );

  // Step 4: confirm
  if (current === 'confirm') {
    const warnErr = confirm.error instanceof ApiError && confirm.error.status === 409 && /warning/i.test(confirm.error.message);
    return (
      <>
        {header}
        <Steps current="confirm" />
        {summaryBar}
        <Sheet title="Create draft BOQ revision" className="max-w-3xl">
          <div className="grid gap-4">
            <Notice tone="info" title="This creates a draft, not an approved BOQ">
              {approved
                ? <>A revised BOQ draft (R{(contract?.revisions ?? []).reduce((m: number, r: any) => Math.max(m, r.revisionNo), -1) + 1}) is created from R{approved.revisionNo}. Imported rows are matched to existing items by item number; changed quantities or rates are marked as deviated, and items missing from the file are removed from the draft. R{approved.revisionNo} stays in force until the draft is submitted and approved.</>
                : <>The original BOQ draft (R0) is created with these rows. It must be submitted and approved before it can be used for work orders or measurements.</>}
            </Notice>
            {open && <Notice tone="error" title={`Revision R${open.revisionNo} is still ${open.status.toLowerCase()}`}>Approve, return or discard it before creating another draft. <Link className="text-teal underline" to={`${base}/revisions/${open.id}`}>Open R{open.revisionNo}</Link></Notice>}
            <Facts cols={3} items={[['Items', summary.items], ['Headings', summary.headers], ['Skipped rows', summary.skipped], ['Warnings', summary.warnings], ['BOQ total', inr(summary.total)], ['Source file', imp.document?.originalName]]} />
            <Field label="Revision title"><Input value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} /></Field>
            {summary.warnings > 0 && (
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I have reviewed the {summary.warnings} warning{summary.warnings === 1 ? '' : 's'} (mostly amounts that differ from quantity × rate; the computed amount is used).</span>
              </label>
            )}
            {confirm.error && !warnErr ? <Notice error={confirm.error} /> : null}
            {warnErr && <Notice tone="warning" title={(confirm.error as ApiError).message}>Tick the box above to acknowledge them.</Notice>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => { setStep('review'); confirm.reset(); }}>Back to review</Button>
              <Button variant="primary" busy={confirm.isPending} disabled={summary.errors > 0 || (summary.warnings > 0 && !ack) || !!open || dirty} onClick={() => confirm.mutate(undefined)}>Create draft revision</Button>
            </div>
          </div>
        </Sheet>
      </>
    );
  }

  // Step 3: review
  const goConfirm = () => { if (dirty) save.mutate(rows, { onSuccess: () => setStep('confirm') }); else setStep('confirm'); };
  return (
    <>
      {header}
      <Steps current="review" />
      {summaryBar}
      <div className="mb-3 grid gap-2">
        {save.error ? <Notice error={save.error} /> : null}
        {summary.errors > 0 && <Notice tone="error" title={`${summary.errors} error${summary.errors === 1 ? '' : 's'} to fix before the draft can be created`}>Correct the cells marked red, or set rows that are not BOQ items (page footers, totals, notes) to Skip.</Notice>}
      </div>
      <ReviewGrid rows={rows} setRows={setRows} issues={issues} />
      <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-paper py-3">
        <Button variant="ghost" onClick={() => { if (!dirty || window.confirm('Discard unsaved corrections and change the column mapping?')) setRemap(true); }}>Change mapping</Button>
        <Button disabled={!dirty} busy={save.isPending} onClick={() => save.mutate(rows)}>Save corrections</Button>
        <Button variant="primary" disabled={summary.errors > 0} busy={save.isPending} onClick={goConfirm}>{dirty ? 'Save and continue to create draft' : 'Continue to create draft'}</Button>
      </div>
    </>
  );
}
