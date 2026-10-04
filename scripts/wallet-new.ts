/**
 * Generate the operator wallet.
 *
 *   npm run wallet:new
 *
 * Prints:
 *   - the BIP39 mnemonic (shown ONCE — write it down offline)
 *   - the AES-256-GCM encrypted envelope to paste into `WALLET_SEED`
 *   - slot 0, the sweeping address
 *
 * Both keys are required before the platform can accept a payment. Generate
 * them once, store the output offline, and never regenerate: a new seed means a
 * new set of deposit addresses and orphaned funds.
 */
import 'dotenv/config';
import { generateMnemonic, encryptSeed, SolanaHdWallet, bootstrapWallet } from '@solbazaar/crypto';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function main() {
  const master = process.env.WALLET_MASTER_KEY;
  if (!master) {
    console.error(
      `\n${RED}✖ WALLET_MASTER_KEY is not set.${RESET}\n\n` +
        `Generate one first:\n\n` +
        `  ${BOLD}node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"${RESET}\n\n` +
        `Then add it to your .env and re-run.\n`,
    );
    process.exit(1);
  }

  const strength = (process.argv.includes('--128') ? 128 : 256) as 128 | 256;
  const { mnemonic, envelope, operatorAddress } = bootstrapWallet(master, strength);
  const wallet = new SolanaHdWallet({ seed: mnemonic });

  console.log(`
${BOLD}Sol Bazaar operator wallet${RESET}
${DIM}${'─'.repeat(62)}${RESET}

${BOLD}⚠  RECOVERY MNEMONIC — WRITE THIS DOWN, ONCE${RESET}
${RED}${mnemonic}${RESET}

${DIM}This is the only time it is displayed. Store it offline: a password
manager, a printed sheet in a safe, or a hardware-wallet-style backup.
Anyone who has this can sweep every deposit address you issue.${RESET}

${BOLD}Hot address (HD slot 0)${RESET}
  ${operatorAddress}
  ${DIM}Customer deposits land in their own unique slots; these funds pool here
  and are swept to the issuer and to your fee wallet.${RESET}

${BOLD}Sample deposit slots (never reused)${RESET}
${[0, 1, 2, 3, 4]
  .map((i) => {
    const a = wallet.accountAt(i);
    return `  slot ${String(i).padStart(3)}  ${a.address}   ${a.path}`;
  })
  .join('\n')}

${BOLD}Add to your .env${RESET}

${GREEN}WALLET_SEED="${envelope}"${RESET}

${DIM}Verify it loaded correctly with:  npm run wallet:show${RESET}
`);
}

main();