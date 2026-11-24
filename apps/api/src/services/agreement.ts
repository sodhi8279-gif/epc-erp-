// Reads a contract agreement (PDF, Word .docx or text) and suggests the project and contract details found in it.
// Everything returned is a suggestion with the line it came from; the user checks and corrects it before saving.
import JSZip from 'jszip';
import { pdfPlainText } from './pdfText';

export type AgreementField =
  | 'projectName' | 'client' | 'contractor' | 'agreementNo' | 'agreementDate' | 'contractValue' | 'loaRef'
  | 'startDate' | 'completionDate' | 'completionPeriod' | 'location' | 'state' | 'contractType';
export interface Suggestion { value: string; source: string }
export type AgreementFields = Partial<Record<AgreementField, Suggestion>>;

export async function documentText(buf: Buffer, filename: string): Promise<string> {
  if (/\.pdf$/i.test(filename)) return pdfPlainText(buf);
  if (/\.docx$/i.test(filename)) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) throw new Error('This Word file has no document body.');
    return decodeXml(xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>|<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''));
  }
  if (/\.txt$/i.test(filename)) return buf.toString('utf8');
  if (/\.doc$/i.test(filename)) throw new Error('Old Word (.doc) files cannot be read. Save the agreement as .docx or PDF and upload it again.');
  throw new Error('Upload the agreement as PDF, Word (.docx) or text.');
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE = String.raw`(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s*(?:day of\s*)?[A-Za-z]{3,9}\.?,?\s*\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}|\d{4}-\d{2}-\d{2})`;

/** Indian documents write dates day first: 05/12/2022 is 5 December 2022. Returns yyyy-mm-dd or null. */
export function parseIndianDate(raw: string): string | null {
  const s = raw.trim();
  let d: number, m: number, y: number;
  let x = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (x) [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else if ((x = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/))) [d, m, y] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else if ((x = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s*(?:day of\s*)?([A-Za-z]{3,9})\.?,?\s*(\d{4})$/))) [d, m, y] = [Number(x[1]), MONTHS.indexOf(x[2].slice(0, 3).toLowerCase()) + 1, Number(x[3])];
  else if ((x = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/))) [m, d, y] = [MONTHS.indexOf(x[1].slice(0, 3).toLowerCase()) + 1, Number(x[2]), Number(x[3])];
  else return null;
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "₹ 11,94,61,367/-", "Rs. 4.25 crore", "INR 85 lakh" → plain rupees. */
export function parseRupees(num: string, scale?: string): string | null {
  const n = Number(num.replace(/[,\s]/g, '').replace(/\/-?$/, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const k = (scale ?? '').toLowerCase();
  const mult = /^(crore|crores|cr)/.test(k) ? 1e7 : /^(lakh|lakhs|lac|lacs)/.test(k) ? 1e5 : 1;
  return (Math.round(n * mult * 100) / 100).toString();
}

const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Jammu and Kashmir', 'Jammu & Kashmir', 'Ladakh', 'Delhi', 'Chandigarh', 'Puducherry'];

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s:–—.-]+|[\s,;:–—-]+$/g, '').trim();
const cut = (s: string, n = 200) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') : s);

/** Find agreement details in the text. Each pattern list is tried in order; the first match wins. */
export function extractAgreementFields(text: string): AgreementFields {
  const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const flat = t.replace(/\n+/g, ' ');
  const out: AgreementFields = {};
  // The text around a match, so the user can see where a value came from.
  const lineOf = (idx: number, len = 0) => {
    let a = Math.max(0, idx - 20), b = Math.min(flat.length, idx + len + 90);
    while (a > 0 && a > idx - 40 && flat[a - 1] !== ' ') a--;
    while (b < flat.length && b < idx + len + 110 && flat[b] !== ' ') b++;
    return `${a > 0 ? '…' : ''}${flat.slice(a, b).trim()}${b < flat.length ? '…' : ''}`;
  };
  const first = (field: AgreementField, patterns: RegExp[], map: (m: RegExpMatchArray) => string | null) => {
    if (out[field]) return;
    for (const re of patterns) {
      for (const m of flat.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
        const v = map(m);
        if (v) { out[field] = { value: v, source: lineOf(m.index ?? 0, m[0].length) }; return; }
      }
    }
  };

  first('projectName', [
    /name of (?:the )?(?:work|project)\s*[:–—-]+\s*(.{10,400}?)(?=\s+(?:original\s*:|work id|letter of|agreement|contract no|ocb|ncb|icb|nit|tender|employer|client|contractor|estimated cost|\d+\.\s)|$)/i,
    /(?:for|in respect of) (?:the )?(?:work|project)(?: of| titled| named)?\s*[“"']([^”"']{10,300})[”"']/i,
    /(?:project|work)\s*[:–—-]+\s*([A-Z][^.]{15,250})/,
  ], (m) => cut(clean(m[1]), 250) || null);

  first('agreementNo', [
    /agreement\s*(?:no|number)\.?\s*[:–—-]*\s*([A-Z0-9][A-Z0-9/\-_.() ]{1,40}?[A-Z0-9)])(?=\s+(?:dated|dt\.?|of|between|is|made|signed)\b|\s*[,;]|\s*$|\s{2})/i,
    /contract\s*(?:agreement\s*)?(?:no|number)\.?\s*[:–—-]*\s*([A-Z0-9][A-Z0-9/\-_.() ]{1,40}?[A-Z0-9)])(?=\s+(?:dated|dt\.?|of|between|is|made|signed)\b|\s*[,;]|\s*$|\s{2})/i,
    /(?:ocb|ncb|icb|nit|tender)\s*(?:no|number)\.?\s*[:–—-]*\s*([A-Z0-9][A-Z0-9/\-_.()]{2,40})/i,
  ], (m) => (/\d/.test(m[1]) ? clean(m[1]) : null));

  first('agreementDate', [
    new RegExp(String.raw`agreement\s*(?:no\.?[^,;]{0,40}?)?\s*(?:date|dated|dt\.?)\s*[:–—-]*\s*${DATE}`, 'i'),
    new RegExp(String.raw`(?:this agreement|agreement) (?:is )?made (?:on )?(?:this )?${DATE}`, 'i'),
    new RegExp(String.raw`(?:this agreement|agreement)[^.]{0,60}?(?:on|dated)\s*(?:this\s*)?${DATE}`, 'i'),
  ], (m) => parseIndianDate(m[1]));

  first('loaRef', [
    /(?:letter of (?:acceptance|award|intent)|LOA|LOI|work order)\s*(?:no\.?|number|ref\.?)\s*[:–—-]*\s*([A-Z0-9][A-Z0-9/\-_.()]{2,40})/i,
  ], (m) => (/\d/.test(m[1]) ? clean(m[1]) : null));

  first('contractValue', [
    /(?:contract (?:price|value|amount|sum)|agreement (?:amount|value)|accepted (?:contract )?(?:amount|value|bid)|tender(?:ed)? (?:cost|amount|value)|total (?:contract )?(?:value|cost|price)|for a (?:total )?sum of|lump ?sum (?:price|amount) of|awarded (?:at|for) (?:a cost of )?)\D{0,40}?(?:rs\.?|inr|₹)?\s*([\d][\d,]*(?:\.\d+)?)\s*(?:\/-)?\s*(crores?|cr\.?|lakhs?|lacs?)?/i,
    /(?:rs\.?|inr|₹)\s*([\d][\d,]*(?:\.\d+)?)\s*(?:\/-)?\s*(crores?|cr\.?|lakhs?|lacs?)?\s*\(?(?:rupees|inr)/i,
  ], (m) => parseRupees(m[1], m[2]));

  first('startDate', [
    new RegExp(String.raw`(?:date of (?:commencement|start)(?: of work)?|commencement date|start date|date of written order to commence work|written order to commence work)\.?\s*[:–—-]*\s*${DATE}`, 'i'),
    new RegExp(String.raw`(?:commence|start)(?:d|s)? (?:the )?work[^.]{0,40}?(?:on|from|w\.?e\.?f\.?)\s*${DATE}`, 'i'),
  ], (m) => parseIndianDate(m[1]));

  first('completionDate', [
    new RegExp(String.raw`(?:(?:intended|stipulated|scheduled|due) )?(?:date of completion|completion date)(?: of work)?\.?\s*[:–—-]*\s*${DATE}`, 'i'),
    new RegExp(String.raw`(?:complete|completed) (?:the )?(?:whole )?work[^.]{0,40}?(?:by|on or before|before)\s*${DATE}`, 'i'),
  ], (m) => parseIndianDate(m[1]));

  first('completionPeriod', [
    /(?:time (?:allowed|for completion|of completion)|completion period|period of completion|contract period|construction period|time limit)\D{0,30}?(\d{1,3})\s*\(?[a-z ]*\)?\s*(months?|days?|years?)/i,
    /(?:within|in) (?:a period of )?(\d{1,3})\s*\(?[a-z ]*\)?\s*(months?|days?|years?) (?:from|of) (?:the )?(?:date|issue|commencement)/i,
  ], (m) => `${m[1]} ${m[2].toLowerCase().replace(/s?$/, Number(m[1]) === 1 ? '' : 's')}`);

  first('client', [
    /(?:employer|client|owner|department)\s*[:–—-]+\s*([A-Z][^.;\n]{4,150}?)(?=\s+(?:contractor|address|name of|agreement|and\b|\(|$))/i,
    /between\s+(?:the\s+)?(.{4,200}?)\s*,?\s*\(?\s*(?:hereinafter|herein after)[^)]{0,60}?(?:employer|owner|client|department|government|board|corporation|authority)/i,
    /division\s*:\s*([^\n]{4,120}?)(?=\s+sub division|\s+payment|$)/i,
  ], (m) => cut(clean(m[1]), 150) || null);

  first('contractor', [
    /(?:name of (?:the )?)?contractor\s*[:–—-]+\s*([^;\n]{4,150}?)(?=\s+(?:address|pan|gst|name of|agreement|bank|\(|$))/i,
    /\band\s+(m\/s\.?\s+.{3,150}?)\s*,?\s*\(?\s*(?:hereinafter|herein after)[^)]{0,60}?contractor/i,
  ], (m) => cut(clean(m[1]), 150) || null);

  first('location', [
    /(?:location|site|place of work)\s*[:–—-]+\s*([^.;\n]{3,120}?)(?=\s+(?:district|state|name of|agreement|$))/i,
    /\b(?:district|distt\.?)\s*[:–—-]*\s*([A-Z][A-Za-z]{2,30})/,
    /\bat district\s+([A-Z][A-Za-z]{2,30})/i,
  ], (m) => cut(clean(m[1]), 120) || null);

  if (!out.state) {
    const counts = STATES.map((s) => ({ s, n: (flat.match(new RegExp(`\\b${s.replace(/&/g, '\\&')}\\b`, 'gi')) ?? []).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
    if (counts[0]) { const idx = flat.search(new RegExp(`\\b${counts[0].s}\\b`, 'i')); out.state = { value: counts[0].s.replace('Jammu & Kashmir', 'Jammu and Kashmir'), source: lineOf(idx, counts[0].s.length) }; }
  }

  const TYPES: [RegExp, string][] = [
    [/\bitem[- ]rate (?:contract|tender|basis|agreement)/i, 'ITEM_RATE'], [/\bpercentage[- ]rate (?:contract|tender|basis|agreement)/i, 'PERCENTAGE_RATE'],
    [/\blump[- ]?sum (?:contract|tender|basis|agreement)/i, 'LUMP_SUM'], [/\b(?:EPC|engineering,? procurement and construction) (?:contract|tender|basis|agreement|mode)/i, 'EPC'],
    [/\bdesign[ ,-]*build (?:contract|tender|basis|agreement)/i, 'DESIGN_BUILD'],
    [/\bitem[- ]rate\b/i, 'ITEM_RATE'], [/\bpercentage[- ]rate\b/i, 'PERCENTAGE_RATE'], [/\blump[- ]?sum\b/i, 'LUMP_SUM'], [/\bdesign[ ,-]*build\b/i, 'DESIGN_BUILD'], [/\bEPC\b/, 'EPC'],
  ];
  for (const [re, v] of TYPES) { const h = flat.match(re); if (h) { out.contractType = { value: v, source: lineOf(h.index ?? 0, h[0].length) }; break; } }

  // Completion date from start date + period, when the agreement gives a period instead of a date.
  if (!out.completionDate && out.startDate && out.completionPeriod) {
    const [n, unit] = out.completionPeriod.value.split(' ');
    const d = new Date(out.startDate.value + 'T00:00:00Z');
    if (unit.startsWith('month')) d.setUTCMonth(d.getUTCMonth() + Number(n));
    else if (unit.startsWith('year')) d.setUTCFullYear(d.getUTCFullYear() + Number(n));
    else d.setUTCDate(d.getUTCDate() + Number(n));
    d.setUTCDate(d.getUTCDate() - 1);
    out.completionDate = { value: d.toISOString().slice(0, 10), source: `${out.completionPeriod.value} from the start date` };
  }
  return out;
}
