import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { errorLines } from '../lib/api';
import { humanize } from '../lib/format';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; busy?: boolean; size?: 'sm' | 'md' }>(
  ({ variant = 'secondary', busy, size = 'md', className, children, disabled, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-[3px] font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5',
        variant === 'primary' && 'bg-teal text-white hover:bg-teal-deep',
        variant === 'secondary' && 'border border-rule bg-sheet text-ink hover:border-ink-soft',
        variant === 'ghost' && 'text-ink-soft hover:text-ink hover:bg-rule-soft',
        variant === 'danger' && 'border border-red/40 bg-sheet text-red hover:bg-red-wash',
        className,
      )}
      {...p}
    >
      {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);

const fieldBase = 'w-full rounded-[3px] border border-rule bg-sheet px-2.5 text-ink placeholder:text-ink-soft/60 focus:border-teal focus:outline-none disabled:bg-rule-soft';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cx(fieldBase, 'h-9', p.type === 'number' || p.inputMode === 'decimal' ? 'text-right tabular-nums' : '', className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => <select ref={ref} className={cx(fieldBase, 'h-9 pr-7', className)} {...p}>{children}</select>);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cx(fieldBase, 'py-2 min-h-[72px]', className)} {...p} />);

/** Label + control + hint. Use `span` to set grid columns. */
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-ink-soft">{hint}</span>}
      {error && <span className="text-xs text-red">{error}</span>}
    </label>
  );
}

/** Page header: title, optional description line and actions on the right. */
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-4">
      <div className="min-w-0">
        {back && <div className="mb-1 text-[13px] text-ink-soft">{back}</div>}
        <h1 className="text-[22px] font-bold leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-[75ch] text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A plain white sheet with an optional title row. Sections are separated by rules, not shadows. */
export function Sheet({ title, actions, children, className, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx('rounded-[4px] border border-rule bg-sheet', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-rule-soft px-4 py-2.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

/** Dense data table. Columns: header, cell renderer, alignment. */
export interface Col<T> { key: string; header: ReactNode; cell: (row: T, i: number) => ReactNode; align?: 'left' | 'right' | 'center'; className?: string; width?: string }
export function Table<T>({ cols, rows, empty, rowKey, onRowClick, footer, rowClassName }: { cols: Col<T>[]; rows: T[] | undefined; empty?: ReactNode; rowKey: (r: T, i: number) => string; onRowClick?: (r: T) => void; footer?: ReactNode; rowClassName?: (r: T) => string | undefined }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule bg-paper text-left text-ink-soft">
            {cols.map((c) => <th key={c.key} style={{ width: c.width }} className={cx('px-3 py-2 font-medium', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows === undefined ? (
            <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-ink-soft"><Loader2 className="inline size-4 animate-spin" /> Loading</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-ink-soft">{empty ?? 'Nothing here yet.'}</td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={rowKey(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx('border-b border-rule-soft align-top', onRowClick && 'cursor-pointer hover:bg-teal-wash/50', rowClassName?.(r))}>
                {cols.map((c) => <td key={c.key} className={cx('px-3 py-2', c.align === 'right' && 'num', c.align === 'center' && 'text-center', c.className)}>{c.cell(r, i)}</td>)}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot className="border-t-2 border-rule bg-paper font-semibold">{footer}</tfoot>}
      </table>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  APPROVED: 'green', ACTIVE: 'green', CERTIFIED: 'green', ACKNOWLEDGED: 'green', CONFIRMED: 'green', COMPLETED: 'green',
  DRAFT: 'grey', ONBOARDING: 'grey', PLANNING: 'grey', UPLOADED: 'grey', MAPPED: 'grey', ISSUED: 'grey', CLOSED: 'grey', SUPERSEDED: 'grey', INACTIVE: 'grey', CANCELLED: 'grey',
  SUBMITTED: 'blue', SE_VERIFIED: 'blue', BILLING_SCRUTINIZED: 'blue', PM_APPROVED: 'teal', COMMERCIAL_REVIEWED: 'teal',
  RETURNED: 'amber', PENDING_EXCEPTION: 'amber', ON_HOLD: 'amber', SUSPENDED: 'amber',
  REJECTED: 'red', BLACKLISTED: 'red', REVERSED: 'red',
};
const TONES: Record<string, string> = {
  green: 'bg-green-wash text-green border-green/25', grey: 'bg-rule-soft text-ink-soft border-rule', blue: 'bg-[#e8eef7] text-[#2b4c7e] border-[#2b4c7e]/20',
  teal: 'bg-teal-wash text-teal-deep border-teal/25', amber: 'bg-amber-wash text-amber border-amber/30', red: 'bg-red-wash text-red border-red/25',
};
const STATUS_LABEL: Record<string, string> = { SE_VERIFIED: 'SE verified', BILLING_SCRUTINIZED: 'Billing scrutinised', PM_APPROVED: 'PM approved', COMMERCIAL_REVIEWED: 'Commercial reviewed', PENDING_EXCEPTION: 'Exception pending' };
export function Status({ value, label }: { value: string; label?: string }) {
  label = label ?? STATUS_LABEL[value];
  return <span className={cx('inline-flex items-center rounded-[3px] border px-1.5 py-px text-xs font-medium whitespace-nowrap', TONES[STATUS_TONE[value] ?? 'grey'])}>{label ?? humanize(value)}</span>;
}
export function Tag({ children, tone = 'grey' }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={cx('inline-flex items-center rounded-[3px] border px-1.5 py-px text-xs whitespace-nowrap', TONES[tone])}>{children}</span>;
}

/** Inline message block. Pass `error` (any thrown value) to render API errors with their details. */
export function Notice({ tone = 'info', title, children, error, onClose }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; error?: unknown; onClose?: () => void }) {
  if (error) { const [m, ...d] = errorLines(error); tone = 'error'; title = title ?? m; children = d.length ? <ul className="list-disc pl-4">{d.map((x, i) => <li key={i}>{x}</li>)}</ul> : children; }
  const Icon = { info: Info, warning: AlertTriangle, error: XCircle, success: CheckCircle2 }[tone];
  const cls = { info: 'border-[#2b4c7e]/25 bg-[#eef2f8]', warning: 'border-amber/35 bg-amber-wash', error: 'border-red/30 bg-red-wash', success: 'border-green/30 bg-green-wash' }[tone];
  const ic = { info: 'text-[#2b4c7e]', warning: 'text-amber', error: 'text-red', success: 'text-green' }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-2.5 rounded-[3px] border px-3 py-2.5 text-[13px]', cls)}>
      <Icon className={cx('mt-0.5 size-4 shrink-0', ic)} aria-hidden />
      <div className="min-w-0 flex-1">{title && <div className="font-medium">{title}</div>}{children && <div className="mt-0.5 text-ink-soft">{children}</div>}</div>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="text-ink-soft hover:text-ink"><X className="size-4" /></button>}
    </div>
  );
}

/** Modal dialog on the native <dialog> element (focus trap + Esc for free). */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className={cx('m-auto w-[calc(100%-32px)] rounded-[4px] border border-rule bg-sheet p-0 text-ink backdrop:bg-ink/40', wide ? 'max-w-4xl' : 'max-w-lg')}>
      {open && (
        <>
          <div className="flex items-center justify-between border-b border-rule-soft px-4 py-3">
            <h2 className="text-[16px] font-semibold">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink"><X className="size-4" /></button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-rule-soft px-4 py-3">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Label/value pairs for record headers. */
export function Facts({ items, cols = 4 }: { items: [ReactNode, ReactNode][]; cols?: number }) {
  return (
    <dl className="grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cols > 3 ? 170 : 220}px, 1fr))` }}>
      {items.map(([k, v], i) => <div key={i} className="min-w-0"><dt className="text-xs text-ink-soft">{k}</dt><dd className="mt-0.5 truncate font-medium">{v ?? '—'}</dd></div>)}
    </dl>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-rule">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)} className={cx('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap', value === t.value ? 'border-teal text-ink' : 'border-transparent text-ink-soft hover:text-ink')}>{t.label}</button>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="rounded-[4px] border border-dashed border-rule bg-sheet px-6 py-10 text-center"><div className="font-semibold">{title}</div>{children && <p className="mx-auto mt-1 max-w-[60ch] text-ink-soft">{children}</p>}{action && <div className="mt-4">{action}</div>}</div>;
}
