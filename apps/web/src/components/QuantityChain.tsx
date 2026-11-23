import { D } from '@epc/shared';
import { num } from '../lib/format';

/**
 * The quantity chain strip: one BOQ activity's scope drawn like a chainage strip, with each stage
 * (allocated → executed → measured → approved → certified) as its own track so they are never conflated.
 */
const STAGES = [
  { key: 'allocated', label: 'Allocated', color: '#9fb8bf' },
  { key: 'executed', label: 'Executed', color: '#6c9aa3' },
  { key: 'measured', label: 'Measured', color: '#3d8580' },
  { key: 'approved', label: 'Approved', color: '#0f6e6a' },
  { key: 'certified', label: 'Certified', color: '#0a514e' },
] as const;

export function QuantityChain({ scope, values, unit, compact }: { scope: string; values: Partial<Record<(typeof STAGES)[number]['key'], string | null>>; unit: string; compact?: boolean }) {
  const s = D(scope);
  const pct = (v?: string | null) => (s.gt(0) && v ? Math.max(0, Math.min(100, D(v).div(s).times(100).toNumber())) : 0);
  const over = (v?: string | null) => !!v && s.gt(0) && D(v).gt(s);
  if (compact) {
    return (
      <div className="w-full min-w-[140px]" aria-label="Quantity chain">
        <div className="relative h-2.5 bg-rule-soft">
          {STAGES.map((st, i) => (
            <div key={st.key} title={`${st.label}: ${num(values[st.key])} ${unit}`} className="absolute left-0" style={{ top: i, height: 10 - i * 2, width: `${pct(values[st.key])}%`, background: st.color }} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5" aria-label="Quantity chain">
      {STAGES.map((st) => (
        <div key={st.key} className="grid grid-cols-[84px_1fr_120px] items-center gap-2 text-xs">
          <span className="text-ink-soft">{st.label}</span>
          <div className="relative h-3 border-x border-ink-soft/40 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_calc(10%-1px),var(--color-rule)_calc(10%-1px),var(--color-rule)_10%)]">
            <div className="absolute inset-y-0 left-0" style={{ width: `${pct(values[st.key])}%`, background: st.color }} />
          </div>
          <span className={over(values[st.key]) ? 'num font-semibold text-red' : 'num'}>{num(values[st.key])} {unit}</span>
        </div>
      ))}
      <div className="grid grid-cols-[84px_1fr_120px] gap-2 text-xs"><span /><span className="flex justify-between text-ink-soft"><span>0</span><span>Scope {num(scope)} {unit}</span></span><span /></div>
    </div>
  );
}
