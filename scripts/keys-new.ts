/**
 * Generate the two encryption secrets the platform cannot run without.
 *
 *   npm run keys:new
 *
 * Prints fresh values for:
 *   - WALLET_MASTER_KEY   (encrypts the wallet seed + webhook secrets)
 *   - CODE_ENCRYPTION_KEY (encrypts redeemable gift-card codes at rest)
 *
 * They are intentionally separate so that compromising one does not
 * compromise the other. Back both up somewhere different from each other and
 * from the database.
 */
import { randomBytes } from 'node:crypto';

console.log(`
Sol Bazaar — generate secrets
${'─'.repeat(64)}

Add these to your .env:

  WALLET_MASTER_KEY="${randomBytes(32).toString('hex')}"
  CODE_ENCRYPTION_KEY="${randomBytes(32).toString('hex')}"

${'─'.repeat(64)}

  WALLET_MASTER_KEY   encrypts the wallet seed and webhook signing secrets.
                      Losing it means unreconciled deposits cannot be swept
                      or refunded.

  CODE_ENCRYPTION_KEY encrypts redeemable gift-card codes at rest.
                      Losing it means already-delivered codes can never be
                      shown to a customer again.

Run this ONCE. Re-running does not "rotate" anything — it orphans every
existing key and every value already encrypted with the old one. To rotate
properly you must re-encrypt existing data first; see docs/OPERATIONS.md.
`);