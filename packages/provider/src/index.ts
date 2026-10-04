import { createLogger, providerError } from '@solbazaar/core';
import { MockGiftCardProvider } from './mock';
import { RechargeGiftCardProvider } from './recharge';
import type { GiftCardProvider } from './types';

export * from './types';
export { MockGiftCardProvider } from './mock';
export { RechargeGiftCardProvider } from './recharge';

const log = createLogger({ service: 'provider:registry' });

const registry = new Map<string, GiftCardProvider>();

export function registerProvider(p: GiftCardProvider): void {
  if (registry.has(p.key)) throw providerError(`Provider "${p.key}" is already registered`);
  registry.set(p.key, p);
  log.info('provider_registered', { key: p.key });
}

export function getProvider(key: string): GiftCardProvider {
  const p = registry.get(key);
  if (!p) throw providerError(`Unknown provider "${key}"`, { available: [...registry.keys()] });
  return p;
}

export function hasProvider(key: string): boolean {
  return registry.has(key);
}

export function listProviders(): GiftCardProvider[] {
  return [...registry.values()];
}

/**
 * Instantiate every provider that has credentials present in the env.
 *
 * Idempotent by design: this is called from several entry points (worker boot,
 * the fulfilment module, one-off scripts), and a double registration used to
 * throw — which failed every `FULFILL_ORDER` job in a process that had also
 * booted normally. Re-registering simply replaces the instance.
 */
export function bootstrapProviders(env = process.env): void {
  if (!hasProvider('mock')) {
    registerProvider(new MockGiftCardProvider());
  } else {
    // Refresh the instance so a changed config (e.g. latency) takes effect.
    registry.set('mock', new MockGiftCardProvider());
  }

  if (env.RECHARGE_API_KEY) {
    const next = new RechargeGiftCardProvider({
      apiKey: env.RECHARGE_API_KEY,
      baseUrl: env.RECHARGE_BASE_URL,
      webhookSecret: env.RECHARGE_WEBHOOK_SECRET,
      currency: env.RECHARGE_CURRENCY ?? 'USD',
    });
    if (!hasProvider('recharge')) {
      registerProvider(next);
      log.info('provider_registered', { key: 'recharge' });
    } else {
      registry.set('recharge', next);
    }
  } else {
    log.warn('recharge_not_configured', { hint: 'Set RECHARGE_API_KEY to enable the live issuer' });
  }
}