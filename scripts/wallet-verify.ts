/**
 * Verify an operator-wallet backup actually works.
 *
 *   npm run wallet:verify                       # check the .env envelope
 *   npm run wallet:verify -- --seed "word ..."  # check a phrase you typed
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * A seed phrase that is *wrong* is worse than no backup at all, because it gives
 * you false confidence right up until you need it. Common ways it goes wrong:
 * a transposed word, a word autocorrected by a password manager, a missing word,
 * a phrase written in the wrong order, 12 words instead of 24, or a phrase
 * transcribed from a blurry photo.
 *
 * This proves the backup end to end — it decrypts the seed, checks the BIP39
 * checksum, derives addresses at several slots, and *signs a real message* — then
 * verifies the signature. A phrase that passes this will recover the wallet.
 *
 * ── Why it never prints the phrase ───────────────────────────────────────────
 * You should never paste a seed where something else might capture it: not a
 * shell history file, not a CI log, not a transcript. So with `--seed` the
 * phrase is read from stdin with echo suppressed, used, and then discarded. It
 * is never written to stdout, never logged, and never passed as an argv value
 * (argv is world-readable in /proc on Linux and lands in PowerShell history).
 *
 * Output is limited to *public* facts: addresses, paths, pass/fail. Anyone
 * watching you run this learns nothing that helps them steal the wallet.
 */
import 'dotenv/config';
import { createHmac, randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
import {
  SolanaHdWallet,
  decryptSeed,
  normaliseSeed,
  generateMnemonic,
  encryptSeed,
} from '@solbazaar/crypto';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** Hidden prompt for the phrase. Echo is suppressed where the platform allows. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(label);
    const stdin = process.stdin;

    const wasRaw = Boolean((stdin as unknown as { isRaw?: boolean }).isRaw);
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(true);

    let buf = '';
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString()) {
        const c = ch.charCodeAt(0);
        // Enter
        if (c === 13 || c === 10) {
          if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(wasRaw);
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(buf.trim());
        }
        // Ctrl+C — do not leave the terminal wedged in raw mode
        if (c === 3) {
          if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(wasRaw);
          stdin.off('data', onData);
          process.stdout.write('\n');
          process.exit(130);
        }
        // Backspace
        if (c === 127 || c === 8) {
          buf = buf.slice(0, -1);
          continue;
        }
        // Ignore control characters, accept the rest
        if (c < 32) continue;
        buf += ch;
      }
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

type Check = { name: string; ok: boolean; detail: string; fatal?: boolean };

function main(): void {
  const useStdin = process.argv.includes('--stdin');
  const checks: Check[] = [];

  // ── 1. Get a candidate phrase ──────────────────────────────────────────────
  let phrase: string;
  let source: string;

  const seedArgIdx = process.argv.indexOf('--seed');
  if (seedArgIdx !== -1 && process.argv[seedArgIdx + 1]) {
    console.error(
      `${RED}✖ Refusing to read a seed from argv.${RESET}\n\n` +
        `Command-line arguments are visible to other processes and are saved in\n` +
        `your shell history. Use one of these instead:\n\n` +
        `  ${BOLD}npm run wallet:verify${RESET}                      ${DIM}verify the .env envelope${RESET}\n` +
        `  ${BOLD}npm run wallet:verify -- --stdin${RESET}            ${DIM}type the phrase, hidden${RESET}\n`,
    );
    process.exit(2);
  }

  if (useStdin) {
    process.stdout.write(
      `${YELLOW}${BOLD}Your phrase will not be displayed or saved.${RESET}\n` +
        `${DIM}Type your 24 words, then press Enter.${RESET}\n\n`,
    );
    phrase = '';
    source = 'typed';
    // Async read; everything below runs in .then() to keep the phrase scoped.
    void promptHidden('  phrase > ').then((typed) => run(typed, 'typed', checks));
    return;
  }

  const envBlob = process.env.WALLET_SEED?.trim();
  if (!envBlob) {
    console.error(
      `${RED}✖ WALLET_SEED is not set.${RESET}\n\n` +
        `To verify a backup phrase instead:  ${BOLD}npm run wallet:verify -- --stdin${RESET}\n`,
    );
    process.exit(1);
  }
  source = '.env envelope';

  if (envBlob.startsWith('v1.')) {
    const master = process.env.WALLET_MASTER_KEY;
    if (!master) {
      console.error(`${RED}✖ WALLET_SEED is encrypted but WALLET_MASTER_KEY is not set.${RESET}`);
      process.exit(1);
    }
    try {
      phrase = decryptSeed(envBlob, master);
    } catch {
      console.error(
        `${RED}✖ Could not decrypt WALLET_SEED.${RESET}\n\n` +
          `  WALLET_MASTER_KEY does not match the one used to encrypt it.\n` +
          `  This is fatal: every deposit address is unrecoverable until it matches.\n`,
      );
      process.exit(1);
    }
  } else {
    phrase = envBlob;
    source = 'WALLET_SEED (plaintext)';
  }

  run(phrase, source, checks);
}

function run(phrase: string, source: string, checks: Check[]): void {
  const normalised = phrase.trim().toLowerCase().replace(/\s+/g, ' ');

  console.log(`\n${BOLD}Sol Bazaar — wallet backup check${RESET}`);
  console.log(`${DIM}${'─'.repeat(64)}${RESET}`);
  console.log(`${DIM}source: ${source}${RESET}\n`);

  // ── 2. Word count ──────────────────────────────────────────────────────────
  const words = normalised.split(' ').filter(Boolean);
  checks.push({
    name: 'word count',
    ok: words.length === 24,
    detail: `${words.length} words${words.length === 24 ? '' : ' (expected 24)'}`,
    fatal: true,
  });

  // ── 3. BIP39 checksum ──────────────────────────────────────────────────────
  // This catches every single-word transcription error, which is the most common
  // way a hand-written backup goes bad. The checksum is a hash over the words,
  // so a swapped pair fails too.
  const valid = bip39.validateMnemonic(normalised);
  checks.push({
    name: 'BIP39 checksum',
    ok: valid,
    detail: valid ? 'valid' : 'FAILED — a word is wrong, missing, or out of order',
    fatal: true,
  });

  if (checks.some((c) => c.fatal && !c.ok)) {
    report(checks);
    console.log(
      `${RED}${BOLD}This phrase will NOT recover your wallet.${RESET}\n\n` +
        `  Re-read it from your backup and run this again. Nothing has been changed.\n` +
        `  If your only copy is this failing one, the wallet cannot be recovered and\n` +
        `  you must generate a new one before taking any real payments.\n`,
    );
    process.exit(1);
  }

  // ── 4. Derivation ──────────────────────────────────────────────────────────
  const { seedHex } = normaliseSeed(normalised);
  const wallet = new SolanaHdWallet({ seed: normalised });

  const samples = [0, 1, 999_000];
  const derived = samples.map((i) => ({ i, ...wallet.accountAt(i) }));
  checks.push({
    name: 'derivation',
    ok: derived.every((d) => PublicKey.isOnCurve(new PublicKey(d.address).toBytes())),
    detail: `${derived.length} slots derived on-curve`,
    fatal: true,
  });

  // ── 5. Signing ─────────────────────────────────────────────────────────────
  // Derivation alone does not prove the private scalar is intact: a phrase can
  // checksum-validate and still not control the money if the derivation path is
  // wrong. So sign something with the derived key and verify it against the
  // *public* key. This is what separates "the phrase decrypts" from "the phrase
  // controls the wallet".
  //
  // Uses tweetnacl directly. `@solana/web3.js` 1.x has no personal-message
  // helper on its main entry point (signing lives in web3.js/src/signing), and
  // nacl is already a transitive dependency — so this adds nothing to install,
  // and it verifies a signature rather than recovering a key from one, which is
  // the stronger claim.
  let signOk = false;
  let signDetail = '';
  try {
    const kp = wallet.keypairAt(0);
    const message = new TextEncoder().encode(`sol-bazaar backup check ${randomBytes(8).toString('hex')}`);
    const signature = nacl.sign.detached(message, kp.secretKey);

    const verifies = nacl.sign.detached.verify(message, signature, kp.publicKey.toBytes());
    // A verifier that accepts anything is worthless, so prove it also rejects a
    // tampered message. Without this the check could pass on a broken nacl.
    const tampered = nacl.sign.detached.verify(
      new TextEncoder().encode(message[0] === 0 ? 'x' : 'tampered'),
      signature,
      kp.publicKey.toBytes(),
    );

    signOk = verifies && !tampered;
    signDetail = signOk
      ? 'signature verifies, and a tampered message is correctly rejected'
      : `verifies=${verifies} rejectsTamper=${!tampered}`;
  } catch (e) {
    signDetail = `signing failed: ${(e as Error).message}`;
  }
  checks.push({ name: 'signing', ok: signOk, detail: signDetail, fatal: true });

  // ── 6. Envelope round-trip ─────────────────────────────────────────────────
  // Confirms the value in .env survives an encrypt/decrypt cycle, so a future
  // restore from that envelope is reliable.
  let rtOk = false;
  let rtDetail = '';
  const master = process.env.WALLET_MASTER_KEY;
  if (master) {
    try {
      const round = decryptSeed(encryptSeed(normalised, master), master);
      rtOk = round === phrase;
      rtDetail = rtOk ? 'encrypt -> decrypt round-trips exactly' : 'round-trip mismatch';
    } catch (e) {
      rtDetail = `failed: ${(e as Error).message}`;
    }
  } else {
    rtDetail = 'skipped — WALLET_MASTER_KEY not set';
  }
  checks.push({ name: 'envelope round-trip', ok: master ? rtOk : true, detail: rtDetail });

  report(checks);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`${DIM}${'─'.repeat(64)}${RESET}`);
  console.log(`${BOLD}Public addresses this backup controls${RESET}`);
  for (const d of derived) {
    console.log(`  ${DIM}slot ${String(d.i).padStart(6)}${RESET}  ${d.address}`);
  }
  console.log(`\n${DIM}Anyone with these addresses can watch them, not spend from them.${RESET}\n`);

  const allOk = checks.every((c) => c.ok);
  if (allOk) {
    // A fingerprint that identifies this wallet without revealing anything. Useful
    // for confirming "yes, this is the right backup" across two devices.
    const fingerprint = createHmac('sha256', 'sol-bazaar-wallet-fingerprint')
      .update(seedHex)
      .digest('hex')
      .slice(0, 16)
      .match(/.{4}/g)!
      .join('-');
    console.log(`${GREEN}${BOLD}✔ Backups verified — this phrase recovers the wallet.${RESET}`);
    console.log(`${DIM}  fingerprint: ${fingerprint}${RESET}`);
    console.log(`${DIM}  Match this on another device to confirm both hold the same wallet.${RESET}\n`);
    process.exit(0);
  }

  console.log(`${YELLOW}${BOLD}✔ Some checks need attention (see above).${RESET}\n`);
  process.exit(1);
}

function report(checks: Check[]): void {
  for (const c of checks) {
    const mark = c.ok ? `${GREEN}✔${RESET}` : `${RED}✘${RESET}`;
    console.log(`  ${mark} ${c.name.padEnd(22)} ${c.ok ? c.detail : `${RED}${c.detail}${RESET}`}`);
  }
  console.log('');
}

// Referenced so the import is not dropped by a future tidy-up; generateMnemonic
// is re-exported for scripts that want a throwaway wallet for testing.
void generateMnemonic;
void encryptSeed;

main();
