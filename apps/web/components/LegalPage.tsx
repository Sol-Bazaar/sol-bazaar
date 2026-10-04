import type { ReactNode } from 'react';

/** Shared shell for the legal / informational pages. */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: { h: string; p: string[] }[];
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-[32px] font-medium tracking-[-0.03em] sm:text-[40px]">{title}</h1>
      <p className="mt-2 text-[12.5px] text-[var(--muted)]">{updated}</p>
      <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">{intro}</p>

      <div className="mt-8 space-y-6">
        {sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-[16px] font-bold">{s.h}</h2>
            <div className="mt-2 space-y-2.5">
              {s.p.map((para, i) => (
                <p key={i} className="text-[14px] leading-relaxed text-[var(--muted)]">
                  {para}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="prose-invert text-[14px] leading-relaxed text-[var(--muted)]">{children}</div>;
}