import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What data this gift card storefront collects and why.',
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="Effective 1 January 2025"
      intro="We collect the minimum needed to deliver a gift card you bought. Here is exactly what that means."
      sections={[
        {
          h: 'What we collect',
          p: [
            'Order data: your email address, the country you are ordering from, the cards and amounts you bought, the order total, and the blockchain address you paid from and the transaction signature. We keep this because it is how we deliver your code and how we prove a payment was made.',
            'Technical data: a one-way hash of your IP address, your browser user-agent, and the request timestamp. The IP hash is stored instead of the IP address itself; we use it for fraud prevention and rate limiting.',
            'We do not collect or store card numbers. We accept no payment cards.',
          ],
        },
        {
          h: 'What we do not collect',
          p: [
            'No government ID, no selfie verification, no card details, no marketing consent, and no third-party advertising trackers.',
          ],
        },
        {
          h: 'Where data is stored',
          p: [
            'Order records are stored in our database. Redeemable gift card codes are encrypted at rest with a key that is not held in the database, so a database compromise does not expose redeemable value.',
            'Payment confirmations are public blockchain data. The transaction you make to pay us is visible on Solana permanently and cannot be removed by us or by you.',
          ],
        },
        {
          h: 'How we use it',
          p: [
            'To deliver your gift card codes, to provide support, to detect and prevent fraud and abuse, to meet legal and tax obligations, and to understand aggregate product demand. We do not sell your data.',
          ],
        },
        {
          h: 'How long we keep it',
          p: [
            'Order records are retained for as long as needed to deliver the product, provide support, and meet legal obligations — typically seven years for transaction records. You can request deletion of anything not subject to a retention requirement.',
          ],
        },
        {
          h: 'Your rights',
          p: [
            'You may request a copy of your data, ask us to correct it, or ask us to delete it, by emailing support@solbazaar.com with the email address on your order. Note that blockchain transaction data is public and permanent, and cannot be deleted on request.',
          ],
        },
        {
          h: 'Contact',
          p: ['Privacy questions and data requests: support@solbazaar.com'],
        },
      ]}
    />
  );
}