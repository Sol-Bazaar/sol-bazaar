import Link from 'next/link';
import { Globe, Twitter, Github, Mail, Shield, Zap, Globe as GlobeIcon } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--grid)] bg-[var(--surface)]" style={{ background: 'var(--surface)' }}>
      <div className="container py-10 lg:py-14">
        <div className="grid gap-8 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-2 font-bold text-[16px]" style={{ color: 'var(--accent)' }}>
              <span className="grid h-6 w-6 place-items-center border border-[var(--grid)] bg-[var(--surface)] text-[10px] font-medium">G</span>
              GiftCard Store
            </Link>
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-[var(--muted)]">
              Buy gift cards instantly with USDC on Solana. 6,600+ brands, 180+ countries, instant delivery.
            </p>
            <div className="mt-6 flex gap-4">
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors" aria-label="Twitter">
                <Twitter className="h-5 w-5" />
              </a>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors" aria-label="GitHub">
                <Github className="h-5 w-5" />
              </a>
              <a href="mailto:support@giftcardstore.com" className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors" aria-label="Email">
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--muted)]">Product</h3>
            <nav className="mt-4 space-y-2">
              <Link href="/products" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">All gift cards</Link>
              <Link href="/products?category=gaming" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Gaming</Link>
              <Link href="/products?category=entertainment" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Entertainment</Link>
              <Link href="/products?category=store" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Shopping</Link>
            </nav>
          </div>

          <div>
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--muted)]">Company</h3>
            <nav className="mt-4 space-y-2">
              <Link href="/about" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">About us</Link>
              <Link href="/contact" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Contact</Link>
              <Link href="/careers" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Careers</Link>
              <Link href="/press" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Press</Link>
            </nav>
          </div>

          <div>
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--muted)]">Legal</h3>
            <nav className="mt-4 space-y-2">
              <Link href="/privacy" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Privacy policy</Link>
              <Link href="/terms" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Terms of service</Link>
              <Link href="/refunds" className="text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">Refund policy</Link>
            </nav>
          </div>
        </div>

        <div className="border-t border-[var(--line)] pt-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[12px] text-[var(--faint)]">
              © {new Date().getFullYear()} GiftCard Store. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-[11px] text-[var(--faint)]">
              <span className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" style={{ color: 'var(--ok)' }} />
                Non-custodial
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
                USDC on Solana
              </span>
              <span className="flex items-center gap-1.5">
                <GlobeIcon className="h-3.5 w-3.5" style={{ color: 'var(--ok)' }} />
                180+ countries
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}