import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, auth } from '../lib/api';
import { Button, Field, Input, Notice } from '../components/ui';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api.post<{ token: string }>('/auth/login', { email, password }); auth.set(r.token); await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api.get('/auth/me') }); nav('/'); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen md:grid-cols-[1fr_440px]">
      <div className="hidden flex-col justify-between bg-ink p-10 text-white md:flex">
        <div className="font-display text-xl font-bold">EPC Contracts &amp; Billing</div>
        <div className="max-w-[46ch]">
          <p className="font-display text-[30px] font-bold leading-[1.15]">One record from client BOQ to subcontractor measurement, material issue and recovery.</p>
          <div className="mt-8 h-3 border-x border-white/40 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_calc(10%-1px),rgba(255,255,255,.25)_calc(10%-1px),rgba(255,255,255,.25)_10%)]"><div className="h-full w-[62%] bg-[#3d8580]" /></div>
          <div className="mt-1 flex justify-between text-xs text-white/55"><span>Ch 0+000</span><span>Ch 1+000</span></div>
        </div>
        <div className="text-xs text-white/45">Headquarters and site access are controlled by role and project.</div>
      </div>
      <form onSubmit={submit} className="flex flex-col justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Sign in</h1>
        {err ? <Notice error={err} /> : null}
        <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Button variant="primary" type="submit" busy={busy}>Sign in</Button>
      </form>
    </div>
  );
}
