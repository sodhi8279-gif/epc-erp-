import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, PencilLine, Sheet as SheetIcon, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCompany } from '../lib/company';
import { useAction } from '../lib/hooks';
import { Button, Field, Input, Notice, PageHeader, Select, Sheet, cx } from '../components/ui';
import { BOQ_ACCEPT, BOQ_SOURCE_HELP } from './boq/ImportWizard';
import { PROJECT_TYPES, PROJECT_TYPE_LABEL } from './Projects';

const CONTRACT_TYPES: [string, string][] = [['ITEM_RATE', 'Item rate'], ['PERCENTAGE_RATE', 'Percentage rate'], ['LUMP_SUM', 'Lump sum'], ['EPC', 'EPC'], ['DESIGN_BUILD', 'Design-build']];

type Form = {
  companyId: string; code: string; name: string; type: string; client: string; location: string; state: string; startDate: string; endDate: string;
  contractNo: string; agreementDate: string; contractValue: string; contractType: string; loaRef: string;
};
type Key = keyof Form;
interface Suggestion { value: string; source: string }

/** Which agreement suggestion fills which form field. */
const FROM_AGREEMENT: [string, Key][] = [
  ['projectName', 'name'], ['client', 'client'], ['location', 'location'], ['state', 'state'], ['startDate', 'startDate'], ['completionDate', 'endDate'],
  ['agreementNo', 'contractNo'], ['agreementDate', 'agreementDate'], ['contractValue', 'contractValue'], ['contractType', 'contractType'], ['loaRef', 'loaRef'],
];

function Choice({ active, onClick, icon, title, children }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cx('flex items-start gap-3 rounded-[4px] border px-4 py-3 text-left transition-colors', active ? 'border-teal bg-teal-wash' : 'border-rule bg-sheet hover:border-ink-soft')}>
      <span className={cx('mt-0.5', active ? 'text-teal-deep' : 'text-ink-soft')}>{icon}</span>
      <span><span className="block text-[14px] font-medium">{title}</span><span className="block text-[13px] text-ink-soft">{children}</span></span>
    </button>
  );
}

const FileInput = ({ accept, onChange }: { accept: string; onChange: (f: File | null) => void }) => (
  <input type="file" accept={accept} onChange={(e) => onChange(e.target.files?.[0] ?? null)}
    className="block w-full text-[13px] file:mr-3 file:h-9 file:rounded-[3px] file:border file:border-rule file:bg-sheet file:px-3 file:text-ink hover:file:border-ink-soft" />
);

/**
 * New project in two parts: project and agreement details (read from the uploaded agreement, or typed in), then the BOQ
 * (read from an uploaded BOQ or RA bill, or added later). The BOQ goes through the usual column-mapping and row review
 * before anything is saved to it.
 */
export function NewProject() {
  const { can, me } = useAuth();
  const { companyId, companies } = useCompany();
  const nav = useNavigate();
  const [f, setF] = useState<Form>({ companyId: '', code: '', name: '', type: 'WATER_SUPPLY', client: '', location: '', state: '', startDate: '', endDate: '', contractNo: '', agreementDate: '', contractValue: '', contractType: 'ITEM_RATE', loaRef: '' });
  const set = (k: Key, v: string) => setF((x) => ({ ...x, [k]: v }));
  const company = f.companyId || companyId || '';

  // Part 1: agreement
  const [detailsMode, setDetailsMode] = useState<'upload' | 'manual'>('upload');
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const [agreement, setAgreement] = useState<{ document: { id: string; originalName: string }; suggestions: Record<string, Suggestion>; readError: string | null } | null>(null);
  const [filled, setFilled] = useState<Partial<Record<Key, Suggestion>>>({});
  const read = useAction((file: File) => { const fd = new FormData(); fd.append('companyId', company); fd.append('file', file); return api.upload('/agreements/extract', fd); }, {
    onSuccess: (r: any) => {
      setAgreement(r);
      const got: Partial<Record<Key, Suggestion>> = {};
      const next = { ...f };
      for (const [s, k] of FROM_AGREEMENT) if (r.suggestions[s]) { got[k] = r.suggestions[s]; next[k] = r.suggestions[s].value; }
      setF(next); setFilled(got);
    },
  });

  // Part 2: BOQ
  const [boqMode, setBoqMode] = useState<'upload' | 'later'>('upload');
  const [boqFile, setBoqFile] = useState<File | null>(null);

  const wantsBoq = boqMode === 'upload' && !!boqFile;
  const hasAgreement = !!f.contractNo.trim();
  const problems = [
    !company && 'Choose the company.',
    f.code.trim().length < 2 && 'Enter a project code (at least 2 characters).',
    f.name.trim().length < 3 && 'Enter the project name.',
    (hasAgreement || wantsBoq) && f.client.trim().length < 2 && 'Enter the client: it is needed for the agreement.',
    wantsBoq && !hasAgreement && 'Enter the agreement number: the BOQ is kept against the agreement.',
    f.contractValue && !(Number(f.contractValue.replace(/,/g, '')) >= 0) && 'Contract value must be a number.',
  ].filter(Boolean) as string[];

  const [stage, setStage] = useState<string | null>(null);
  const create = useAction(async () => { try { return await createAll(); } finally { setStage(null); } }, {
    onSuccess: (r: any) => {
      if (r.importId) nav(`/p/${r.p.id}/contracts/${r.p.contract.id}/import/${r.importId}`);
      else if (r.boqFailed) nav(`/p/${r.p.id}/contracts/${r.p.contract.id}/import`);
      else nav(`/p/${r.p.id}`);
    },
  });
  async function createAll() {
    setStage('Creating the project…');
    const p = await api.post('/projects', {
      companyId: company, code: f.code.trim(), name: f.name.trim(), type: f.type, client: f.client.trim() || undefined, location: f.location.trim() || undefined, state: f.state.trim() || undefined,
      startDate: f.startDate || undefined, endDate: f.endDate || undefined,
      contract: hasAgreement ? {
        contractNo: f.contractNo.trim(), type: f.contractType, contractValue: f.contractValue.replace(/,/g, '').trim() || '0',
        agreementDate: f.agreementDate || undefined, loaRef: f.loaRef.trim() || undefined,
      } : undefined,
      agreementDocumentId: detailsMode === 'upload' ? agreement?.document.id : undefined,
    });
    if (!wantsBoq || !p.contract) return { p };
    setStage('Reading the BOQ file…');
    const fd = new FormData(); fd.append('file', boqFile!);
    try {
      const up = await api.upload(`/contracts/${p.contract.id}/imports`, fd);
      return { p, importId: up.import.id as string };
    } catch {
      // The project exists; the BOQ can be uploaded again from the import page.
      return { p, boqFailed: true };
    }
  }

  const canCreate = can('org.manage', { companyId }) || me?.user.isSuperAdmin;
  const header = <PageHeader back={<Link to="/projects" className="hover:underline">Projects</Link>} title="New project" description="Fill in the project from its agreement, and build its BOQ from the client BOQ or a running bill. Everything read from a file is shown for you to check before it is saved." />;
  if (!canCreate) return <>{header}<Notice tone="warning" title="You do not have permission to create projects">Ask for the “Manage company, projects and stores” permission.</Notice></>;

  const hint = (k: Key) => filled[k] && filled[k]!.value === f[k] ? <span title={filled[k]!.source}>From the agreement: “{filled[k]!.source.length > 90 ? filled[k]!.source.slice(0, 90) + '…' : filled[k]!.source}”</span> : undefined;
  const field = (k: Key, label: string, props: Record<string, unknown> = {}, className?: string) => (
    <Field label={label} className={className} hint={hint(k)}>
      <Input value={f[k]} onChange={(e) => set(k, e.target.value)} className={cx(filled[k] && filled[k]!.value === f[k] && 'border-teal/60 bg-teal-wash/40')} {...props} />
    </Field>
  );
  const found = agreement ? Object.keys(agreement.suggestions).length : 0;

  return (
    <>
      {header}
      <div className="grid max-w-4xl gap-4">
        <Sheet title="1. Project and agreement details">
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice active={detailsMode === 'upload'} onClick={() => setDetailsMode('upload')} icon={<FileText className="size-5" />} title="Read from the agreement">Upload the signed agreement (PDF or Word) and the details are filled in for you to check.</Choice>
              <Choice active={detailsMode === 'manual'} onClick={() => setDetailsMode('manual')} icon={<PencilLine className="size-5" />} title="Fill in by hand">Type the project and agreement details yourself.</Choice>
            </div>
            {detailsMode === 'upload' && (
              <div className="grid gap-3 rounded-[4px] border border-rule-soft bg-paper px-4 py-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Agreement (.pdf, .docx or .txt)" className="min-w-[260px] flex-1"><FileInput accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(x) => { setAgreementFile(x); read.reset(); }} /></Field>
                  <Button variant="primary" disabled={!agreementFile || !company} busy={read.isPending} onClick={() => agreementFile && read.mutate(agreementFile)}><Upload className="size-4" /> Read agreement</Button>
                </div>
                {read.error ? <Notice error={read.error} /> : null}
                {agreement?.readError && <Notice tone="warning" title="Nothing could be read automatically">{agreement.readError}</Notice>}
                {agreement && !agreement.readError && (found > 0
                  ? <Notice tone="success" title={`${found} detail${found === 1 ? '' : 's'} found in ${agreement.document.originalName}`}>Fields filled from the agreement are shaded; the hint under each shows the text it came from. Check them, and fill in anything missing. The agreement is attached to the project.</Notice>
                  : <Notice tone="warning" title="No details were recognised">The agreement is still attached to the project. Fill in the details below.</Notice>)}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {companies.length > 1 && <Field label="Company" className="sm:col-span-2"><Select value={company} onChange={(e) => set('companyId', e.target.value)}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
              {field('name', 'Project / name of work', {}, 'sm:col-span-2')}
              {field('code', 'Project code', { placeholder: 'e.g. UNA-WSS' })}
              <Field label="Type"><Select value={f.type} onChange={(e) => set('type', e.target.value)}>{PROJECT_TYPES.map((t) => <option key={t} value={t}>{PROJECT_TYPE_LABEL[t]}</option>)}</Select></Field>
              {field('client', 'Client / employer', {}, 'sm:col-span-2')}
              {field('location', 'Location / district')}
              {field('state', 'State')}
              {field('startDate', 'Start date', { type: 'date' })}
              {field('endDate', 'Completion date', { type: 'date' })}
            </div>
            <div className="border-t border-rule-soft pt-3">
              <div className="mb-2 text-[13px] font-medium">Agreement</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('contractNo', 'Agreement / contract no.', { placeholder: 'Needed to add a BOQ' })}
                {field('agreementDate', 'Agreement date', { type: 'date' })}
                {field('contractValue', 'Contract value (₹)', { inputMode: 'decimal', placeholder: 'Can be set later' })}
                <Field label="Contract type" hint={hint('contractType')}><Select value={f.contractType} onChange={(e) => set('contractType', e.target.value)}>{CONTRACT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                {field('loaRef', 'Letter of acceptance / work order ref.', {}, 'sm:col-span-2')}
              </div>
              {agreement?.suggestions.contractor && <p className="mt-2 text-[13px] text-ink-soft">Contractor named in the agreement: {agreement.suggestions.contractor.value}</p>}
            </div>
          </div>
        </Sheet>

        <Sheet title="2. BOQ">
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice active={boqMode === 'upload'} onClick={() => setBoqMode('upload')} icon={<SheetIcon className="size-5" />} title="Upload BOQ or RA bill">Excel or PDF. The items, units, quantities and rates are read into a BOQ for you to review.</Choice>
              <Choice active={boqMode === 'later'} onClick={() => setBoqMode('later')} icon={<PencilLine className="size-5" />} title="Add later">Create the project now; import or enter the BOQ from the contract page.</Choice>
            </div>
            {boqMode === 'upload' && (
              <div className="grid gap-2 rounded-[4px] border border-rule-soft bg-paper px-4 py-3">
                <Field label="BOQ or RA bill (.xlsx, .csv or .pdf)"><FileInput accept={BOQ_ACCEPT} onChange={setBoqFile} /></Field>
                <p className="text-[13px] text-ink-soft">{BOQ_SOURCE_HELP}</p>
                <p className="text-[13px] text-ink-soft">Next you will confirm which columns hold the item number, description, unit, quantity and rate, then review every row. Nothing is added to the BOQ until you confirm it, and the BOQ is created as a draft for approval.</p>
              </div>
            )}
          </div>
        </Sheet>

        {create.error ? <Notice error={create.error} /> : null}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-rule bg-paper py-3">
          {problems.length > 0 && <span className="text-[13px] text-red">{problems[0]}</span>}
          {stage && <span className="text-[13px] text-ink-soft">{stage}</span>}
          <Button onClick={() => nav('/projects')}>Cancel</Button>
          <Button variant="primary" disabled={problems.length > 0} busy={create.isPending} onClick={() => create.mutate(undefined)}>{wantsBoq ? 'Create project and read BOQ' : 'Create project'}</Button>
        </div>
      </div>
    </>
  );
}
