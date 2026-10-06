'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Loader2 } from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/admin';
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if already authed
    (async () => {
      try {
        const res = await fetch('/api/admin/auth', { cache: 'no-store' });
        if (res.ok) router.push(redirect);
      } catch {
        // not authed, stay on login
      }
    })();
  }, [router, redirect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error('Invalid password');
      router.push(redirect);
      router.refresh();
    } catch {
      setError('Invalid operator token. Check OPERATOR_TOKEN in your environment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="card w-full max-w-md" style={{ background: 'var(--surface)' }}>
        <div className="p-8 space-y-6">
          <div className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full" style={{ background: 'var(--accent)', color: '#fff' }}>
              <Lock className="h-6 w-6" aria-hidden />
            </div>
            <h1 className="mt-5 text-[22px] font-medium tracking-[-0.02em]">Admin access</h1>
            <p className="mt-2 text-[14px] text-[var(--muted)]">Enter the operator token to continue.</p>
          </div>

          {error && (
            <div className="rounded-none border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] p-3 text-[13px]" style={{ color: 'var(--bad)' }} role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold">Operator token</span>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••••••"
                  className="input pr-10"
                  autoComplete="off"
                  disabled={loading}
                  aria-describedby="token-hint"
                />
              </div>
              <p id="token-hint" className="mt-1.5 text-[11px] text-[var(--muted)]">
                Set <code className="font-mono text-[10.5px]">OPERATOR_TOKEN</code> in your environment. Generate with <code className="font-mono text-[10.5px]">openssl rand -hex 32</code>.
              </p>
            </label>

            <button type="submit" className="btn btn-primary w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-[12px] text-[var(--muted)]">
            This protects platform-level operations: tenant management, fee sweeping, provider config.
          </p>
        </div>
      </div>
    </div>
  );
}