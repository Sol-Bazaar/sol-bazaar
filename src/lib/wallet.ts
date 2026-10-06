import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { HDKey } from '@scure/bip32';
import * as bip39 from 'bip39';

/**
 * HD Wallet for generating unique deposit addresses per order.
 * Uses BIP-44 derivation path: m/44'/501'/{index}'/0'
 * This is Solana's standard derivation path.
 */

const MASTER_SEED = process.env.WALLET_MASTER_SEED; // 32-byte hex or base58 encoded seed

if (!MASTER_SEED) {
  console.warn('WALLET_MASTER_SEED not set - using mock addresses');
}

let masterKey: HDKey | null = null;

function getMasterKey(): HDKey {
  if (masterKey) return masterKey;

  if (!MASTER_SEED) {
    throw new Error('WALLET_MASTER_SEED not configured');
  }

  let seedBuffer: Buffer;
  
  try {
    // Try to decode as base58 (Solana private key format)
    seedBuffer = Buffer.from(bs58.decode(MASTER_SEED));
  } catch {
    // Try as hex
    seedBuffer = Buffer.from(MASTER_SEED, 'hex');
  }

  // Ensure 32 bytes (Ed25519 seed)
  if (seedBuffer.length !== 32) {
    // If it's a 64-byte keypair, take first 32 bytes (seed)
    if (seedBuffer.length === 64) {
      seedBuffer = seedBuffer.slice(0, 32);
    } else {
      throw new Error(`Invalid seed length: ${seedBuffer.length}. Expected 32 or 64 bytes.`);
    }
  }

  masterKey = HDKey.fromMasterSeed(seedBuffer);
  return masterKey;
}

/**
 * Derive deposit address for an order.
 * Uses derivation path: m/44'/501'/{orderIndex}'/0'
 * @param orderIndex - Unique index for each order (can be order ID hash or sequential)
 * @returns { address: string, publicKey: PublicKey, derivationPath: string }
 */
export function deriveDepositAddress(orderIndex: number): {
  address: string;
  publicKey: PublicKey;
  derivationPath: string;
} {
  const master = getMasterKey();
  
  // BIP-44 for Solana: m/44'/501'/{account}'/0'
  const path = `m/44'/501'/${orderIndex}'/0'`;
  const child = master.derive(path);
  
  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  const keypair = Keypair.fromSeed(child.privateKey);
  const publicKey = keypair.publicKey;

  return {
    address: publicKey.toBase58(),
    publicKey,
    derivationPath: path,
  };
}

/**
 * Derive address from order ID (deterministic)
 * Uses order ID hash as index to avoid maintaining a counter
 */
export function deriveDepositAddressFromOrderId(orderId: string): {
  address: string;
  publicKey: PublicKey;
  derivationPath: string;
} {
  // Use first 4 bytes of order ID hash as index (ensures uniqueness)
  let hash = 0;
  for (let i = 0; i < Math.min(orderId.length, 8); i++) {
    hash = ((hash << 5) - hash + orderId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash);
  
  return deriveDepositAddress(index);
}

/**
 * Get the public key for a deposit address (for verification)
 */
export function getDepositPublicKey(address: string): PublicKey {
  return new PublicKey(address);
}

/**
 * Generate QR code data for payment
 */
export function generatePaymentURI(address: string, amount: string, token: 'USDC' | 'SOL' = 'USDC'): string {
  const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC on Solana mainnet
  
  if (token === 'USDC') {
    // For SPL tokens, we need to use the token program
    // The URI format for Solana Pay with SPL tokens
    return `solana:${address}?amount=${amount}&spl-token=${usdcMint}&label=GiftCard Store&message=Gift card purchase`;
  }
  
  return `solana:${address}?amount=${amount}&label=GiftCard Store&message=Gift card purchase`;
}

/**
 * Generate QR code image URL using a QR code service
 */
export function generateQRCodeURI(paymentURI: string, size = 336): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(paymentURI)}`;
}

/**
 * Verify a payment by checking transaction on Solana
 * In production, use a proper indexer or RPC call
 */
export async function verifyPayment(params: {
  expectedAddress: string;
  expectedAmount: string; // In base units (lamports for SOL, micro-USDC for USDC)
  token: 'USDC' | 'SOL';
  since?: Date;
}): Promise<{ found: boolean; txSignature?: string; confirmations?: number }> {
  // In production, use Helius/QuickNode RPC or indexer to check for payments
  // This is a stub implementation
  console.log('Verifying payment for:', params);
  
  // TODO: Implement actual Solana RPC call to check for payments
  // Use getSignaturesForAddress or getTokenAccountsByOwner
  
  return { found: false };
}

/**
 * Mock function for development - returns a fake address
 * Replace with real HD derivation in production
 */
export function getMockDepositAddress(orderId: string): string {
  // In development, return a known test address
  // This is the USDC token account for a known test wallet
  return '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
}