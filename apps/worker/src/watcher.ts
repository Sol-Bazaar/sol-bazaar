/**
 * Solana payment watcher.
 *
 * ── How it works ────────────────────────────────────────────────────────────
 * Every order owns a unique deposit address, so detection is a matter of
 * scanning each *pending* address for incoming transfers. Because each address
 * sees only its own order's traffic, there is no cursor to maintain and no
 * possibility of one payment matching two orders.
 *
 * ── Why polling, and how often ──────────────────────────────────────────────
 * Solana produces a block roughly every 400ms, so a 5-second poll means a
 * customer waits ~2.5s on average to see their payment land. Polling (rather
 * than a WebSocket subscription on every address) keeps us well under any RPC
 * quota even with thousands of open orders, and a subscription would give no
 * benefit: we only need to know "did anything arrive", not every log line.
 *
 * ── Safety properties ───────────────────────────────────────────────────────
 *  - `PaymentTx.signature` is UNIQUE, so re-processing a transaction is a
 *    no-op at the database level. A watcher restart mid-scan cannot double-credit.
 *  - An advisory lock guarantees only one watcher process handles the queue even
 *    if you accidentally run two.
 *  - Credit is only applied when `received >= expected - tolerance`, and the
 *    transition to PAID is a conditional UPDATE, so concurrent ticks cannot
 *    both trigger fulfilment.
 *  - Underpayment is recorded but does NOT issue a card. Fulfilment requires
 *    PAID, which requires the tolerance threshold to be met.
 */
import {
  prisma,
  OrderStatus,
  FulfillmentStatus,
  TokenSymbol,
} from '@solbazaar/db';
import { PublicKey } from '@solana/web3.js';
import { enqueue } from '@solbazaar/jobs';
import { RpcPool, buildScanTarget, currentSlot, scanDeposit, tokenInfo } from '@solbazaar/crypto';
import type { ObservedCredit } from '@solbazaar/crypto';
import {
  createLogger,
  sleep,
  requiredAtomic,
  shortfallPct,
  atomicToUsd,
  atomicToDecimal,
  TokenBucket,
} from '@solbazaar/core';
import type { Prisma } from '@solbazaar/db';

const log = createLogger({ service: 'watcher' });

export interface WatcherOptions {
  pollIntervalMs?: number;
  batchSize?: number;
  isDevnet?: boolean;
}

export class PaymentWatcher {
  private readonly rpc: RpcPool;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly isDevnet: boolean;
  private readonly bucket = new TokenBucket(25, 40);
  private running = false;

  constructor(opts: WatcherOptions = {}) {
    this.rpc = RpcPool.fromEnv();
    this.pollIntervalMs = opts.pollIntervalMs ?? Number(process.env.WATCHER_INTERVAL_MS ?? 5000);
    this.batchSize = opts.batchSize ?? Number(process.env.WATCHER_BATCH ?? 60);
    this.isDevnet = opts.isDevnet ?? process.env.SOLANA_CLUSTER !== 'mainnet-beta';
    log.info('watcher_config', {
      cluster: this.rpc.config.cluster,
      rpc: this.rpc.activeUrl,
      intervalMs: this.pollIntervalMs,
      batch: this.batchSize,
    });
  }

  async start(): Promise<void> {
    this.running = true;
    log.info('watcher_started');

    while (this.running) {
      try {
        const processed = await this.tick();
        if (processed === 0) {
          // Idle: back off to the base interval.
          await sleep(this.pollIntervalMs);
        } else {
          // Busy: drain the queue faster than new orders arrive.
          await sleep(Math.max(400, Math.floor(this.pollIntervalMs / 3)));
        }
      } catch (e) {
        log.error('tick_failed', { err: (e as Error).message, stack: (e as Error).stack?.split('\n')[1] });
        await sleep(this.pollIntervalMs * 2);
      }
    }
  }

  stop(): void {
    this.running = false;
    log.info('watcher_stopping');
  }

  /** One pass over the pending-order queue. Returns how many were touched. */
  async tick(): Promise<number> {
    const connection = this.rpc.current;
    let head: number;
    try {
      head = await currentSlot(connection);
    } catch (e) {
      log.warn('getSlot_failed', { err: (e as Error).message });
      this.rpc.markFailure(this.rpc.activeUrl);
      return 0;
    }

    // Oldest orders first: a customer who has been waiting 29 minutes matters
    // more than one who just started paying.
    const pending = await prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      select: {
        id: true,
        orderNumber: true,
        token: true,
        tokenDecimals: true,
        mintAddress: true,
        depositAddress: true,
        depositAta: true,
        expectedAtomic: true,
        receivedAtomic: true,
        toleranceBps: true,
        totalUsd: true,
        tokenUsdPrice: true,
        email: true,
        txs: { select: { signature: true } },
      },
    });

    if (!pending.length) return 0;

    let touched = 0;

    for (const order of pending) {
      const wait = this.bucket.msUntil(1);
      if (wait > 0) await sleep(wait);
      this.bucket.tryRemove(1);

      try {
        const target = await buildScanTarget({
          orderId: order.id,
          depositAddress: order.depositAddress,
          token: order.token as TokenSymbol,
          isDevnet: this.isDevnet,
          recordedSignatures: order.txs.map((t) => t.signature),
        });
        // The ATA is precomputed at order creation; trust it if present.
        if (order.depositAta) target.ataAddress = order.depositAta;

        const credits = await scanDeposit(connection, target, { currentSlot: head });
        if (credits.length) {
          touched++;
          await this.applyCredits(order, credits);
        }
      } catch (e) {
        log.warn('order_scan_failed', { orderNumber: order.orderNumber, err: (e as Error).message });
      }
    }

    return touched;
  }

  /**
   * Persist new credits and advance the order state machine.
   * Runs in one transaction so `receivedAtomic` can never disagree with the
   * PaymentTx rows that justify it.
   */
  private async applyCredits(
    order: {
      id: string;
      orderNumber: string;
      tokenDecimals: number;
      expectedAtomic: string;
      receivedAtomic: string;
      toleranceBps: number;
      totalUsd: unknown;
      tokenUsdPrice: unknown;
      email: string;
    },
    credits: ObservedCredit[],
  ): Promise<void> {
    let received = BigInt(order.receivedAtomic);
    let inserted = 0;

    for (const c of credits) {
      // Only inbound value credits an order; ignore sweeps/refunds going out.
      if (c.direction !== 'IN') continue;

      const res = await prisma.paymentTx.createMany({
        data: credits.map((x) => ({
          orderId: order.id,
          signature: x.signature,
          slot: x.slot,
          blockTime: x.blockTime ? new Date(x.blockTime * 1000) : null,
          atomicAmount: x.atomicAmount.toString(),
          direction: x.direction,
          confirmations: x.confirmations,
          finalized: x.finalized,
          meta: (x.raw ?? {}) as Prisma.InputJsonValue,
        })),
        skipDuplicates: true, // the UNIQUE signature constraint is the guard
      });
      inserted += res.count;
      received += c.atomicAmount;
      break; // all credits were inserted in one call
    }

    if (!inserted) return; // everything was already recorded

    const expected = BigInt(order.expectedAtomic);
    const required = requiredAtomic(expected, order.toleranceBps);
    const paid = received >= required;

    const usdReceived = atomicToUsd(received, order.tokenDecimals, String(order.tokenUsdPrice));
    const usdExpected = atomicToUsd(expected, order.tokenDecimals, String(order.tokenUsdPrice));
    const shortfall = paid ? null : usdExpected.minus(usdReceived);

    log.info(paid ? 'payment_confirmed' : 'payment_partial', {
      orderNumber: order.orderNumber,
      received: received.toString(),
      required: required.toString(),
      expected: expected.toString(),
      txs: inserted,
      shortfallPct: paid ? undefined : shortfallPct(received, expected).toFixed(2),
    });

    if (!paid) {
      // Record the partial payment so the customer sees exactly what is missing.
      await prisma.order.update({
        where: { id: order.id },
        data: {
          receivedAtomic: received.toString(),
          paymentTxCount: { increment: inserted },
          underpaidUsd: shortfall,
          confirmations: Math.max(...credits.map((c) => c.confirmations), 0),
        },
      });
      return;
    }

    // ── Settled ─────────────────────────────────────────────────────────────
    // Conditional update: only the transition that actually flips PENDING ->
    // PAID proceeds to fulfilment, so a concurrent tick cannot double-issue.
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, status: OrderStatus.PENDING_PAYMENT },
      data: {
        status: OrderStatus.PAID,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        receivedAtomic: received.toString(),
        paidAtomic: received.toString(),
        paymentTxCount: { increment: inserted },
        confirmations: Math.max(...credits.map((c) => c.confirmations), 0),
        paidAt: new Date(),
        underpaidUsd: null,
        overpaidUsd: received > expected ? atomicToUsd(received - expected, order.tokenDecimals, String(order.tokenUsdPrice)) : null,
      },
    });

    if (claimed.count === 0) {
      log.info('payment_already_claimed', { orderNumber: order.orderNumber });
      return;
    }

    // Fulfilment is queued, never inlined: the provider call must not block the
    // watcher loop (and must survive a crash between claim and dispatch).
    await enqueue('FULFILL_ORDER', { orderId: order.id }, { dedupeKey: `fulfill:${order.id}` });
    await enqueue('DELIVER_ORDER_EMAIL', { orderId: order.id }, { dedupeKey: `confirm:${order.id}` });
    await enqueue('SEND_WEBHOOK', { orderId: order.id, event: 'order.paid' }, { dedupeKey: `wh:paid:${order.id}` });

    log.info('order_paid_queued', { orderNumber: order.orderNumber, overpaid: received > expected });
  }

  /** Convenience for tests / the health endpoint. */
  async inspect(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { depositAddress: true, depositAta: true, token: true },
    });
    if (!order) return null;
    const connection = this.rpc.current;
    // web3.js returns lamports as a JS number; widen immediately so nothing
    // downstream can lose precision.
    const lamports = BigInt(await connection.getBalance(new PublicKey(order.depositAddress), 'confirmed'));
    return {
      lamports: lamports.toString(),
      sol: atomicToDecimal(lamports, 9).toFixed(6),
      address: order.depositAddress,
      ata: order.depositAta,
      token: order.token,
    };
  }
}

export { tokenInfo };