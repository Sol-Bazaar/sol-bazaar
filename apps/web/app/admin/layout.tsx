'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createLogger } from '@solbazaar/core';

const log = createLogger({ service: 'admin:layout' });

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/auth', { cache: 'no-store' });
        if (alive) {
          if (!res.ok && pathname !== '/admin/login') {
            router.push(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
          } else {
            setAuthed(res.ok);
          }
        }
      } catch {
        if (alive && pathname !== '/admin/login') {
          router.push(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
        } else {
          setAuthed(false);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="skeleton h-8 w-48" />
      </div>
    );
  }

  if (!authed) {
    return <div style={{ display: 'contents' }}>{children}</div>;
  }

  const nav = [
    { href: '/admin', label: 'Tenants' },
    { href: '/admin/fees', label: 'Platform Fees' },
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/providers', label: 'Providers' },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <header className="border-b border-[var(--line)] px-4 py-3 sticky top-0 z-40" style={{ background: 'var(--surface)' }}>
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-4">
          <Link href="/admin" className="flex items-center gap-2 font-bold text-[16px]" style={{ color: 'var(--accent)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 12h6M12 9v6" />
            </svg>
            Sol Bazaar Admin
          </Link>
          <nav className="flex items-center gap-1" role="navigation" aria-label="Admin navigation">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-none text-[13px] font-medium transition-colors ${
                  pathname === item.href
                    ? 'bg-[var(--accent)] text-[var(--bg)]'
                    : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--elevated)_60%,transparent)]'
                }`}
                aria-current={pathname === item.href ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}