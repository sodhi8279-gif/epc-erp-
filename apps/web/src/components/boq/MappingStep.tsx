import { useMemo, useState } from 'react';
import { Button, Field, Input, Notice, Select, Sheet, Tag, cx } from '../ui';
import { colLetter, headerText, IMPORT_FIELDS, type ImportField, type Mapping } from './importRows';

export interface SheetPreview { name: string; rowCount: number; columnCount: number; rows: (string | null)[][]; suggestedHeaderRow: number | null; suggestedMapping: Mapping }

/** Step 2: choose the sheet and header row, and map source columns to BOQ fields. */
export function MappingStep({ sheets, initial, busy, error, onSubmit, onCancel }: {
  sheets: SheetPreview[];
  initial?: { sheetName: string | null; headerRow: number | null; mapping: Mapping | null };
  busy?: boolean; error?: unknown;
  onSubmit: (v: { sheetName: string; headerRow: number; mapping: Mapping }) => void;
  onCancel?: () => void;
}) {
  const startSheet = sheets.find((s) => s.name === initial?.sheetName) ?? sheets.find((s) => s.suggestedHeaderRow) ?? sheets[0];
  const [sheetName, setSheetName] = useState(startSheet?.name ?? '');
  const [headerRow, setHeaderRow] = useState<number>(initial?.sheetName === startSheet?.name && initial?.headerRow ? initial.headerRow : startSheet?.suggestedHeaderRow ?? 1);
  const [mapping, setMapping] = useState<Mapping>(initial?.sheetName === startSheet?.name && initial?.mapping ? initial.mapping : startSheet?.suggestedMapping ?? {});
  const sheet = sheets.find((s) => s.name === sheetName) ?? startSheet;

  const pickSheet = (name: string) => {
    const s = sheets.find((x) => x.name === name)!;
    setSheetName(name); setHeaderRow(s.suggestedHeaderRow ?? 1); setMapping(s.suggestedMapping ?? {});
  };
  const width = useMemo(() => Math.max(sheet?.columnCount ?? 0, ...(sheet?.rows ?? []).map((r) => r.length)), [sheet]);
  const colOptions = useMemo(() => Array.from({ length: width }, (_, i) => {
    const t = sheet ? headerText(sheet.rows, headerRow, i + 1) : '';
    return { value: i + 1, label: `${colLetter(i + 1)}${t ? ` · ${t.length > 40 ? t.slice(0, 40) + '…' : t}` : ''}` };
  }), [sheet, width, headerRow]);
  const fieldOfCol = useMemo(() => {
    const m = new Map<number, ImportField[]>();
    for (const [f, c] of Object.entries(mapping)) if (c) m.set(c, [...(m.get(c) ?? []), f as ImportField]);
    return m;
  }, [mapping]);
  const missing = IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]);
  const dupCols = [...fieldOfCol.values()].filter((v) => v.length > 1);

  if (!sheet) return <Notice tone="error" title="The workbook has no sheets" />;
  const fieldLabel = (f: ImportField) => IMPORT_FIELDS.find((x) => x.key === f)!.label;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Sheet title="Sheet and header row">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
          <Field label="Sheet" hint={`${sheet.rowCount} rows × ${sheet.columnCount} columns`}>
            <Select value={sheetName} onChange={(e) => pickSheet(e.target.value)}>
              {sheets.map((s) => <option key={s.name} value={s.name}>{s.name}{s.suggestedHeaderRow ? '' : ' (no BOQ header found)'}</option>)}
            </Select>
          </Field>
          <Field label="Header row" hint="Or click a row number below">
            <Input type="number" min={1} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>
        {!sheet.suggestedHeaderRow && <div className="mt-3"><Notice tone="warning" title="No BOQ header row was recognised on this sheet">Pick the header row and map the columns yourself.</Notice></div>}
      </Sheet>

      <Sheet title="Column mapping" actions={<span className="text-xs text-ink-soft">Prefilled from the header text; check every field.</span>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {IMPORT_FIELDS.map((f) => (
            <Field key={f.key} label={f.required ? `${f.label} (required)` : f.label}>
              <Select value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value ? Number(e.target.value) : undefined })}
                className={cx(f.required && !mapping[f.key] && 'border-red/60')}>
                <option value="">Not in file</option>
                {colOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-ink-soft">From a running (RA) bill: map Quantity to the agreement / BOQ quantity column if the bill shows one, otherwise to the up-to-date quantity. Map Amount to the matching amount column.</p>
        {!mapping.unit && <p className="mt-2 text-[13px] text-amber">Without a unit column every item will need its unit set in the review step.</p>}
        {dupCols.length > 0 && <p className="mt-2 text-[13px] text-amber">One column is mapped to more than one field: {dupCols.map((v) => v.map(fieldLabel).join(' and ')).join('; ')}.</p>}
      </Sheet>

      <Sheet title="Sheet preview" flush actions={<span className="text-xs text-ink-soft">First {sheet.rows.length} rows · header row shaded · rows below it are extracted</span>}>
        <div className="max-h-[480px] overflow-auto">
          <table className="border-collapse text-[12px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-paper text-ink-soft">
                <th className="sticky left-0 z-10 border-b border-r border-rule bg-paper px-2 py-1 text-right font-medium">Row</th>
                {Array.from({ length: width }, (_, i) => (
                  <th key={i} className={cx('border-b border-r border-rule px-2 py-1 text-left font-medium', fieldOfCol.has(i + 1) && 'bg-teal-wash text-teal-deep')}>
                    {colLetter(i + 1)}
                    {fieldOfCol.get(i + 1)?.map((f) => <span key={f} className="ml-1"><Tag tone="teal">{fieldLabel(f)}</Tag></span>)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r, ri) => {
                const rowNo = ri + 1;
                const isHeader = rowNo === headerRow;
                const above = rowNo < headerRow;
                return (
                  <tr key={ri} className={cx(isHeader && 'bg-amber-wash font-semibold', above && 'text-ink-soft/70')}>
                    <td className={cx('sticky left-0 border-b border-r border-rule-soft px-1 py-0.5 text-right', isHeader ? 'bg-amber-wash' : 'bg-sheet')}>
                      <button type="button" onClick={() => setHeaderRow(rowNo)} title="Use as header row" className="num w-full px-1 text-teal hover:underline">{rowNo}</button>
                    </td>
                    {Array.from({ length: width }, (_, ci) => {
                      const v = r[ci];
                      return <td key={ci} title={v ?? ''} className={cx('max-w-[200px] truncate border-b border-r border-rule-soft px-2 py-0.5', fieldOfCol.has(ci + 1) && !isHeader && 'bg-teal-wash/40')}>{v ?? ''}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Sheet>

      {error ? <Notice error={error} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {missing.length > 0 && <span className="text-[13px] text-red">Map {missing.map((f) => f.label.toLowerCase()).join(', ')} to continue.</span>}
        {onCancel && <Button onClick={onCancel}>Back to review</Button>}
        <Button variant="primary" busy={busy} disabled={missing.length > 0} onClick={() => onSubmit({ sheetName, headerRow, mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)) as Mapping })}>Extract rows</Button>
      </div>
    </div>
  );
}
