import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Field, Input, Select, Textarea } from '../ui';

export interface ScForm {
  code: string; name: string; firmName: string; constitution: string; address: string; state: string; gstin: string; pan: string;
  contactPerson: string; phone: string; email: string; bankName: string; bankAccount: string; ifsc: string; workCategories: string[];
  gstRegistered: boolean; gstRate: string; tdsSection: string; tdsRate: string; retentionPercent: string; paymentTermsDays: string;
}
export const blankSc: ScForm = {
  code: '', name: '', firmName: '', constitution: '', address: '', state: '', gstin: '', pan: '', contactPerson: '', phone: '', email: '',
  bankName: '', bankAccount: '', ifsc: '', workCategories: [], gstRegistered: true, gstRate: '18', tdsSection: '194C', tdsRate: '1', retentionPercent: '5', paymentTermsDays: '30',
};
export const scFromRecord = (s: any): ScForm => ({
  ...blankSc,
  ...Object.fromEntries(Object.keys(blankSc).map((k) => [k, s[k] ?? (blankSc as any)[k]])),
  gstRate: String(s.gstRate ?? ''), tdsRate: String(s.tdsRate ?? ''), retentionPercent: String(s.retentionPercent ?? ''), paymentTermsDays: String(s.paymentTermsDays ?? ''),
  workCategories: s.workCategories ?? [],
});
/** Request body: empty strings become null; numbers stay exact strings. */
export const scToBody = (f: ScForm) => ({
  ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v])),
  gstRate: f.gstRate || '0', tdsRate: f.tdsRate || '0', retentionPercent: f.retentionPercent || '0',
  paymentTermsDays: f.paymentTermsDays === '' ? undefined : Number(f.paymentTermsDays),
});

export const SENSITIVE = ['bankName', 'bankAccount', 'ifsc', 'pan', 'gstin'] as const;
const CONSTITUTIONS = ['Proprietorship', 'Partnership', 'LLP', 'Private limited', 'Public limited', 'Trust / society', 'Individual'];
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

function Tags({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [t, setT] = useState('');
  const add = () => { const v = t.trim().toUpperCase(); if (v && !value.includes(v)) onChange([...value, v]); setT(''); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    if (e.key === 'Backspace' && !t && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-[3px] border border-rule bg-sheet px-1.5 py-1 focus-within:border-teal">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-[3px] border border-rule bg-rule-soft px-1.5 text-xs">
          {v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="text-ink-soft hover:text-ink"><X className="size-3" /></button>
        </span>
      ))}
      <input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={key} onBlur={add} placeholder={value.length ? '' : 'e.g. PIPELINE, RCC, EARTHWORK — press Enter'} className="min-w-[120px] flex-1 bg-transparent px-1 text-[13px] outline-none" />
    </div>
  );
}

/** All subcontractor master fields, with per-field server errors. */
export function SubcontractorFields({ f, set, errors, editing }: { f: ScForm; set: (f: ScForm) => void; errors: Record<string, string>; editing?: boolean }) {
  const inp = (k: keyof ScForm, extra: Record<string, unknown> = {}) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => set({ ...f, [k]: e.target.value }), ...extra });
  const Sec = ({ children }: { children: string }) => <h3 className="col-span-full mt-2 border-b border-rule-soft pb-1 text-[13px] font-semibold">{children}</h3>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Sec>Identity</Sec>
      <Field label="Code" error={errors.code} hint={editing ? 'Code cannot be changed' : 'Short unique code, e.g. SC-RAJ-01'}><Input {...inp('code')} disabled={editing} /></Field>
      <Field label="Name" error={errors.name} className="lg:col-span-2"><Input {...inp('name')} /></Field>
      <Field label="Firm / trade name" error={errors.firmName}><Input {...inp('firmName')} /></Field>
      <Field label="Constitution" error={errors.constitution}><Select {...inp('constitution')}><option value="">Not specified</option>{CONSTITUTIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="State" error={errors.state}><Select {...inp('state')}><option value="">Not specified</option>{STATES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Address" error={errors.address} className="col-span-full"><Textarea {...inp('address')} className="min-h-[56px]" /></Field>
      <Field label="Contact person" error={errors.contactPerson}><Input {...inp('contactPerson')} /></Field>
      <Field label="Phone" error={errors.phone}><Input {...inp('phone', { inputMode: 'tel' })} /></Field>
      <Field label="Email" error={errors.email}><Input {...inp('email', { type: 'email' })} /></Field>
      <Field label="Work categories" className="col-span-full" error={errors.workCategories}><Tags value={f.workCategories} onChange={(v) => set({ ...f, workCategories: v })} /></Field>

      <Sec>Tax</Sec>
      <Field label="PAN" error={errors.pan} hint="10 characters, e.g. ABCDE1234F"><Input {...inp('pan', { maxLength: 10, className: 'uppercase' })} /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><input type="checkbox" checked={f.gstRegistered} onChange={(e) => set({ ...f, gstRegistered: e.target.checked })} /> GST registered</label>
      <Field label="GSTIN" error={errors.gstin} hint={f.gstRegistered ? '15 characters; must contain the PAN' : 'Optional when not registered'}><Input {...inp('gstin', { maxLength: 15, className: 'uppercase' })} /></Field>
      <Field label="GST rate (%)" error={errors.gstRate}><Input {...inp('gstRate', { inputMode: 'decimal' })} /></Field>
      <Field label="TDS section" error={errors.tdsSection}><Select {...inp('tdsSection')}><option value="">None</option>{['194C', '194J', '194I', '194Q'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="TDS rate (%)" error={errors.tdsRate}><Input {...inp('tdsRate', { inputMode: 'decimal' })} /></Field>

      <Sec>Bank</Sec>
      <Field label="Bank name" error={errors.bankName}><Input {...inp('bankName')} /></Field>
      <Field label="Account number" error={errors.bankAccount} hint="9–18 digits"><Input {...inp('bankAccount', { inputMode: 'numeric' })} /></Field>
      <Field label="IFSC" error={errors.ifsc} hint="e.g. SBIN0001234"><Input {...inp('ifsc', { maxLength: 11, className: 'uppercase' })} /></Field>

      <Sec>Commercial terms</Sec>
      <Field label="Retention (%)" error={errors.retentionPercent} hint="Default for new work orders"><Input {...inp('retentionPercent', { inputMode: 'decimal' })} /></Field>
      <Field label="Payment terms (days)" error={errors.paymentTermsDays}><Input {...inp('paymentTermsDays', { inputMode: 'numeric' })} /></Field>
    </div>
  );
}
