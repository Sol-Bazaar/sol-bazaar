const ICONS = {
  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h13" />
      <path d="M3 6v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </>
  ),
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
};

export function Step({ n, title, body, icon }: { n: string; title: string; body: string; icon: keyof typeof ICONS }) {
  return (
    <li className="card relative p-6 text-center lg:pt-7">
      <span
        className="absolute left-1/2 top-0 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-none border border-white/15 text-white shadow-lg"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
        aria-hidden
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon]}
        </svg>
      </span>

      <div className="mt-6 text-[11px] font-medium tracking-[0.2em] text-[var(--muted)]">STEP {n}</div>
      <h3 className="mt-2 text-[16px] font-bold tracking-[-0.01em]">{title}</h3>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--muted)]">{body}</p>
    </li>
  );
}