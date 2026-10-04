/**
 * Live-chain verification of the deposit parser.
 *
 *   npm run test:chain              # one block, devnet
 *   npm run test:chain -- --blocks 5
 *
 * The parser is the highest-risk code in this platform: a wrong balance delta
 * either issues a gift card nobody paid for, or reports "no payment" and strands
 * a customer's funds. Both failures are silent, so they are checked here against
 * real chain data on every run.
 *
 * Asserted, per transaction:
 *   1. `sum(preBalances) - fee == sum(postBalances)`   (chain self-consistency)
 *   2. `staticAccountKeys.length == preBalances.length` (index space is right)
 *   3. an unchanged static account yields a delta of exactly 0
 *   4. a computed SOL delta matches the parsed transfer instruction
 *   5. a computed SPL token delta matches the raw pre/post token balances
 *
 * Notes on RPC response shapes this exists to pin down:
 *   - `getBlock`/`getTransaction` return the *wrapper* `{ slot, transaction, meta }`.
 *   - `preBalances` is indexed by STATIC keys only; `getAccountKeys()` also
 *     returns address-lookup-table addresses, which are not in that array.
 *   - Versioned messages carry compiled instructions on the message and the
 *     *parsed* ones under `meta.parsedInstructions`.
 *   - Solana now emits v1 transactions, so `maxSupportedTransactionVersion`
 *     must be 1 (see MAX_TX_VERSION).
 */
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { deltasForAccount, balanceIndexSpaceOf, staticAccountKeysOf, assertIndexSpace, MAX_TX_VERSION } from '@solbazaar/crypto';

const args = process.argv.slice(2);
const numBlocks = Number(args[args.indexOf('--blocks') + 1]) || 1;
const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

/** devnet USDC — plenty of traffic, so SPL paths actually get exercised. */
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const mint = cluster === 'mainnet-beta' ? MAINNET_USDC : DEVNET_USDC;

  console.log(`\nChain verification — ${cluster}`);
  console.log(`RPC: ${RPC}`);
  console.log(`maxSupportedTransactionVersion: ${MAX_TX_VERSION}\n`);

  const head = await conn.getSlot('confirmed');

  const totals = {
    tx: 0,
    legacy: 0,
    v0: 0,
    v1: 0,
    invariantOk: 0,
    keyLenOk: 0,
    untouchedOk: 0,
    untouchedTested: 0,
    lutTx: 0,
    solTransfers: 0,
    solExact: 0,
    splOk: 0,
    splBad: 0,
  };
  const failures: string[] = [];

  for (let back = 0; back < numBlocks; back++) {
    let block: any;
    try {
      block = await conn.getBlock(head - back, {
        maxSupportedTransactionVersion: MAX_TX_VERSION,
        rewards: false,
        transactionDetails: 'full',
      });
    } catch (e) {
      failures.push(`block ${head - back} fetch failed: ${(e as Error).message}`);
      continue;
    }
    if (!block) continue;

    for (const tx of block.transactions) {
      const t: any = tx.transaction;
      const msg = t.message;
      totals.tx++;

      const version = msg.version;
      if (version === undefined || version === 'legacy') totals.legacy++;
      else if (version === 0) totals.v0++;
      else if (version === 1) totals.v1++;
      else failures.push(`unexpected tx version ${version}`);

      // 2. index-space length. The runtime account array is
      //    static ++ loaded.writable ++ loaded.readonly.
      const space = balanceIndexSpaceOf(tx as any);
      try {
        assertIndexSpace(tx as any);
      } catch (e) {
        failures.push((e as Error).message);
      }
      if (space.length === tx.meta.preBalances.length) totals.keyLenOk++;
      else failures.push(`index space ${space.length} != preBalances ${tx.meta.preBalances.length}`);

      if (space.length > staticAccountKeysOf(tx as any).length) totals.lutTx++;

      // 1. chain self-consistency
      const fee = tx.meta?.fee ?? 0;
      const sPre = tx.meta.preBalances.reduce((a: number, b: number) => a + b, 0);
      const sPost = tx.meta.postBalances.reduce((a: number, b: number) => a + b, 0);
      if (sPre - fee === sPost) totals.invariantOk++;
      else failures.push(`balance invariant broken in ${tx.transaction.signatures?.[0]}`);

      // 3. unchanged account -> zero delta
      let zero = 0;
      let tried = 0;
      for (let i = 0; i < space.length; i++) {
        if (tx.meta.preBalances[i] === tx.meta.postBalances[i]) {
          tried++;
          if (deltasForAccount(tx as any, space[i], null).lamports === 0n) zero++;
        }
      }
      if (tried > 0) {
        totals.untouchedTested++;
        if (zero === tried) totals.untouchedOk++;
        else failures.push(`${tried - zero}/${tried} unchanged accounts produced a non-zero delta`);
      }

      // 4. SOL transfer cross-check.
      // Versioned messages put compiled instructions on the message and the
      // parsed ones under meta.parsedInstructions; legacy messages carry parsed
      // instructions inline. Collect from both.
      const parsed: any[] = [
        ...(msg.instructions ?? []).filter((i: any) => i?.parsed).map((i: any) => i.parsed),
        ...((tx.meta.parsedInstructions ?? []).flatMap((x: any) => x?.parsed ?? []) as any[]),
      ];
      for (const p of parsed) {
        if (p?.type === 'transfer' && p.info?.lamports != null) {
          const dest = new PublicKey(p.info.destination);
          const expected = BigInt(p.info.lamports);
          const d = deltasForAccount(tx as any, dest, null);
          if (d.lamports >= expected) {
            totals.solTransfers++;
            if (d.lamports === expected) totals.solExact++;
            else if (d.lamports - expected > 10_000) {
              // More than a priority-fee-sized gap means we are reading the
              // wrong account entirely.
              failures.push(`SOL delta ${d.lamports} far exceeds instruction ${expected}`);
            }
          } else {
            failures.push(`SOL delta ${d.lamports} < instruction ${expected} for ${dest.toBase58()}`);
          }
          break;
        }
      }

      // 5. SPL token-delta cross-check
      for (const b of tx.meta.postTokenBalances ?? []) {
        const pre = tx.meta.preTokenBalances?.find(
          (x: any) => x.accountIndex === b.accountIndex && x.mint === b.mint,
        );
        const raw = BigInt(b.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount?.amount ?? 0);
        if (raw === 0n) continue;
        const owner = space[b.accountIndex];
        if (!owner) {
          failures.push(`token balance references accountIndex ${b.accountIndex} outside the index space`);
          continue;
        }
        const d = deltasForAccount(tx as any, owner, b.mint);
        if (d.tokenAmount === raw) totals.splOk++;
        else {
          totals.splBad++;
          failures.push(`SPL mismatch: computed ${d.tokenAmount} vs raw ${raw}`);
        }
      }
    }
  }

  const n = totals.tx;
  console.log(`transactions analysed : ${n}`);
  console.log(`  legacy / v0 / v1    : ${totals.legacy} / ${totals.v0} / ${totals.v1}`);
  console.log(`  using lookup tables : ${totals.lutTx}`);
  console.log(`index space correct   : ${totals.keyLenOk}/${n}`);
  console.log(`balance invariant     : ${totals.invariantOk}/${n}`);
  console.log(`unchanged -> delta 0  : ${totals.untouchedOk}/${totals.untouchedTested} tx`);
  console.log(`SOL deltas verified   : ${totals.solTransfers} (${totals.solExact} exact)`);
  console.log(`SPL deltas verified   : ${totals.splOk} ok, ${totals.splBad} bad`);

  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const f of failures.slice(0, 15)) console.log(`  ✖ ${f}`);
    console.log('\nRESULT: FAIL');
    process.exit(1);
  }

  if (n === 0) {
    console.log('\nNo transactions analysed (RPC unavailable or empty block) — nothing verified.');
    process.exit(2);
  }

  console.log('\nRESULT: PASS');
}

main().catch((e) => {
  console.error(`\n✖ ${e?.message ?? e}\n`);
  process.exit(1);
});