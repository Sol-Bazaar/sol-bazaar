export interface Tenant {
  id: string;
  slug: string;
  name: string;
  legalName: string;
  tagline: string;
  heroHeadline: string;
  heroSubhead: string;
  logoUrl: string;
  accent: string;
  accent2: string;
}

export async function getTenant(): Promise<Tenant> {
  return {
    id: 'default',
    slug: 'sol-bazaar',
    name: 'Sol Bazaar',
    legalName: 'Sol Bazaar Inc.',
    tagline: 'Gift cards, paid with crypto.',
    heroHeadline: 'Gift Cards on Crypto',
    heroSubhead: '6,600+ brands. 180+ countries. Pay with USDC on Solana — settled on-chain in seconds, no bank account required.',
    logoUrl: '/brand/logo-112.png',
    accent: '#FFFFFF',
    accent2: '#F5F2EC',
  };
}

export function brandOrDefaults(tenant: Tenant) {
  return {
    name: tenant.name,
    legalName: tenant.legalName,
    tagline: tenant.tagline,
    heroHeadline: tenant.heroHeadline,
    heroSubhead: tenant.heroSubhead,
    logoUrl: tenant.logoUrl,
    accent: tenant.accent,
    accent2: tenant.accent2,
    announcement: '',
    supportEmail: 'support@giftcardstore.com',
    supportUrl: null,
  };
}