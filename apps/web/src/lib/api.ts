/** Thin fetch wrapper: JWT from localStorage (also sent as httpOnly cookie by the server). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const TOKEN = 'epc_token';
export const auth = {
  get: () => { try { return localStorage.getItem(TOKEN); } catch { return null; } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch { /* ignore */ } },
};

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const t = auth.get();
  if (t) headers.authorization = `Bearer ${t}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'include' });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) {
    const d = data as { error?: string; message?: string; details?: unknown };
    if (res.status === 401 && !url.startsWith('/auth/login')) { auth.set(null); window.location.assign('/login'); }
    throw new ApiError(res.status, d.error ?? 'ERROR', d.message ?? res.statusText, d.details);
  }
  return data as T;
}
export const api = {
  get: <T = any>(u: string) => request<T>('GET', u),
  post: <T = any>(u: string, b: unknown = {}) => request<T>('POST', u, b),
  put: <T = any>(u: string, b: unknown) => request<T>('PUT', u, b),
  patch: <T = any>(u: string, b: unknown) => request<T>('PATCH', u, b),
  del: <T = any>(u: string) => request<T>('DELETE', u),
  upload: <T = any>(u: string, form: FormData) => request<T>('POST', u, form),
  download: async (u: string, filename: string) => {
    const blob = await request<Blob>('GET', u);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  },
};

/** Turns an API error into readable lines (message + validation details). */
export function errorLines(e: unknown): string[] {
  if (!(e instanceof ApiError)) return [String((e as Error)?.message ?? e)];
  const d = e.details;
  const extra = Array.isArray(d) ? d.map((x) => (typeof x === 'string' ? x : x?.message ? `${x.path ? x.path.join('.') + ': ' : ''}${x.message}` : JSON.stringify(x))) : [];
  return [e.message, ...extra];
}
