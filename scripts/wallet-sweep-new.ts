/**
 * Generate the fee-sweep wallet on its own seed.
 *
 *   npm run wallet:sweep-new
 *
 * Prints:
 *   - the BIP39 mnemonic (shown ONCE — write it down offline)
 *   - the encrypted envelope for `WALLET_SWEEP_SEED`
 *   - the sweep addresses that will sign fee transfers
 *
 * ── Why a second seed ───────────────────────────────────────────────────────
 * Fee sweeping is the only part of the platform that signs transactions from the
 * operator seed. Deposit derivation produces addresses and never signs. Keeping
 * them on separate seeds means a compromise of the sweeper — the component with
 * the timers, the config-held collector address, and the full dependency tree —
 * cannot derive any customer deposit address. The attacker can move your
 * platform revenue; inbound customer payments stay untouched and reconcilable.
 *
 * Two backups, not one. If you lose this seed, sweeping stops and fees accrue
 * unswept (recoverable — `FeeAccrual` rows persist with `sweepId = null`). If
 * you lose the operator seed, every deposit address is gone. Prioritise
 * accordingly.
 *
 * ── Only needed once ────────────────────────────────────────────────────────
 * Without `WALLET_SWEEP_SEED`, sweeping falls back to the operator seed and logs
 * `sweep_seed_not_split`. Existing deployments are unaffected by running this.
 * Generate it before the first real fee sweep, and fund the sweep address with a
 * little SOL for transaction fees — nothing else is ever needed there.
 */
import 'dotenv/config';
import { generateMnemonic, encryptSeed, SolanaHdWallet, bootstrapWallet } from '@solbazaar/crypto';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function main(): void {
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

  if (process.env.WALLET_SWEEP_SEED?.trim()) {
    console.error(
      `\n${RED}✖ WALLET_SWEEP_SEED is already set.${RESET}\n\n` +
        `Generating a new one orphans any fees already swept to the old address.\n` +
        `If you mean to replace it, clear the variable and re-run.\n`,
    );
    process.exit(1);
  }

  const { mnemonic, envelope } = bootstrapWallet(master, 256);
  const wallet = new SolanaHdWallet({ seed: mnemonic });

  const solSlot = Number(process.env.WALLET_SWEEP_INDEX_SOL ?? 999_000);
  const splSlot = Number(process.env.WALLET_SWEEP_INDEX_SPL ?? 999_001);

  console.log(`
${BOLD}Sol Bazaar fee-sweep wallet${RESET}
${DIM}${'─'.repeat(64)}${RESET}

${BOLD}⚠  RECOVERY MNEMONIC — WRITE THIS DOWN, ONCE${RESET}
${RED}${mnemonic}${RESET}

${DIM}This is the only time it is displayed, and it is a DIFFERENT wallet from
your operator seed. Store it separately — ideally somewhere other than where
you keep the operator backup, so one loss cannot take both.

Anyone with this can move your platform fees. They cannot derive customer
deposit addresses, which is the whole point.${RESET}

${BOLD}Sweep addresses (these sign fee transfers)${RESET}
  ${DIM}SOL fees ${RESET} slot ${solSlot}   ${wallet.accountAt(solSlot).address}
  ${DIM}SPL fees ${RESET} slot ${splSlot}   ${wallet.accountAt(splSlot).address}

${DIM}Fund the SOL address with a small amount of SOL (0.05 is plenty for a very
long time — sweeps only move a tiny fraction as rent) and nothing else. Fee
amounts accrue in the database and are swept from these addresses.${RESET}

${BOLD}Add to your .env${RESET}

${GREEN}WALLET_SWEEP_SEED="${envelope}"${RESET}

${DIM}Then restart the worker. Confirm the split is live with:

  npm run wallet:show

The absence of a "sweep seed not split" warning means it took effect.${RESET}

${BOLD}Verify your backup${RESET}

${DIM}  npm run wallet:verify -- --stdin

  Type the phrase, hidden. It checks the word count, the BIP39 checksum, HD
  derivation, and that the key can actually sign — without displaying it.${RESET}
`);
}

main();
