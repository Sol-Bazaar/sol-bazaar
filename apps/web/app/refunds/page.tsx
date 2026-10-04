import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Refunds',
  description: 'How refunds work for crypto-paid gift card orders.',
  robots: { index: false },
};

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refunds & reversals"
      updated="Effective 1 January 2025"
      intro="Crypto payments are one-way, so refunds are the exception rather than the rule. Here is exactly when we can and cannot return funds."
      sections={[
        {
          h: 'When we refund you',
          p: [
            'An order fails on our side before a code is issued — issuer outage, out-of-stock error, or a technical failure on our end. We return the full amount to the blockchain address it came from.',
            'You overpaid. Send us your order number and transaction signature; we return the surplus.',
            'Your order expired but a payment arrived afterwards. Send us the order number and signature and we will return it.',
          ],
        },
        {
          h: 'When we cannot refund you',
          p: [
            'Once a gift card code has been issued. The code is a bearer instrument in your possession and could already have been redeemed — the value has left our control permanently.',
            'If you sent from the wrong network or the wrong address, the payment may be undetectable. We will still investigate, but recovery depends on the sender and the chain.',
            'If the gift card was redeemed or partially redeemed and then you want it back. That is a question for the issuing brand, not for us.',
          ],
        },
        {
          h: 'Small shortfalls',
          p: [
            'If you underpaid by no more than 1.5%, we accept the payment and issue the card anyway. This is deliberate: rounding across a blockchain transfer should not cost you a gift card.',
            'For larger shortfalls the order stays pending so you can send a second transfer to the same address. The order page always shows the remaining amount required.',
          ],
        },
        {
          h: 'How to request a refund',
          p: [
            'Email support@solbazaar.com with your order number (format FC-XXXXXX) and the transaction signature. Both are shown on your order page.',
            'We respond within two business days. Refunds are sent on the Solana network and typically confirm within a minute; the network fee, if any, is deducted.',
          ],
        },
      ]}
    />
  );
}