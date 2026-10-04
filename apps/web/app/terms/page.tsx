import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'Terms governing the use of this gift card storefront.',
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated="Effective 1 January 2025"
      intro="These terms govern your use of this gift card storefront. By placing an order you agree to them."
      sections={[
        {
          h: '1. What we sell',
          p: [
            'We sell digital gift cards for third-party brands. Each card is issued by, and redeemable with, the brand named on the card — not with us. We act as a reseller and payment facilitator.',
            'A card is valid only in the regions the brand supports. We display the regions we can serve, but final redemption eligibility is determined by the brand.',
          ],
        },
        {
          h: '2. Orders and payment',
          p: [
            'All payments are made in cryptocurrency on the Solana network. We show a fixed crypto amount for each order, valid for the payment window shown at checkout.',
            'We only issue a gift card after the payment is confirmed on the Solana network. If a payment is not received before the window closes, the order expires and the reserved stock is released.',
            'Sending an incorrect amount, or sending on the wrong network, may result in the payment not being detected. Contact support with your transaction signature in that situation.',
          ],
        },
        {
          h: '3. Irreversibility',
          p: [
            'Cryptocurrency transfers cannot be reversed. Once a gift card code has been issued to you, the transfer is complete and we cannot refund it, because the value is already in your possession.',
            'Where we are at fault — for example an issuer failure on our side — we will return the payment to the address it originated from.',
          ],
        },
        {
          h: '4. Gift card terms',
          p: [
            'Expiry, partial redemption, refunds and region restrictions for a specific gift card are set by the issuing brand and may differ from these terms. We reproduce the brand terms where we are required to, but the brand terms govern redemption.',
            'Gift card codes are bearer instruments. Anyone who obtains a code can redeem it. Store your codes securely.',
          ],
        },
        {
          h: '5. Prohibited use',
          p: [
            'You may not use this service to launder funds, to violate the terms of an issuing brand, to attempt to buy gift cards in bulk for resale in a manner prohibited by that brand, or to break applicable law.',
            'We may suspend an order or account where we reasonably suspect fraud, chargeback abuse or brand terms violation.',
          ],
        },
        {
          h: '6. Availability and changes',
          p: [
            'We may change prices, the product catalogue, accepted tokens or payment windows at any time. An order already created keeps the quote that was locked at checkout.',
            'Gift card stock is provided by issuers and can change without notice.',
          ],
        },
        {
          h: '7. Liability',
          p: [
            'To the maximum extent permitted by law, our liability for any order is limited to the amount you paid for that order. We are not liable for indirect or consequential loss, or for the loss of value of a gift card code that was exposed by your own action.',
          ],
        },
        {
          h: '8. Changes to these terms',
          p: [
            'We may update these terms. Material changes will be posted on this page with an updated effective date. Continued use of the service after that date constitutes acceptance.',
          ],
        },
        {
          h: '9. Contact',
          p: ['Questions about these terms: support@solbazaar.com. Include your order number so we can help faster.'],
        },
      ]}
    />
  );
}