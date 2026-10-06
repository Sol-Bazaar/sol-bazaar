'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Globe, 
  Check, 
  X, 
  Loader2,
  Shield,
  CreditCard,
  ChevronRight,
  Building2,
  Mail,
  Hash,
  AlertCircle
} from 'lucide-react';
import { shortAddress } from '@solbazaar/core/client';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'var(--ok)',
  SUSPENDED: 'var(--warn)',
  DRAFT: 'var(--muted)',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DRAFT: 'Draft',
};

const TOKEN_ICONS: Record<string, React.ReactNode> = {
  SOL: <CreditCard className="h-3.5 w-3.5" />,
  USDC: <Shield className="h-3.5 w-3.5" />,
  USDT: <Shield className="h-3.5 w-3.5" />,
};

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: '',
    name: '',
    status: 'DRAFT',
    baseDomain: 'localhost:3000',
    defaultCountry: 'US',
    markupBps: 500,
    minOrderUsd: 5,
    maxOrderUsd: 2000,
    orderTtlMinutes: 30,
    acceptedTokens: ['SOL'],
    supportEmail: '',
    legalName: '',
  });

  const fetchTenants = async () => {
    try {
      const res = await fetch('/api/admin/tenants', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load tenants');
      const { data } = await res.json();
      setTenants(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...form,
          markupBps: Number(form.markupBps),
          minOrderUsd: Number(form.minOrderUsd),
          maxOrderUsd: Number(form.maxOrderUsd),
          orderTtlMinutes: Number(form.orderTtlMinutes),
          acceptedTokens: form.acceptedTokens.filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error('Failed to create tenant');
      setShowCreate(false);
      setForm({
        slug: '', name: '', status: 'DRAFT', baseDomain: 'localhost:3000',
        defaultCountry: 'US', markupBps: 500, minOrderUsd: 5, maxOrderUsd: 2000,
        orderTtlMinutes: 30, acceptedTokens: ['SOL'], supportEmail: '', legalName: '',
      });
      fetchTenants();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tenant? This cannot be undone.')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/tenants/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete tenant');
      fetchTenants();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  const handleTokenChange = (token: string, checked: boolean) => {
    const current = form.acceptedTokens;
    if (checked) {
      if (!current.includes(token)) setForm({ ...form, acceptedTokens: [...current, token] });
    } else {
      setForm({ ...form, acceptedTokens: current.filter((t) => t !== token) });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-48" />
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="p-4" /><th className="p-4" /><th className="p-4" /><th className="p-4" /><th className="p-4" /><th className="p-4" /><th className="p-4" />
                </tr>
              </thead>
              <tbody>
                {[0,1,2,3].map((i) => (
                  <tr key={i} className="border-b border-[var(--line)]">
                    <td className="p-4"><div className="skeleton h-4 w-32" /></td>
                    <td className="p-4"><div className="skeleton h-6 w-20" /></td>
                    <td className="p-4"><div className="skeleton h-4 w-32" /></td>
                    <td className="p-4"><div className="skeleton h-4 w-16" /></td>
                    <td className="p-4"><div className="skeleton h-5 w-24" /></td>
                    <td className="p-4"><div className="skeleton h-4 w-12" /></td>
                    <td className="p-4"><div className="skeleton h-6 w-24" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-medium tracking-[-0.02em]">Tenants</h1>
          <p className="mt-1 text-[14px] text-[var(--muted)]">Manage white-label storefronts, branding, and commercial rules.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-primary sm:ml-auto"
        >
          <Plus className="h-4 w-4" aria-hidden /> New tenant
        </button>
      </div>

      {error && (
        <div className="flex gap-3 rounded-none border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] p-4 text-[13px]" style={{ color: 'var(--bad)' }}>
          <AlertCircle className="h-4.5 w-4.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Tenants table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" role="grid">
            <thead>
              <tr className="border-b border-[var(--line)] text-left bg-[color-mix(in_srgb,var(--elevated)_50%,transparent)]">
                <th className="p-4 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Tenant</th>
                <th className="p-4 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Status</th>
                <th className="p-4 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Domain</th>
                <th className="p-4 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Markup</th>
                <th className="p-4 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Tokens</th>
                <th className="p-4 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Orders</th>
                <th className="p-4 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-[var(--muted)]">
                    <Building2 className="h-10 w-10 mx-auto mb-3 text-[var(--faint)]" />
                    No tenants yet. Create one to get started.
                  </td>
                </tr>
              ) : (
                tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-[color-mix(in_srgb,var(--elevated)_40%,transparent)] transition-colors">
                    <td className="p-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13.5px] font-semibold">{t.slug}</span>
                          {t.domains.some((d: any) => d.isPrimary) && (
                            <span title="Custom domain configured">
                              <Globe className="h-3.5 w-3.5 text-[var(--ok)]" />
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[var(--muted)]">{t.name}</div>
                        {t.legalName && <div className="mt-0.5 text-[11px] text-[var(--faint)]">{t.legalName}</div>}
                      </div>
                    </td>
                    <td className="p-4">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-bold"
                        style={{ background: `color-mix(in srgb, ${STATUS_COLORS[t.status] || 'var(--muted)'} 18%, transparent)`, color: STATUS_COLORS[t.status] || 'var(--muted)' }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden />
                        {STATUS_LABELS[t.status] || t.status}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="font-mono text-[12.5px]">{t.baseDomain}</div>
                      {t.domains.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.domains.map((d: any) => (
                            <span key={d.hostname} className="badge text-[10px]" style={{ background: d.isPrimary ? 'color-mix(in_srgb,var(--ok)_18%,transparent)' : 'color-mix(in_srgb,var(--muted)_18%,transparent)' }}>
                              {d.hostname} {d.isPrimary && <Check className="h-3 w-3" aria-hidden />}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-4 font-mono text-[13px] tabular-nums">
                      {(t.markupBps / 100).toFixed(2)}%
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {t.acceptedTokens.map((tok: string) => (
                          <span key={tok} className="inline-flex items-center gap-1 badge text-[10.5px] font-mono" style={{ background: 'color-mix(in_srgb,var(--accent)_18%,transparent)', color: 'var(--accent)' }}>
                            {TOKEN_ICONS[tok] || <Hash className="h-3.5 w-3.5" />}
                            {tok}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 font-mono text-[13px] tabular-nums">{t._count.orders}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/admin/tenants/${t.id}`}
                          className="btn btn-ghost btn-sm"
                          aria-label={`Edit ${t.slug}`}
                        >
                          <Edit className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={deleting === t.id}
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--bad)', borderColor: 'color-mix(in_srgb,var(--bad)_40%,transparent)' }}
                          aria-label={`Delete ${t.slug}`}
                        >
                          {deleting === t.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create tenant modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowCreate(false)}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in" style={{ background: 'var(--surface)' }} onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
              <h2 className="text-[18px] font-bold">Create new tenant</h2>
              <button onClick={() => setShowCreate(false)} className="btn btn-ghost btn-sm" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Slug <span className="text-[var(--bad)]">*</span></span>
                  <input type="text" required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="my-store" className="input" pattern="[a-z0-9-]+" />
                  <p className="text-[11px] text-[var(--muted)]">Lowercase, alphanumeric, hyphens only. Used as subdomain.</p>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Name <span className="text-[var(--bad)]">*</span></span>
                  <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Store" className="input" />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Status</span>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
                    <option value="DRAFT">Draft</option>
                    <option value="ACTIVE">Active</option>
                    <option value="SUSPENDED">Suspended</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Base domain</span>
                  <input type="text" value={form.baseDomain} onChange={(e) => setForm({ ...form, baseDomain: e.target.value })} placeholder="localhost:3000" className="input" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Default country</span>
                  <input type="text" value={form.defaultCountry} onChange={(e) => setForm({ ...form, defaultCountry: e.target.value })} placeholder="US" className="input" maxLength={2} />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Markup (bps)</span>
                  <input type="number" value={form.markupBps} onChange={(e) => setForm({ ...form, markupBps: Number(e.target.value) })} className="input" min={0} max={10000} />
                  <p className="text-[11px] text-[var(--muted)]">500 = 5%</p>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Min order (USD)</span>
                  <input type="number" step="0.01" value={form.minOrderUsd} onChange={(e) => setForm({ ...form, minOrderUsd: Number(e.target.value) })} className="input" min={0} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Max order (USD)</span>
                  <input type="number" step="0.01" value={form.maxOrderUsd} onChange={(e) => setForm({ ...form, maxOrderUsd: Number(e.target.value) })} className="input" min={0} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">TTL (minutes)</span>
                  <input type="number" value={form.orderTtlMinutes} onChange={(e) => setForm({ ...form, orderTtlMinutes: Number(e.target.value) })} className="input" min={5} max={1440} />
                </label>
              </div>

              <fieldset className="border border-[var(--line)] rounded-none p-4">
                <legend className="text-[12.5px] font-semibold mb-3 flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4" style={{ color: 'var(--accent)' }} />
                  Accepted tokens
                </legend>
                <div className="flex flex-wrap gap-2">
                  {['SOL', 'USDC'].map((tok) => (
                    <label key={tok} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={form.acceptedTokens.includes(tok)} onChange={(e) => handleTokenChange(tok, e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                      <span className="font-mono text-[13px] flex items-center gap-1">
                        {TOKEN_ICONS[tok]}
                        {tok}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Support email</span>
                  <input type="email" value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} placeholder="support@mystore.com" className="input" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-semibold">Legal name</span>
                  <input type="text" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="My Store Inc." className="input" />
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--line)]">
                <button type="button" onClick={() => setShowCreate(false)} className="btn btn-ghost" disabled={creating}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Creating…
                    </>
                  ) : (
                    <>
                      Create tenant
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}