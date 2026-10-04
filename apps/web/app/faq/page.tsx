import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'Everything about buying gift cards with Solana: payments, delivery, regions, refunds and security.',
};

const SECTIONS = [
  {
    id: 'payments',
    q: 'How do the crypto payments work?',
    a: [
      'When you check out we reserve your stock, lock a crypto price, and generate a Solana address that belongs to your order and nothing else. Nothing is charged until you send crypto to it.',
      'You can pay with SOL or USDC on the Solana network. The amount is fixed for 30 minutes, so a price move while you are sending cannot cause a shortfall.',
      'We watch the Solana network for your transaction. Once it reaches the required number of confirmations and the amount received covers what is owed, the gift card is issued automatically.',
    ],
  },
  {
    id: 'how-long',
    q: 'How long does delivery take?',
    a: [
      'Solana produces a block roughly every 400 milliseconds, so your payment is normally detected within a few seconds of it being broadcast.',
      'Once confirmed, most codes arrive by email within 60 seconds. The order page also shows the codes directly if the email goes missing.',
    ],
  },
  {
    id: 'tokens',
    q: 'Which cryptocurrencies can I use?',
    a: [
      'SOL and USDC on Solana mainnet-beta. Some white-label stores enable a different set — the options shown at checkout are the ones that store accepts.',
      'Each token has its own deposit address. For USDC that is the associated token account for your order; the checkout page displays the correct address for whichever token you choose.',
      'Make sure your wallet is on the Solana network. Sending USDC on Ethereum, or SOL from an exchange withdrawal that has not landed, will not be detected and cannot be recovered.',
    ],
  },
  {
    id: 'wrong-amount',
    q: 'What if I send the wrong amount?',
    a: [
      'The order page always shows the exact amount still required, down to the last base unit. As long as there is time left on your order you can send a second, smaller transfer to the same address and it will be counted.',
      'Shortfalls of up to 1.5% are accepted automatically without further action.',
      'If you overpay, the surplus stays in the order and is refunded on request.',
    ],
  },
  {
    id: 'expiry',
    q: 'Why does my order expire?',
    a: [
      'Each order holds a reserved stock allocation and a private payment address. Both are released after the payment window closes — typically 30 minutes — so we are not holding inventory or addresses open indefinitely.',
      'Your codes stay available at the order page forever after delivery; expiry only applies to the payment step.',
    ],
  },
  {
    id: 'regions',
    q: 'Why do I only see some gift cards?',
    a: [
      'Gift card terms are set by the brand and vary by country. A US-only Amazon card cannot legally be redeemed on a German account, so we do not list it to you.',
      'We detect your country from the CDN header or your IP address and filter the catalogue to that market. Use the region switcher in the header if the detection was wrong.',
      'Availability is enforced server-side on every request, including when an order is placed — a card you cannot see cannot be ordered.',
    ],
  },
  {
    id: 'refunds',
    q: 'Can I get a refund?',
    a: [
      'Cryptocurrency transfers cannot be reversed by us or by anyone else, so we cannot refund a payment once a gift card code has been issued — the value is already yours.',
      'If an order fails on our side before a code is issued, we refund the full amount to the address it came from.',
      'If you overpaid, or sent funds to an order that expired, contact support with your order number and transaction signature.',
    ],
  },
  {
    id: 'security',
    q: 'How is my data and money protected?',
    a: [
      'Redeemable codes are encrypted at rest with AES-256-GCM using a key held outside the database. A stolen database dump contains no redeemable value.',
      'API secrets are stored only as scrypt hashes and compared in constant time.',
      'We never hold a pooled balance. Each order has a dedicated address, and gift cards are only issued after the chain confirms payment.',
      'We store no card numbers, because we accept no cards.',
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-[32px] font-medium tracking-[-0.03em] sm:text-[40px]">How it works</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          Buying gift cards with crypto, explained. If something is missing,{' '}
          <a href="mailto:support@solbazaar.com" className="font-semibold underline underline-offset-4" style={{ color: 'var(--accent)' }}>
            ask support
          </a>
          .
        </p>

        <nav aria-label="On this page" className="card mt-8 p-5">
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--muted)]">On this page</h2>
          <ul className="mt-2.5 grid gap-1 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                {/* `py-1.5 -mx-1.5` turns a 17px line of text into a ~34px tap
                    target. This is the primary way to move around the page on a
                    phone, so it needs a thumb-sized row. */}
                <a
                  href={`#${s.id}`}
                  className="-mx-1.5 block px-1.5 py-1.5 hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  {s.q}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 space-y-3">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="card scroll-mt-24 p-5">
              <h2 className="text-[16px] font-bold">{s.q}</h2>
              <div className="mt-2.5 space-y-2.5">
                {s.a.map((p, i) => (
                  <p key={i} className="text-[14px] leading-relaxed text-[var(--muted)]">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="card mt-10 p-6 text-center">
          <h2 className="text-[18px] font-medium">Ready to try it?</h2>
          <p className="mt-1.5 text-[14px] text-[var(--muted)]">Codes are delivered in about a minute.</p>
          <Link href="/products" className="btn btn-primary mt-5">
            Browse gift cards
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}