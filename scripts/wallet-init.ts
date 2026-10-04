/**
 * Generate the operator wallet and write it straight into .env.
 *
 * The mnemonic never leaves this process: it is not printed, not logged, and
 * not visible to an agent or a transcript. Used by setup automation; for a
 * production key, run `npm run wallet:new` yourself and record the mnemonic
 * offline.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { generateMnemonic, encryptSeed, SolanaHdWallet } from "@solbazaar/crypto";

const master = process.env.WALLET_MASTER_KEY;
if (!master) throw new Error("WALLET_MASTER_KEY must be set in .env first");

const mnemonic = generateMnemonic(256);
const envelope = encryptSeed(mnemonic, master);
const wallet = new SolanaHdWallet({ seed: mnemonic });

let env = readFileSync(".env", "utf8");
const line = `WALLET_SEED="${envelope}"`;
env = /^WALLET_SEED=.*$/m.test(env)
  ? env.replace(/^WALLET_SEED=.*$/m, line)
  : env + "\n" + line;
writeFileSync(".env", env);

console.log("WALLET_SEED written to .env");
console.log("operator (sweep) address, slot 0:", wallet.accountAt(0).address);
console.log("mnemonic: NOT printed - regenerate yourself for a backed-up key");
