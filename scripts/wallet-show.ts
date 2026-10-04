/**
 * Print the configured operator wallet's public addresses.
 *
 *   npm run wallet:show
 *
 * Safe to run in production: only public keys are derived and nothing is
 * written. Useful for confirming which seed is actually loaded after an
 * incident or a bad deploy.
 */
import 'dotenv/config';
import { SolanaHdWallet, tokenInfo } from '@solbazaar/crypto';
import { TokenSymbol } from '@solbazaar/db';
import { getAssociatedTokenAddress, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

function main() {
  const wallet = SolanaHdWallet.fromEnv();
  const isDevnet = process.env.SOLANA_CLUSTER !== 'mainnet-beta';
  const split = SolanaHdWallet.sweepIsSplit();
  const sweep = SolanaHdWallet.sweepFromEnv();

  console.log(`\nOperator wallet (${process.env.SOLANA_CLUSTER ?? 'devnet'})`);
  console.log('─'.repeat(66));
  console.log(`  slot 0: ${wallet.address0}`);
  console.log('    (first deposit slot — funds accumulate here until swept)');
  console.log(
    `    fee sweep slots: ${process.env.WALLET_SWEEP_INDEX_SOL ?? 999000} (SOL), ` +
      `${process.env.WALLET_SWEEP_INDEX_SPL ?? 999001} (SPL)`,
  );

  // The split is the thing to check after a deploy: if it silently fell back,
  // a compromised sweeper can derive every customer deposit address again.
  console.log(
    split
      ? `\n  ✓ fee sweeping uses its own seed — addresses below are NOT derivable from the operator seed`
      : '\n  ! fee sweeping shares the operator seed. Set WALLET_SWEEP_SEED (npm run wallet:sweep-new) to isolate it.',
  );
  if (split) {
    console.log(`    sweep slot ${process.env.WALLET_SWEEP_INDEX_SOL ?? 999000} (SOL): ${sweep.accountAt(Number(process.env.WALLET_SWEEP_INDEX_SOL ?? 999000)).address}`);
    console.log(`    sweep slot ${process.env.WALLET_SWEEP_INDEX_SPL ?? 999001} (SPL): ${sweep.accountAt(Number(process.env.WALLET_SWEEP_INDEX_SPL ?? 999001)).address}`);
    console.log(`    sweep slot 0 (reference)  : ${sweep.accountAt(0).address}`);
  }

  console.log('\n  Deposit slots 0-9:');
  for (let i = 0; i < 10; i++) {
    const a = wallet.accountAt(i);
    console.log(`    ${String(i).padStart(3)}  ${a.address}  ${a.path}`);
  }

  console.log('\n  SPL associated token accounts for the next 3 slots:');
  for (const symbol of ['USDC', 'USDT'] as TokenSymbol[]) {
    try {
      const info = tokenInfo(symbol, isDevnet);
      if (!info.mint) continue;
      for (let i = 0; i < 3; i++) {
        const ata = getAssociatedTokenAddressSync(new PublicKey(info.mint), new PublicKey(wallet.accountAt(i).address));
        console.log(`    slot ${i} ${symbol}: ${ata.toBase58()}`);
      }
    } catch {
      /* token not configured on this cluster */
    }
  }

  console.log(
    '\n  Customers paying with USDC/USDT must be sent to the ATA, not the\n' +
      '  owner address. The checkout page shows the correct one automatically.\n',
  );
}

try {
  main();
} catch (e) {
  console.error(`\n✖ ${(e as Error).message}\n`);
  process.exit(1);
}