import { Step } from './Step';

/**
 * "How it works" flow, split out so the illustration side stays a pure
 * component while the copy lives in the landing page.
 */
export function SolanaFlow() {
  const steps = [
    {
      n: '1',
      title: 'Pick your cards',
      body: 'Choose a brand and amount. We reserve the stock the moment you start checkout, so it cannot sell out from under you.',
      icon: 'cart' as const,
    },
    {
      n: '2',
      title: 'Send crypto to a private address',
      body: 'Every order gets its own Solana address. The amount and price are locked for 30 minutes — pay exactly that, in SOL or USDC.',
      icon: 'wallet' as const,
    },
    {
      n: '3',
      title: 'Get the code instantly',
      body: 'The moment the chain confirms, the code is issued and emailed to you. Every order page links the real transaction.',
      icon: 'bolt' as const,
    },
  ];

  return (
    <div className="relative mt-10">
      {/* Connector line — hidden on mobile where the steps stack. */}
      <div
        aria-hidden
        className="absolute left-0 right-0 top-7 hidden h-px lg:block"
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 45%, transparent) 15%, color-mix(in srgb, var(--accent-2) 45%, transparent) 85%, transparent)',
        }}
      />
      <ol className="relative grid gap-5 lg:grid-cols-3 lg:gap-7">
        {steps.map((s) => (
          <Step key={s.n} {...s} />
        ))}
      </ol>
    </div>
  );
}