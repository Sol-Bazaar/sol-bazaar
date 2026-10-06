/**
 * Database seed.
 *
 * Creates:
 *   - Countries + regions (the geo rules everything filters on)
 *   - Categories, brands, products with denominations and stock
 *   - A `GLOBAL` scope for the shared catalogue, so every white-label tenant
 *     inherits it and can override price/visibility per product
 *   - The house tenant (Sol Bazaar) plus a demo partner tenant to prove
 *     subdomain white-labelling works out of the box
 *   - A superadmin account
 *   - Initial token prices
 *
 * Idempotent: safe to run repeatedly (upserts throughout).
 *
 *   npm run db:seed
 */
import 'dotenv/config';
import { scryptSync, randomBytes } from 'node:crypto';
import { PrismaClient, ProductScope, TokenSymbol, TenantStatus, AdminRole } from '@prisma/client';
import { encryptSeed, generateMnemonic, SolanaHdWallet } from '@solbazaar/crypto';

const prisma = new PrismaClient();

const GLOBAL = 'global';

function scopeKey(scope: string, slug: string) {
  return `${scope}:${slug}`;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const COUNTRIES: { code: string; name: string; currency: string; dialCode: string; flagEmoji: string }[] = [
  { code: 'US', name: 'United States', currency: 'USD', dialCode: '+1', flagEmoji: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', dialCode: '+44', flagEmoji: '🇬🇧' },
  { code: 'CA', name: 'Canada', currency: 'CAD', dialCode: '+1', flagEmoji: '🇨🇦' },
  { code: 'AU', name: 'Australia', currency: 'AUD', dialCode: '+61', flagEmoji: '🇦🇺' },
  { code: 'DE', name: 'Germany', currency: 'EUR', dialCode: '+49', flagEmoji: '🇩🇪' },
  { code: 'FR', name: 'France', currency: 'EUR', dialCode: '+33', flagEmoji: '🇫🇷' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', dialCode: '+31', flagEmoji: '🇳🇱' },
  { code: 'ES', name: 'Spain', currency: 'EUR', dialCode: '+34', flagEmoji: '🇪🇸' },
  { code: 'IT', name: 'Italy', currency: 'EUR', dialCode: '+39', flagEmoji: '🇮🇹' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', dialCode: '+971', flagEmoji: '🇦🇪' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', dialCode: '+65', flagEmoji: '🇸🇬' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', dialCode: '+55', flagEmoji: '🇧🇷' },
  { code: 'IN', name: 'India', currency: 'INR', dialCode: '+91', flagEmoji: '🇮🇳' },
  { code: 'JP', name: 'Japan', currency: 'JPY', dialCode: '+81', flagEmoji: '🇯🇵' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', dialCode: '+52', flagEmoji: '🇲🇽' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', dialCode: '+64', flagEmoji: '🇳🇿' },
  { code: 'PL', name: 'Poland', currency: 'PLN', dialCode: '+48', flagEmoji: '🇵🇱' },
  { code: 'SE', name: 'Sweden', currency: 'SEK', dialCode: '+46', flagEmoji: '🇸🇪' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', dialCode: '+27', flagEmoji: '🇿🇦' },
  // Additional markets referenced by the catalogue's region rules.
  { code: 'IE', name: 'Ireland', currency: 'EUR', dialCode: '+353', flagEmoji: '🇮🇪' },
  { code: 'AT', name: 'Austria', currency: 'EUR', dialCode: '+43', flagEmoji: '🇦🇹' },
];

const REGIONS: { code: string; name: string; countries: string[] }[] = [
  { code: 'EU', name: 'European Union', countries: ['DE', 'FR', 'NL', 'ES', 'IT', 'PL', 'IE', 'AT'] },
  { code: 'EEA', name: 'EEA', countries: ['DE', 'FR', 'NL', 'ES', 'IT', 'PL', 'IE', 'AT', 'SE', 'GB'] },
  { code: 'NA', name: 'North America', countries: ['US', 'CA', 'MX'] },
  { code: 'LATAM', name: 'Latin America', countries: ['BR', 'MX'] },
  { code: 'APAC', name: 'Asia-Pacific', countries: ['JP', 'SG', 'IN', 'NZ', 'AU'] },
  { code: 'MENA', name: 'Middle East', countries: ['AE', 'ZA'] },
];

/**
 * Storefront taxonomy.
 *
 * `group` renders a section header in the UI, which is how the long tail
 * (Sports / Experiences / Home / Music / Cars / Software) reads as one
 * "Other" section instead of seven competing top-level tabs.
 */
const CATEGORIES = [
  // ── Primary ────────────────────────────────────────────────────────────
  { slug: 'store', name: 'Store', icon: '🏬', accent: '#F59E0B', sortOrder: 10, group: null,
    description: 'Marketplace and department-store cards.' },
  { slug: 'gaming', name: 'Gaming', icon: '🎮', accent: '#8B5CF6', sortOrder: 20, group: null,
    description: 'Wallet top-ups and in-game currency for every major platform.' },
  { slug: 'travel', name: 'Travel', icon: '✈️', accent: '#0EA5E9', sortOrder: 30, group: null,
    description: 'Flights, hotels and accommodation worldwide.' },
  { slug: 'entertainment', name: 'Entertainment', icon: '🎬', accent: '#EC4899', sortOrder: 40, group: null,
    description: 'Streaming subscriptions and media.' },
  { slug: 'food', name: 'Food & Dining', icon: '🍔', accent: '#EF4444', sortOrder: 50, group: null,
    description: 'Delivery platforms, coffee shops and restaurant chains.' },
  { slug: 'fashion', name: 'Clothing & Fashion', icon: '👕', accent: '#EC4899', sortOrder: 60, group: null,
    description: 'Apparel, footwear and accessories.' },
  { slug: 'electronics', name: 'Electronics', icon: '💻', accent: '#3B82F6', sortOrder: 70, group: null,
    description: 'Tech retailers, device stores and app marketplaces.' },
  { slug: 'payment-cards', name: 'Payment Cards', icon: '💳', accent: '#10B981', sortOrder: 80, group: null,
    description: 'Prepaid Visa/Mastercard, vouchers and multi-purpose debit cards.' },
  { slug: 'vpn', name: 'VPN & Online Security', icon: '🛡️', accent: '#6366F1', sortOrder: 90, group: null,
    description: 'Privacy and security subscriptions.' },

  // ── Other ──────────────────────────────────────────────────────────────
  { slug: 'sports', name: 'Sports', icon: '⚽', accent: '#22C55E', sortOrder: 110, group: 'other',
    description: 'Sporting goods, fan shops and club memberships.' },
  { slug: 'experiences', name: 'Experiences & Tickets', icon: '🎟️', accent: '#A855F7', sortOrder: 120, group: 'other',
    description: 'Event tickets, dining experiences and attractions.' },
  { slug: 'home', name: 'Home & Garden', icon: '🏠', accent: '#84CC16', sortOrder: 130, group: 'other',
    description: 'Furniture, DIY, bedding and household goods.' },
  { slug: 'music', name: 'Music', icon: '🎧', accent: '#14B8A6', sortOrder: 140, group: 'other',
    description: 'Physical music, instruments and audio hardware.' },
  { slug: 'cars', name: 'Automotive', icon: '🚗', accent: '#64748B', sortOrder: 150, group: 'other',
    description: 'Fuel, charging, servicing and vehicle accessories.' },
  { slug: 'software', name: 'Software & Tools', icon: '💾', accent: '#0EA5E9', sortOrder: 160, group: 'other',
    description: 'Operating systems, creative tools and productivity licences.' },
  { slug: 'top-up', name: 'Mobile Top-Up', icon: '📶', accent: '#14B8A6', sortOrder: 170, group: 'other',
    description: 'Prepaid mobile credit in 150+ countries.' },
  { slug: 'telecom', name: 'Mobile & Internet', icon: '📱', accent: '#6366F1', sortOrder: 180, group: 'other',
    description: 'Carrier plans, SIMs and broadband.' },
];

/** Shown as a section header above every category whose `group` matches. */
const CATEGORY_GROUPS: Record<string, string> = {
  other: 'Other',
};

interface SeedProduct {
  slug: string;
  name: string;
  shortName: string;
  brand: string;
  category: string;
  description: string;
  denoms: number[];
  stock: number;
  featured?: boolean;
  rating?: number;
  reviews?: number;
  tags?: string[];
  /** Where it can be sold. Omit for worldwide. */
  countries?: string[];
  regions?: string[];
  providerSku?: boolean;
}

/**
 * Product catalogue.
 *
 * Regional availability is set per product and is the single most important
 * correctness detail here: a US-only Amazon card cannot legally be redeemed on a
 * German account, so offering it there creates a refund and compliance problem.
 *
 * Rules used:
 *   - `countries` pins a card to specific markets (exact match wins).
 *   - `regions` pins it to a region, or to `GLOBAL` for worldwide.
 *   - Neither = worldwide.
 *
 * VERIFY EACH AGAINST YOUR ISSUER'S CURRENT TERMS before selling. Brand
 * availability changes, and Recharge's `country_codes` per product is the
 * authoritative source when you sync the live catalogue (`npm run db:seed`
 * replaces these with whatever the issuer reports).
 */
const PRODUCTS: SeedProduct[] = [
  // ══ STORE ══════════════════════════════════════════════════════════════
  {
    slug: 'amazon-us', name: 'Amazon.com Gift Card', shortName: 'Amazon US', brand: 'Amazon',
    category: 'store',
    description: 'Millions of products on Amazon.com, plus subscriptions and Prime. US Amazon accounts only.',
    denoms: [25, 50, 100, 200, 500], stock: 400, featured: true, rating: 4.8, reviews: 5211,
    tags: ['amazon', 'retail', 'marketplace', 'prime'], countries: ['US'],
  },
  {
    slug: 'amazon-gb', name: 'Amazon.co.uk Gift Card', shortName: 'Amazon UK', brand: 'Amazon',
    category: 'store',
    description: 'Spend on Amazon.co.uk. UK accounts only — this card does not work on other Amazon marketplaces.',
    denoms: [25, 50, 100], stock: 180, rating: 4.7, reviews: 1420,
    tags: ['amazon', 'retail'], countries: ['GB'],
  },
  {
    slug: 'amazon-de', name: 'Amazon.de Gift Card', shortName: 'Amazon DE', brand: 'Amazon',
    category: 'store',
    description: 'For Amazon.de. German Amazon accounts only.',
    denoms: [25, 50, 100], stock: 140, rating: 4.6, reviews: 610,
    tags: ['amazon', 'retail'], countries: ['DE'],
  },
  {
    slug: 'walmart', name: 'Walmart Gift Card', shortName: 'Walmart', brand: 'Walmart',
    category: 'store',
    description: 'Grocery, general merchandise and online orders at Walmart US.',
    denoms: [25, 50, 100], stock: 140, rating: 4.3, reviews: 254,
    tags: ['retail', 'grocery'], countries: ['US'],
  },
  {
    slug: 'target', name: 'Target Gift Card', shortName: 'Target', brand: 'Target',
    category: 'store',
    description: 'In-store and online at Target in the US. Can be used for gift purchases too.',
    denoms: [25, 50, 100, 250], stock: 120, rating: 4.4, reviews: 322,
    tags: ['retail', 'home'], countries: ['US'],
  },
  {
    slug: 'ebay', name: 'eBay Gift Card', shortName: 'eBay', brand: 'eBay',
    category: 'store',
    description: 'Buy and sell on eBay.com. US eBay accounts only.',
    denoms: [25, 50, 100, 250], stock: 130, rating: 4.2, reviews: 187,
    tags: ['marketplace', 'retail'], countries: ['US', 'GB', 'DE'],
  },
  {
    slug: 'etsy', name: 'Etsy Gift Card', shortName: 'Etsy', brand: 'Etsy',
    category: 'store',
    description: 'Handmade, vintage and craft supplies on Etsy.',
    denoms: [25, 50, 75, 100], stock: 90, rating: 4.1, reviews: 143,
    tags: ['marketplace', 'craft'], regions: ['NA', 'EU', 'GLOBAL'],
  },

  // ══ GAMING ═════════════════════════════════════════════════════════════
  {
    slug: 'steam-wallet', name: 'Steam Wallet Code', shortName: 'Steam', brand: 'Valve',
    category: 'gaming',
    description: 'Add funds to your Steam Wallet for games, DLC and items. Region-locked: the code must match your Steam account region.',
    denoms: [20, 50, 100, 200], stock: 320, featured: true, rating: 4.9, reviews: 4567,
    tags: ['gaming', 'pc', 'steam'], regions: ['GLOBAL'],
  },
  {
    slug: 'xbox', name: 'Xbox Gift Card', shortName: 'Xbox', brand: 'Microsoft',
    category: 'gaming',
    description: 'Games, Game Pass and in-game currency on Xbox One, Series X|S and PC.',
    denoms: [25, 50, 100, 200], stock: 300, featured: true, rating: 4.8, reviews: 2103,
    tags: ['gaming', 'xbox', 'game-pass'],
    countries: ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'NL', 'ES', 'IT', 'SE', 'PL', 'BR', 'MX', 'JP', 'SG', 'AE', 'ZA'],
  },
  {
    slug: 'playstation-store', name: 'PlayStation Store Gift Card', shortName: 'PlayStation', brand: 'Sony',
    category: 'gaming',
    description: 'Top up your PlayStation Store wallet for games, add-ons and in-game currency.',
    denoms: [25, 50, 100, 200], stock: 340, featured: true, rating: 4.9, reviews: 3420,
    tags: ['gaming', 'sony', 'ps5', 'ps4'],
    countries: ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'NL', 'ES', 'IT', 'JP', 'BR', 'MX', 'SG', 'AE', 'SE', 'PL'],
  },
  {
    slug: 'nintendo-eshop', name: 'Nintendo eShop Gift Card', shortName: 'Nintendo', brand: 'Nintendo',
    category: 'gaming',
    description: 'Games and DLC on Nintendo Switch. The card region must match your console region.',
    denoms: [25, 50, 100], stock: 200, rating: 4.7, reviews: 1288,
    tags: ['gaming', 'nintendo', 'switch'],
    countries: ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'PL', 'BR', 'MX', 'JP'],
  },
  {
    slug: 'roblox', name: 'Roblox Gift Card', shortName: 'Roblox', brand: 'Roblox',
    category: 'gaming',
    description: 'Robux for Roblox. Redeem at roblox.com/redeem — works on any account, any age.',
    denoms: [10, 25, 50, 100, 200, 400], stock: 450, featured: true, rating: 4.6, reviews: 1893,
    tags: ['gaming', 'roblox', 'kids'], regions: ['GLOBAL'],
  },
  {
    slug: 'discord-nitro', name: 'Discord Nitro Gift Card', shortName: 'Discord Nitro', brand: 'Discord',
    category: 'gaming',
    description: 'Nitro boosts, upload bandwidth, custom emoji and server subscriptions. Region must match your Discord account.',
    denoms: [10, 25, 50, 100], stock: 210, rating: 4.7, reviews: 934,
    tags: ['gaming', 'discord', 'social'], regions: ['GLOBAL'],
  },
  {
    slug: 'epic-games', name: 'Epic Games Gift Card', shortName: 'Epic Games', brand: 'Epic Games',
    category: 'gaming',
    description: 'Fortnite, Rocket League and games in the Epic Games Store.',
    denoms: [25, 50, 100], stock: 160, rating: 4.5, reviews: 612,
    tags: ['gaming', 'fortnite', 'epic'], regions: ['GLOBAL'],
  },
  {
    slug: 'riot-games', name: 'Riot Games Gift Card', shortName: 'Riot Games', brand: 'Riot Games',
    category: 'gaming',
    description: 'League of Legends, Valorant and Riot Points.',
    denoms: [25, 50, 100], stock: 150, rating: 4.6, reviews: 703,
    tags: ['gaming', 'league', 'valorant'], regions: ['GLOBAL'],
  },
  {
    slug: 'ubisoft-connect', name: 'Ubisoft Connect Gift Card', shortName: 'Ubisoft', brand: 'Ubisoft',
    category: 'gaming',
    description: 'Ubisoft games and Ubisoft Points. Region-locked to your Ubisoft account.',
    denoms: [20, 40, 60, 100], stock: 120, rating: 4.3, reviews: 288,
    tags: ['gaming', 'ubisoft'], regions: ['NA', 'EU', 'GLOBAL'],
  },
  {
    slug: 'battle-net', name: 'Blizzard Battle.net Gift Card', shortName: 'Battle.net', brand: 'Blizzard',
    category: 'gaming',
    description: 'Diablo, Overwatch, WoW and Call of Duty via Blizzard Battle.net.',
    denoms: [20, 50, 100], stock: 130, rating: 4.5, reviews: 476,
    tags: ['gaming', 'blizzard', 'blizzardizzard'], regions: ['NA', 'EU', 'GLOBAL'],
  },

  // ══ TRAVEL ═════════════════════════════════════════════════════════════
  {
    slug: 'airbnb', name: 'Airbnb Gift Card', shortName: 'Airbnb', brand: 'Airbnb',
    category: 'travel',
    description: 'For stays and experiences worldwide. Airbnb gift cards do not expire.',
    denoms: [50, 100, 200, 500], stock: 140, featured: true, rating: 4.6, reviews: 421,
    tags: ['travel', 'accommodation'], regions: ['GLOBAL'],
  },
  {
    slug: 'booking-com', name: 'Booking.com Gift Card', shortName: 'Booking.com', brand: 'Booking.com',
    category: 'travel',
    description: 'Hotels, flights and car rental on Booking.com. Valid for bookings worldwide.',
    denoms: [50, 100, 250, 500], stock: 120, rating: 4.6, reviews: 388,
    tags: ['travel', 'hotels'], regions: ['GLOBAL'],
  },
  {
    slug: 'hotels-com', name: 'Hotels.com Gift Card', shortName: 'Hotels.com', brand: 'Hotels.com',
    category: 'travel',
    description: 'Hotel and resort bookings through Hotels.com rewards.',
    denoms: [50, 100, 250], stock: 90, rating: 4.4, reviews: 213,
    tags: ['travel', 'hotels'], regions: ['NA', 'EU', 'GLOBAL'],
  },
  {
    slug: 'expedia', name: 'Expedia Gift Card', shortName: 'Expedia', brand: 'Expedia',
    category: 'travel',
    description: 'Flights, hotels, cars and packages booked on Expedia.',
    denoms: [50, 100, 250, 500], stock: 100, rating: 4.5, reviews: 267,
    tags: ['travel', 'flights', 'hotels'], regions: ['NA', 'GLOBAL'],
  },
  {
    slug: 'delta-airlines', name: 'Delta Air Lines Gift Card', shortName: 'Delta', brand: 'Delta Air Lines',
    category: 'travel',
    description: 'Flights, seat upgrades and travel-related purchases on delta.com. US residents only.',
    denoms: [100, 250, 500], stock: 70, rating: 4.3, reviews: 141,
    tags: ['travel', 'airlines', 'flights'], countries: ['US'],
  },
  {
    slug: 'uber', name: 'Uber Ride Gift Card', shortName: 'Uber', brand: 'Uber',
    category: 'travel',
    description: 'Credit for rides and Uber One subscriptions.',
    denoms: [25, 50, 100], stock: 150, rating: 4.4, reviews: 588,
    tags: ['travel', 'transport'], countries: ['US', 'CA'],
  },
  {
    slug: 'lyft', name: 'Lyft Gift Card', shortName: 'Lyft', brand: 'Lyft',
    category: 'travel',
    description: 'Ride credit and Lyft Pink subscriptions. US and Canada only.',
    denoms: [25, 50, 100], stock: 110, rating: 4.2, reviews: 176,
    tags: ['travel', 'transport'], countries: ['US', 'CA'],
  },

  // ══ ENTERTAINMENT ══════════════════════════════════════════════════════
  {
    slug: 'netflix', name: 'Netflix Gift Card', shortName: 'Netflix', brand: 'Netflix',
    category: 'entertainment',
    description: 'Stream films and series. Redeem at netflix.com/redeem or in the app. Your plan stays the same.',
    denoms: [15, 25, 50, 100, 200], stock: 500, featured: true, rating: 4.8, reviews: 2841,
    tags: ['streaming', 'movies', 'tv'],
    countries: ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'NL', 'ES', 'IT', 'JP', 'BR', 'MX', 'SG', 'AE', 'IN', 'SE', 'PL'],
  },
  {
    slug: 'spotify', name: 'Spotify Gift Card', shortName: 'Spotify', brand: 'Spotify',
    category: 'entertainment',
    description: 'Ad-free music, podcasts and audiobooks. Redeem at spotify.com/redeem.',
    denoms: [10, 25, 50, 100], stock: 420, featured: true, rating: 4.9, reviews: 1956,
    tags: ['music', 'audio', 'premium'],
    countries: ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'NL', 'ES', 'IT', 'SE', 'PL', 'BR', 'MX', 'SG', 'JP', 'IN', 'AE', 'ZA'],
  },
  {
    slug: 'disney-plus', name: 'Disney+ Gift Card', shortName: 'Disney+', brand: 'Disney',
    category: 'entertainment',
    description: 'Disney+, Hulu and ESPN+ content depending on your region.',
    denoms: [25, 50, 100], stock: 240, featured: true, rating: 4.7, reviews: 834,
    tags: ['streaming', 'movies', 'disney'],
    countries: ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'NL', 'ES', 'IT', 'SE'],
  },
  {
    slug: 'hulu', name: 'Hulu Gift Card', shortName: 'Hulu', brand: 'Disney',
    category: 'entertainment',
    description: 'Live TV and on-demand shows, plus the Hulu bundle. US subscribers only.',
    denoms: [25, 50, 100], stock: 150, rating: 4.4, reviews: 412,
    tags: ['streaming', 'tv'], countries: ['US'],
  },
  {
    slug: 'max-hbo', name: 'Max (HBO) Gift Card', shortName: 'Max', brand: 'Warner Bros. Discovery',
    category: 'entertainment',
    description: 'HBO, Warner Bros. and DC films and series. Available in the US and select regions.',
    denoms: [25, 50, 100], stock: 130, rating: 4.6, reviews: 502,
    tags: ['streaming', 'hbo'], countries: ['US'],
  },
  {
    slug: 'prime-video', name: 'Amazon Prime Video Gift Card', shortName: 'Prime Video', brand: 'Amazon',
    category: 'entertainment',
    description: 'Rent and buy films, or offset your Prime membership. Redeemed against your Amazon account.',
    denoms: [25, 50, 100], stock: 170, rating: 4.3, reviews: 298,
    tags: ['streaming', 'amazon'],
    countries: ['US', 'CA', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'JP', 'IN', 'AU', 'MX', 'BR', 'AE', 'SG', 'SE'],
  },
  {
    slug: 'youtube-premium', name: 'YouTube Premium Gift Card', shortName: 'YouTube Premium', brand: 'Google',
    category: 'entertainment',
    description: 'Ad-free YouTube, background play and YouTube Music. Price and features vary by country.',
    denoms: [25, 50, 100], stock: 200, rating: 4.6, reviews: 671,
    tags: ['streaming', 'youtube', 'music'], regions: ['GLOBAL'],
  },
  {
    slug: 'paramount-plus', name: 'Paramount+ Gift Card', shortName: 'Paramount+', brand: 'Paramount',
    category: 'entertainment',
    description: 'Paramount+, CBS and Showtime content in the US.',
    denoms: [25, 50], stock: 100, rating: 4.2, reviews: 187,
    tags: ['streaming', 'tv'], countries: ['US'],
  },

  // ══ FOOD & DINING ═══════════════════════════════════════════════════════
  {
    slug: 'uber-eats', name: 'Uber Eats Gift Card', shortName: 'Uber Eats', brand: 'Uber',
    category: 'food',
    description: 'Credit for food delivery. Redeem in the app under Payment.',
    denoms: [15, 25, 50, 100], stock: 190, rating: 4.5, reviews: 763,
    tags: ['food', 'delivery'],
    countries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'NL', 'ES', 'IT', 'JP', 'BR', 'MX'],
  },
  {
    slug: 'doordash', name: 'DoorDash Gift Card', shortName: 'DoorDash', brand: 'DoorDash',
    category: 'food',
    description: 'Apply credit to any DoorDash order. Redeem at doordash.com/giftcards.',
    denoms: [15, 25, 50, 100], stock: 165, rating: 4.4, reviews: 512,
    tags: ['food', 'delivery'], countries: ['US', 'CA', 'AU'],
  },
  {
    slug: 'starbucks', name: 'Starbucks Gift Card', shortName: 'Starbucks', brand: 'Starbucks',
    category: 'food',
    description: 'Stored-value card for in-store purchases, reloadable with mobile order.',
    denoms: [10, 25, 50, 100], stock: 220, rating: 4.5, reviews: 1032,
    tags: ['coffee', 'restaurant'], countries: ['US', 'CA', 'GB', 'MX', 'AU'],
  },
  {
    slug: 'deliveroo', name: 'Deliveroo Gift Card', shortName: 'Deliveroo', brand: 'Deliveroo',
    category: 'food',
    description: 'Food delivery credit in the UK, Ireland and selected European markets.',
    denoms: [20, 40, 60, 100], stock: 120, rating: 4.4, reviews: 298,
    tags: ['food', 'delivery'], countries: ['GB', 'IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'PL'],
  },
  {
    slug: 'pret-a-manger', name: 'Pret A Manger Gift Card', shortName: 'Pret', brand: 'Pret A Manger',
    category: 'food',
    description: 'Sandwiches, coffee and food in the UK and across Europe.',
    denoms: [20, 50, 100], stock: 90, rating: 4.3, reviews: 141,
    tags: ['coffee', 'restaurant'], countries: ['GB', 'IE', 'DE', 'FR', 'ES', 'NL', 'SE'],
  },
  {
    slug: 'chipotle', name: 'Chipotle Gift Card', shortName: 'Chipotle', brand: 'Chipotle',
    category: 'food',
    description: 'Burritos and bowls in Chipotle restaurants across the US, plus delivery.',
    denoms: [25, 50, 100], stock: 95, rating: 4.4, reviews: 322,
    tags: ['restaurant', 'fast-food'], countries: ['US'],
  },

  // ══ CLOTHING & FASHION ══════════════════════════════════════════════════
  {
    slug: 'nike', name: 'Nike Gift Card', shortName: 'Nike', brand: 'Nike',
    category: 'fashion',
    description: 'Footwear, apparel and equipment on Nike.com or in store.',
    denoms: [25, 50, 100, 250], stock: 180, rating: 4.7, reviews: 892,
    tags: ['clothing', 'footwear', 'sportswear'], regions: ['GLOBAL'],
  },
  {
    slug: 'adidas', name: 'adidas Gift Card', shortName: 'adidas', brand: 'adidas',
    category: 'fashion',
    description: 'adidas sportswear, originals and teamwear.',
    denoms: [25, 50, 100, 200], stock: 160, rating: 4.6, reviews: 611,
    tags: ['clothing', 'footwear', 'sportswear'], regions: ['GLOBAL'],
  },
  {
    slug: 'hm', name: 'H&M Gift Card', shortName: 'H&M', brand: 'H&M',
    category: 'fashion',
    description: 'Affordable clothing, home and beauty at H&M stores and online.',
    denoms: [25, 50, 100], stock: 130, rating: 4.4, reviews: 386,
    tags: ['clothing', 'fast-fashion'], countries: ['GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'PL', 'US', 'CA', 'IN', 'MX', 'BR'],
  },
  {
    slug: 'zara', name: 'Zara Gift Card', shortName: 'Zara', brand: 'Zara',
    category: 'fashion',
    description: 'Contemporary clothing, footwear and accessories from Zara.',
    denoms: [25, 50, 100, 200], stock: 120, rating: 4.5, reviews: 402,
    tags: ['clothing', 'fast-fashion'], regions: ['EU', 'NA', 'GLOBAL'],
  },
  {
    slug: 'shein', name: 'SHEIN Gift Card', shortName: 'SHEIN', brand: 'SHEIN',
    category: 'fashion',
    description: 'Online fashion, accessories and homeware at SHEIN prices.',
    denoms: [20, 50, 100, 200], stock: 140, rating: 4.2, reviews: 723,
    tags: ['clothing', 'fast-fashion'], regions: ['GLOBAL'],
  },

  // ══ ELECTRONICS ════════════════════════════════════════════════════════
  {
    slug: 'apple', name: 'Apple Gift Card', shortName: 'Apple', brand: 'Apple',
    category: 'electronics',
    description: 'Apps, subscriptions, iCloud+ and accessories from the Apple Store.',
    denoms: [10, 25, 50, 100, 200], stock: 260, featured: true, rating: 4.8, reviews: 3104,
    tags: ['tech', 'apps', 'icloud'], countries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'NL', 'ES', 'IT', 'JP', 'IE', 'SE', 'NZ', 'SG', 'AE'],
  },
  {
    slug: 'best-buy', name: 'Best Buy Gift Card', shortName: 'Best Buy', brand: 'Best Buy',
    category: 'electronics',
    description: 'Consumer electronics, appliances and gaming hardware. US only.',
    denoms: [25, 50, 100, 250, 500], stock: 110, rating: 4.4, reviews: 289,
    tags: ['tech', 'retail'], countries: ['US'],
  },
  {
    slug: 'samsung', name: 'Samsung Gift Card', shortName: 'Samsung', brand: 'Samsung',
    category: 'electronics',
    description: 'Galaxy devices, watches, TVs and accessories on samsung.com.',
    denoms: [25, 50, 100, 250], stock: 100, rating: 4.3, reviews: 174,
    tags: ['tech', 'mobile'], countries: ['US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'AU', 'BR', 'IN', 'SE'],
  },
  {
    slug: 'google-play', name: 'Google Play Gift Card', shortName: 'Google Play', brand: 'Google',
    category: 'electronics',
    description: 'Apps, games, movies and in-app purchases on Google Play.',
    denoms: [10, 25, 50, 100], stock: 230, rating: 4.5, reviews: 1408,
    tags: ['tech', 'apps', 'android'], regions: ['GLOBAL'],
  },
  {
    slug: 'barnes-noble', name: 'Barnes & Noble Gift Card', shortName: 'Barnes & Noble', brand: 'Barnes & Noble',
    category: 'electronics',
    description: 'Books, eBooks, magazines and more at Barnes & Noble.',
    denoms: [25, 50, 100], stock: 80, rating: 4.3, reviews: 132,
    tags: ['books', 'education'], countries: ['US'],
  },

  // ══ PAYMENT CARDS ═══════════════════════════════════════════════════════
  {
    slug: 'rewarble-visa', name: 'Rewarble Visa Prepaid Card', shortName: 'Rewarble Visa', brand: 'Rewarble',
    category: 'payment-cards',
    description: 'A spend-anywhere Visa card funded by crypto. Issue a physical or virtual card and top it up on-chain.',
    denoms: [25, 50, 100, 250, 500], stock: 300, featured: true, rating: 4.4, reviews: 214,
    tags: ['visa', 'prepaid', 'debit', 'crypto'], regions: ['EEA', 'GB'],
  },
  {
    slug: 'rewarble-mastercard', name: 'Rewarble Mastercard Prepaid Card', shortName: 'Rewarble Mastercard', brand: 'Rewarble',
    category: 'payment-cards',
    description: 'A Mastercard debit card you fund with crypto. Works online and in-store wherever Mastercard is accepted.',
    denoms: [25, 50, 100, 250, 500], stock: 280, featured: true, rating: 4.4, reviews: 198,
    tags: ['mastercard', 'prepaid', 'debit', 'crypto'], regions: ['EEA', 'GB'],
  },
  {
    slug: 'paysafecard', name: 'Paysafecard Gift Card', shortName: 'Paysafecard', brand: 'Paysafecard',
    category: 'payment-cards',
    description: 'A prepaid payment code accepted at thousands of online shops across Europe.',
    denoms: [10, 25, 50, 100], stock: 250, rating: 4.5, reviews: 341,
    tags: ['prepaid', 'voucher', 'europe'], countries: ['DE', 'AT', 'ES', 'FR', 'IT', 'NL', 'PL', 'GB'],
  },
  {
    slug: 'coingate-voucher', name: 'CoinGate Voucher', shortName: 'CoinGate Voucher', brand: 'CoinGate',
    category: 'payment-cards',
    description: 'Spend crypto balance at any Visa merchant. The voucher converts to a fiat card balance — useful where crypto itself is not accepted.',
    denoms: [25, 50, 100, 250], stock: 240, featured: true, rating: 4.6, reviews: 276,
    tags: ['crypto', 'voucher', 'visa'], regions: ['GLOBAL'],
  },

  // ══ VPN & ONLINE SECURITY ═════════════════════════════════════════════════
  {
    slug: 'nordvpn', name: 'NordVPN Gift Card', shortName: 'NordVPN', brand: 'NordVPN',
    category: 'vpn',
    description: 'Mesh VPN with 5,800+ servers, no-logs policy and malware blocking.',
    denoms: [25, 50, 100, 200], stock: 200, rating: 4.7, reviews: 512,
    tags: ['vpn', 'privacy', 'security'], regions: ['GLOBAL'],
  },
  {
    slug: 'surfshark', name: 'Surfshark Gift Card', shortName: 'Surfshark', brand: 'Surfshark',
    category: 'vpn',
    description: 'Unlimited-device VPN with CleanWeb ad blocking and a no-logs audit.',
    denoms: [25, 50, 100, 200], stock: 190, rating: 4.6, reviews: 388,
    tags: ['vpn', 'privacy', 'security'], regions: ['GLOBAL'],
  },
  {
    slug: 'internxt', name: 'Internxt Gift Card', shortName: 'Internxt', brand: 'Internxt',
    category: 'vpn',
    description: 'Encrypted cloud storage, VPN and antivirus, priced in crypto-friendly plans.',
    denoms: [25, 50, 100], stock: 150, rating: 4.4, reviews: 167,
    tags: ['vpn', 'storage', 'privacy', 'crypto'], regions: ['GLOBAL'],
  },

  // ══ OTHER: SPORTS ═══════════════════════════════════════════════════════
  {
    slug: 'nike-com', name: 'Nike.com Gift Card', shortName: 'Nike.com', brand: 'Nike',
    category: 'sports',
    description: 'Online-only Nike credit for the latest drops and member exclusives.',
    denoms: [25, 50, 100], stock: 120, rating: 4.6, reviews: 289,
    tags: ['sportswear', 'online'], countries: ['US', 'CA', 'GB', 'DE', 'FR'],
  },
  {
    slug: 'decathlon', name: 'Decathlon Gift Card', shortName: 'Decathlon', brand: 'Decathlon',
    category: 'sports',
    description: 'Sporting equipment, clothing and fitness gear across all Decathlon stores.',
    denoms: [25, 50, 100, 200], stock: 100, rating: 4.5, reviews: 194,
    tags: ['sports', 'fitness'], countries: ['GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'PL', 'SE', 'BR', 'MX'],
  },
  {
    slug: 'fanatics', name: 'Fanatics Gift Card', shortName: 'Fanatics', brand: 'Fanatics',
    category: 'sports',
    description: 'Official team jerseys and fan merchandise for major US leagues.',
    denoms: [25, 50, 100], stock: 85, rating: 4.4, reviews: 143,
    tags: ['sports', 'fan-shop'], countries: ['US'],
  },

  // ══ OTHER: EXPERIENCES & TICKETS ═══════════════════════════════════════
  {
    slug: 'ticketmaster', name: 'Ticketmaster Gift Card', shortName: 'Ticketmaster', brand: 'Ticketmaster',
    category: 'experiences',
    description: 'Concert, sports and theatre tickets through Ticketmaster.',
    denoms: [50, 100, 250], stock: 90, rating: 4.3, reviews: 176,
    tags: ['tickets', 'events'], countries: ['US', 'CA', 'GB', 'AU', 'DE', 'NL'],
  },
  {
    slug: 'eventbrite', name: 'Eventbrite Gift Card', shortName: 'Eventbrite', brand: 'Eventbrite',
    category: 'experiences',
    description: 'Tickets to concerts, festivals, workshops and local events.',
    denoms: [25, 50, 100], stock: 85, rating: 4.2, reviews: 132,
    tags: ['tickets', 'events'], regions: ['NA', 'EU', 'GLOBAL'],
  },
  {
    slug: 'viator', name: 'Viator Gift Card', shortName: 'Viator', brand: 'Viator',
    category: 'experiences',
    description: 'Tours, activities and attraction passes booked through Viator.',
    denoms: [50, 100, 250], stock: 80, rating: 4.5, reviews: 121,
    tags: ['travel', 'tours', 'activities'], regions: ['GLOBAL'],
  },

  // ══ OTHER: HOME & GARDEN ════════════════════════════════════════════════
  {
    slug: 'ikea', name: 'IKEA Gift Card', shortName: 'IKEA', brand: 'IKEA',
    category: 'home',
    description: 'Furniture, homewares and DIY across all IKEA stores and online.',
    denoms: [25, 50, 100, 250], stock: 130, rating: 4.6, reviews: 407,
    tags: ['home', 'furniture'], countries: ['GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'PL', 'US', 'CA', 'AU'],
  },
  {
    slug: 'b&q', name: 'B&Q Gift Card', shortName: 'B&Q', brand: 'B&Q',
    category: 'home',
    description: 'DIY, tools, paint and garden products across B&Q stores in the UK.',
    denoms: [25, 50, 100], stock: 90, rating: 4.3, reviews: 156,
    tags: ['home', 'diy'], countries: ['GB'],
  },
  {
    slug: 'wayfair', name: 'Wayfair Gift Card', shortName: 'Wayfair', brand: 'Wayfair',
    category: 'home',
    description: 'Furniture, bedding and home decor online.',
    denoms: [50, 100, 250], stock: 95, rating: 4.3, reviews: 187,
    tags: ['home', 'furniture'], countries: ['US', 'CA', 'GB'],
  },

  // ══ OTHER: MUSIC ═══════════════════════════════════════════════════════
  {
    slug: 'barnes-music', name: 'Barnes & Noble Music Gift Card', shortName: 'Music & Books', brand: 'Barnes & Noble',
    category: 'music',
    description: 'CDs, vinyl, instruments and sheet music, plus books, in store and online.',
    denoms: [25, 50, 100], stock: 70, rating: 4.2, reviews: 98,
    tags: ['music', 'books', 'vinyl'], countries: ['US'],
  },
  {
    slug: 'thomann', name: 'Thomann Gift Card', shortName: 'Thomann', brand: 'Thomann',
    category: 'music',
    description: 'Instruments, amplifiers, DJ and recording equipment across Europe.',
    denoms: [50, 100, 250, 500], stock: 70, rating: 4.6, reviews: 143,
    tags: ['music', 'instruments'], countries: ['DE', 'GB', 'FR', 'NL', 'IT', 'ES', 'SE', 'PL'],
  },

  // ══ OTHER: AUTOMOTIVE ═══════════════════════════════════════════════════
  {
    slug: 'shell-vplus', name: 'Shell V-Power Gift Card', shortName: 'Shell V-Power', brand: 'Shell',
    category: 'cars',
    description: 'Fuel and car-care products at Shell forecourts.',
    denoms: [25, 50, 100], stock: 90, rating: 4.3, reviews: 121,
    tags: ['fuel', 'cars'], countries: ['US', 'GB', 'DE', 'FR', 'NL', 'ES', 'IT', 'SE', 'PL', 'BR', 'MX'],
  },
  {
    slug: 'autozone', name: 'AutoZone Gift Card', shortName: 'AutoZone', brand: 'AutoZone',
    category: 'cars',
    description: 'Parts, tools and accessories in AutoZone stores across the US.',
    denoms: [25, 50, 100], stock: 80, rating: 4.4, reviews: 134,
    tags: ['cars', 'parts'], countries: ['US'],
  },
  {
    slug: 'tesla-charging', name: 'Tesla Charging Credit', shortName: 'Tesla Charging', brand: 'Tesla',
    category: 'cars',
    description: 'Supercharger and destination charger credit for Tesla vehicles.',
    denoms: [25, 50, 100, 200], stock: 70, rating: 4.5, reviews: 98,
    tags: ['ev', 'charging', 'tesla'], countries: ['US', 'CA', 'GB', 'DE', 'NL', 'NO'],
  },

  // ══ OTHER: SOFTWARE & TOOLS ═════════════════════════════════════════════
  {
    slug: 'adobe', name: 'Adobe Creative Cloud Gift Card', shortName: 'Adobe CC', brand: 'Adobe',
    category: 'software',
    description: 'Photoshop, Illustrator, Premiere and the full Creative Cloud suite.',
    denoms: [50, 100, 250], stock: 90, rating: 4.4, reviews: 187,
    tags: ['software', 'design', 'creative'], regions: ['NA', 'EU', 'GLOBAL'],
  },
  {
    slug: 'microsoft-365', name: 'Microsoft 365 Gift Card', shortName: 'Microsoft 365', brand: 'Microsoft',
    category: 'software',
    description: 'Word, Excel, PowerPoint, OneDrive and 1 TB of cloud storage.',
    denoms: [50, 100, 250], stock: 110, rating: 4.5, reviews: 243,
    tags: ['software', 'productivity'], countries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'NL', 'ES', 'IT', 'SE', 'PL', 'JP', 'IN'],
  },
  {
    slug: 'jetbrains', name: 'JetBrains Gift Card', shortName: 'JetBrains', brand: 'JetBrains',
    category: 'software',
    description: 'Developer IDEs including IntelliJ IDEA, WebStorm and PyCharm.',
    denoms: [50, 100, 250, 500], stock: 70, rating: 4.8, reviews: 264,
    tags: ['software', 'developer', 'ide'], regions: ['GLOBAL'],
  },
  {
    slug: 'notion', name: 'Notion Gift Card', shortName: 'Notion', brand: 'Notion',
    category: 'software',
    description: 'Notion Plus: unlimited blocks, file uploads and collaborators.',
    denoms: [50, 100], stock: 65, rating: 4.6, reviews: 131,
    tags: ['software', 'productivity', 'notes'], regions: ['GLOBAL'],
  },

  // ══ OTHER: MOBILE TOP-UP ════════════════════════════════════════════════
  {
    slug: 'airtime-us', name: 'US Mobile Top-Up', shortName: 'US Top-Up', brand: 'Airtime',
    category: 'top-up',
    description: 'Prepaid mobile credit for carriers in the United States. Applied automatically to the number you give us.',
    denoms: [10, 20, 30, 50, 100], stock: 520, featured: true, rating: 4.6, reviews: 1877,
    tags: ['mobile', 'airtime', 'top-up'], countries: ['US'],
  },
  {
    slug: 'airtime-gb', name: 'UK Mobile Top-Up', shortName: 'UK Top-Up', brand: 'Airtime',
    category: 'top-up',
    description: 'Prepaid credit for EE, O2, Vodafone and Three handsets in the United Kingdom.',
    denoms: [10, 20, 30, 50], stock: 320, rating: 4.5, reviews: 934,
    tags: ['mobile', 'airtime', 'top-up'], countries: ['GB'],
  },
  {
    slug: 'airtime-in', name: 'India Mobile Top-Up', shortName: 'India Top-Up', brand: 'Airtime',
    category: 'top-up',
    description: 'Prepaid mobile credit for Jio, Airtel, Vi and BSNL handsets in India.',
    denoms: [5, 10, 20, 50], stock: 340, rating: 4.7, reviews: 1240,
    tags: ['mobile', 'airtime', 'top-up'], countries: ['IN'],
  },
  {
    slug: 'airtime-global', name: 'International Mobile Top-Up', shortName: 'Global Top-Up', brand: 'Airtime',
    category: 'top-up',
    description: 'Top up a prepaid handset in 150+ countries across 400+ carriers.',
    denoms: [10, 20, 50], stock: 470, rating: 4.4, reviews: 2088,
    tags: ['mobile', 'airtime', 'top-up', 'international'], regions: ['GLOBAL'],
  },

  // ══ OTHER: MOBILE & INTERNET ════════════════════════════════════════════
  {
    slug: 'mint-mobile', name: 'Mint Mobile Gift Card', shortName: 'Mint Mobile', brand: 'Mint Mobile',
    category: 'telecom',
    description: 'Prepaid plan credit for Mint Mobile in the US.',
    denoms: [25, 50, 100], stock: 100, rating: 4.3, reviews: 176,
    tags: ['mobile', 'carrier'], countries: ['US'],
  },
  {
    slug: 'ee-vodafone', name: 'EE / Vodafone Gift Card', shortName: 'EE · Vodafone', brand: 'Vodafone',
    category: 'telecom',
    description: 'UK mobile airtime and data bundles for EE and Vodafone.',
    denoms: [10, 20, 30, 50], stock: 200, rating: 4.2, reviews: 289,
    tags: ['mobile', 'carrier', 'uk'], countries: ['GB'],
  },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seedCountries() {
  console.log('→ Seeding countries…');
  for (const c of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: c.code },
      create: { ...c, isActive: true, sortOrder: 10 },
      update: { name: c.name, currency: c.currency, dialCode: c.dialCode, flagEmoji: c.flagEmoji },
    });
  }

  console.log('→ Seeding regions…');
  for (const r of REGIONS) {
    await prisma.region.upsert({
      where: { code: r.code },
      create: { ...r, isActive: true, sortOrder: 10 },
      update: { name: r.name, countries: r.countries },
    });
  }
}

async function seedCatalog(_baseMarkupBps = 0) {
  console.log('→ Seeding categories…');
  const categoryBySlug = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { scopeKey: scopeKey(GLOBAL, c.slug) },
      create: {
        scope: ProductScope.GLOBAL,
        scopeKey: scopeKey(GLOBAL, c.slug),
        slug: c.slug,
        name: c.name,
        description: c.description,
        icon: c.icon,
        accent: c.accent,
        group: c.group,
        sortOrder: c.sortOrder,
        isActive: true,
      },
      update: { name: c.name, description: c.description, icon: c.icon, accent: c.accent, group: c.group, sortOrder: c.sortOrder },
    });
    categoryBySlug.set(c.slug, row.id);
  }

  // Retire GLOBAL categories that are no longer part of the taxonomy, so a
  // re-seed does not leave orphan tabs behind (e.g. the old `streaming` split).
  const keep = new Set(CATEGORIES.map((c) => scopeKey(GLOBAL, c.slug)));
  const stale = await prisma.category.findMany({
    where: { scope: ProductScope.GLOBAL, scopeKey: { notIn: [...keep] } },
    select: { id: true, slug: true, _count: { select: { products: true } } },
  });
  for (const s of stale) {
    if (s._count.products > 0) {
      // Referenced by the catalogue: deactivate instead of deleting so orders
      // and order items keep their historical reference.
      await prisma.category.update({ where: { id: s.id }, data: { isActive: false } });
      console.log(`   · retired category "${s.slug}" (has ${s._count.products} products)`);
    } else {
      await prisma.category.delete({ where: { id: s.id } });
      console.log(`   · removed unused category "${s.slug}"`);
    }
  }

  console.log('→ Seeding brands…');
  const brandBySlug = new Map<string, string>();
  for (const b of [...new Set(PRODUCTS.map((p) => p.brand))]) {
    const slug = b.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const row = await prisma.brand.upsert({
      where: { scopeKey: scopeKey(GLOBAL, slug) },
      create: { scope: ProductScope.GLOBAL, scopeKey: scopeKey(GLOBAL, slug), slug, name: b, sortOrder: 10 },
      update: { name: b },
    });
    brandBySlug.set(b, row.id);
  }

  console.log(`→ Seeding ${PRODUCTS.length} products…`);
  for (const p of PRODUCTS) {
    const categoryId = categoryBySlug.get(p.category);
    if (!categoryId) throw new Error(`Unknown category ${p.category} for product ${p.slug}`);

    const product = await prisma.product.upsert({
      where: { scopeKey: scopeKey(GLOBAL, p.slug) },
      create: {
        scope: ProductScope.GLOBAL,
        scopeKey: scopeKey(GLOBAL, p.slug),
        slug: p.slug,
        name: p.name,
        shortName: p.shortName,
        description: p.description,
        logoUrl: logoUrlFor(p.slug),
        accent: '#FFFFFF',
        categoryId,
        brandId: brandBySlug.get(p.brand) ?? null,
        provider: 'mock',
        totalStock: p.stock,
        reservedStock: 0,
        lowStockThreshold: 5,
        trackStock: true,
        defaultCurrency: 'USD',
        isActive: true,
        isFeatured: Boolean(p.featured),
        tags: p.tags ?? [],
        rating: p.rating ?? null,
        reviewCount: p.reviews ?? 0,
        sortOrder: 10,
      },
      update: {
        name: p.name,
        shortName: p.shortName,
        description: p.description,
        logoUrl: logoUrlFor(p.slug),
        categoryId,
        brandId: brandBySlug.get(p.brand) ?? null,
        isFeatured: Boolean(p.featured),
        tags: p.tags ?? [],
        rating: p.rating ?? null,
        reviewCount: p.reviews ?? 0,
      },
    });

    // Denominations.
    //
    // `priceUsd` is the BASE price, before any tenant markup. The catalog layer
    // applies `Tenant.markupBps` (plus per-tenant overrides) at read time, so
    // baking a markup in here would apply it twice.
    for (const face of p.denoms) {
      const base = face;
      await prisma.denomination.upsert({
        where: { productId_faceValue_currency: { productId: product.id, faceValue: face.toFixed(2), currency: 'USD' } },
        create: {
          productId: product.id,
          faceValue: face.toFixed(2),
          currency: 'USD',
          priceUsd: base.toFixed(2),
          providerSku: `${p.slug}-${face}`,
          isActive: true,
          sortOrder: 10,
        },
        update: { priceUsd: base.toFixed(2), providerSku: `${p.slug}-${face}` },
      });
    }

    // Geo availability. Empty rule set == worldwide.
    await prisma.regionAvailability.deleteMany({ where: { productId: product.id } });
    const rules: { regionCode: string; countryCode: string | null }[] = [];
    if (p.countries?.length) {
      for (const cc of p.countries) rules.push({ regionCode: cc, countryCode: cc });
    }
    if (p.regions?.length) {
      for (const rc of p.regions) rules.push({ regionCode: rc, countryCode: null });
    }
    if (rules.length) {
      await prisma.regionAvailability.createMany({ data: rules.map((r) => ({ ...r, productId: product.id })) });
    }
  }
}

async function seedTenants() {
  console.log('→ Seeding tenants…');

  // Hoisted so `create` and `update` share one object — a re-seed has to be able
  // to re-skin the house storefront, not just create it once.
  const houseBrand = {
    name: 'Sol Bazaar',
    logoText: 'Sol Bazaar',
    // Built by `npm run brand:assets`. Trimmed to the artwork with real alpha,
    // so it sits correctly on the near-black chrome.
    logoUrl: '/brand/logo-112.png',
    faviconUrl: '/brand/favicon-48.png',
    tagline: 'Gift cards, paid with crypto.',
    supportEmail: 'support@solbazaar.com',
    // Colourless by design: a gift-card grid is already full of third-party
    // brand colours, so the chrome stays neutral and white is the only accent.
    accent: '#FFFFFF',
    accent2: '#F5F2EC',
    heroHeadline: 'Live on Crypto, Go Bankless',
    heroSubhead:
      'Instant digital delivery. Pay with SOL or USDC on Solana — settled on-chain in seconds, no bank account required.',
  };
  const houseTheme = { mode: 'dark', radius: 0, glow: false };

  const house = await prisma.tenant.upsert({
    where: { slug: 'sol-bazaar' },
    create: {
      slug: 'sol-bazaar',
      name: 'Sol Bazaar',
      legalName: 'Sol Bazaar Ltd',
      supportEmail: 'support@solbazaar.com',
      status: TenantStatus.ACTIVE,
      baseDomain: process.env.BASE_DOMAIN ?? 'localhost:3000',
      defaultCountry: 'US',
      markupBps: 500,
      minOrderUsd: '5.00',
      maxOrderUsd: '2000.00',
      orderTtlMinutes: 30,
      acceptedTokens: ['SOL', 'USDC'],
      brand: houseBrand,
      theme: houseTheme,
      features: { showCryptoPicker: true },
    },
    update: { status: TenantStatus.ACTIVE, brand: houseBrand, theme: houseTheme },
  });

  // A second tenant proves subdomain white-labelling works out of the box.
  const partner = await prisma.tenant.upsert({
    where: { slug: 'cryptocards' },
    create: {
      slug: 'cryptocards',
      name: 'CryptoCards',
      legalName: 'CryptoCards Trading Ltd',
      supportEmail: 'help@cryptocards.io',
      status: TenantStatus.ACTIVE,
      baseDomain: process.env.BASE_DOMAIN ?? 'localhost:3000',
      defaultCountry: 'GB',
      markupBps: 900,
      minOrderUsd: '10.00',
      maxOrderUsd: '1000.00',
      orderTtlMinutes: 45,
      acceptedTokens: ['SOL'],
      brand: {
        name: 'CryptoCards',
        logoText: 'CryptoCards',
        tagline: 'Instant gift cards. Crypto only.',
        supportEmail: 'help@cryptocards.io',
        accent: '#F59E0B',
        accent2: '#EF4444',
        heroHeadline: 'Gift cards for the crypto economy',
        heroSubhead:
          'A fully independent storefront with its own branding, pricing and margins — powered by the Sol Bazaar platform.',
        announcement: 'UK customers: 9% markup, no card processing fees.',
      },
      theme: { mode: 'dark', radius: 22, glow: true },
      features: {},
    },
    update: { status: TenantStatus.ACTIVE },
  });

  // Localhost aliases so `localhost:3000` can serve either tenant via ?tenant=.
  for (const [t, host] of [
    [house, 'sol-bazaar.localhost:3000'],
    [partner, 'cryptocards.localhost:3000'],
  ] as const) {
    await prisma.domain.upsert({
      where: { hostname: host },
      create: { tenantId: t.id, hostname: host, isPrimary: false, verifiedAt: new Date() },
      update: { tenantId: t.id },
    });
  }

  console.log('→ Seeding demo API keys…');
  for (const [tenant, name] of [
    [house, 'House demo key'],
    [partner, 'Partner demo key'],
  ] as const) {
    const existing = await prisma.apiKey.findFirst({ where: { tenantId: tenant.id, name } });
    if (!existing) {
      const prefix = `fc_live_${randomBytes(4).toString('hex')}`;
      const secret = randomBytes(32).toString('base64url');
      await prisma.apiKey.create({
        data: {
          tenantId: tenant.id,
          name,
          prefix,
          secretHash: scryptSync(`${prefix}:${secret}`, 'solbazaar:apikeys:v1', 32, { N: 16_384, r: 8, p: 1 }).toString('base64'),
          scopes: ['catalog:read', 'orders:read', 'orders:write', 'fulfillment:read'],
          rateLimitPerMin: 240,
        },
      });
    }
  }

  return { house, partner };
}

async function seedAdmin() {
  console.log('→ Seeding admin user…');
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = scryptSync(`admin:${password}`, 'solbazaar:admin:v1', 32, { N: 16_384, r: 8, p: 1 }).toString('base64');
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@solbazaar.com';

  await prisma.adminUser.upsert({
    where: { email },
    create: { email, passwordHash, role: AdminRole.SUPERADMIN },
    update: { passwordHash, role: AdminRole.SUPERADMIN },
  });
  console.log(`   admin login: ${email} / ${password}`);
}

async function seedPrices() {
  console.log('→ Seeding token prices…');
  const sol = Number(process.env.SEED_SOL_PRICE ?? 150);
  await prisma.tokenPrice.upsert({
    where: { symbol: TokenSymbol.SOL },
    create: { symbol: TokenSymbol.SOL, usd: String(sol), source: 'seed' },
    update: {},
  });
  await prisma.tokenPrice.upsert({
    where: { symbol: TokenSymbol.USDC },
    create: { symbol: TokenSymbol.USDC, usd: '1', source: 'seed' },
    update: {},
  });
}

/**
 * Bootstrap the operator wallet.
 *
 * If `WALLET_SEED` is empty, generate one and write the encrypted envelope back
 * into `.env` so a fresh clone is immediately runnable. In production this
 * should never happen — you would rather fail loudly than have a key appear in
 * a file on disk.
 */
async function seedWallet() {
  console.log('→ Checking operator wallet…');
  if (process.env.WALLET_SEED) {
    try {
      const wallet = SolanaHdWallet.fromEnv();
      console.log(`   ✓ using configured wallet (slot 0: ${wallet.address0})`);
    } catch (e) {
      console.warn(`   ! WALLET_SEED present but invalid: ${(e as Error).message}`);
    }
    return;
  }

  const master = process.env.WALLET_MASTER_KEY;
  if (!master) {
    console.log('   ⚠ WALLET_SEED and WALLET_MASTER_KEY are both unset.');
    console.log('     Run `npm run wallet:new` to create an operator wallet, then set both vars.');
    return;
  }

  const mnemonic = generateMnemonic(256);
  const encrypted = encryptSeed(mnemonic, master);
  const wallet = new SolanaHdWallet({ seed: mnemonic });

  console.log('   ⚠ Generated a NEW operator wallet.');
  console.log('     Slot 0 address:', wallet.address0);
  console.log('     Add this to .env:\n');
  console.log(`     WALLET_SEED="${encrypted}"`);
  console.log('\n     Store the plaintext mnemonic offline NOW. It is only shown once.');
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n🌱 Seeding Sol Bazaar\n');
  const started = Date.now();

  await seedCountries();

  // Denomination base prices are stored at face value; each tenant's markup is
// applied when the catalogue is read (see toCatalogProduct).
await seedCatalog();

  await seedTenants();
  await seedAdmin();
  await seedPrices();
  await seedWallet();

  const [products, tenants, categories] = await Promise.all([
    prisma.product.count(),
    prisma.tenant.count(),
    prisma.category.count(),
  ]);

  console.log(`\n✅ Seed complete in ${Date.now() - started}ms`);
  console.log(`   ${categories} categories · ${products} products · ${tenants} tenants`);
  console.log('\n   Storefront:  http://localhost:3000');
  console.log('   Partner:    http://localhost:3000?tenant=cryptocards');
  console.log('   REST API:   http://localhost:3000/api/v1/catalog\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Brand marks from Simple Icons (MIT-licensed SVGs) via their public CDN.
 *
 * Simple Icons has deliberately removed many large brands at trademark-holder
 * request — Amazon, Disney+, Hulu, Xbox and Nintendo are among the gaps. Every
 * slug below was verified to resolve; anything unlisted falls back to a branded
 * monogram tile rendered client-side, so the grid never shows a broken image.
 *
 * When you sync a live catalogue from your issuer (`SYNC_INVENTORY`), the
 * issuer's own `images.svg/png` wins — these are only seed-time defaults.
 */
const SIMPLE_ICON_SLUGS: Record<string, string> = {
  netflix: 'netflix',
  spotify: 'spotify',
  paramount: 'paramountplus',
  'max-hbo': 'max',
  target: 'target',
  ebay: 'ebay',
  etsy: 'etsy',
  steam: 'steam',
  playstation: 'playstation',
  roblox: 'roblox',
  discord: 'discord',
  epicgames: 'epicgames',
  riotgames: 'riotgames',
  ubisoft: 'ubisoft',
  airbnb: 'airbnb',
  expedia: 'expedia',
  delta: 'delta',
  uber: 'uber',
  lyft: 'lyft',
  starbucks: 'starbucks',
  doordash: 'doordash',
  deliveroo: 'deliveroo',
  nike: 'nike',
  adidas: 'adidas',
  zara: 'zara',
  'hm': 'handm',
  apple: 'apple',
  samsung: 'samsung',
  'google-play': 'googleplay',
  nordvpn: 'nordvpn',
  surfshark: 'surfshark',
  ticketmaster: 'ticketmaster',
  ikea: 'ikea',
  shell: 'shell',
  autozone: 'autozone',
  tesla: 'tesla',
  jetbrains: 'jetbrains',
  notion: 'notion',
  airtel: 'airtel',
};

/**
 * Resolve a logo URL for a product.
 *
 * Returns `null` when we have no verified mark, which makes the client render a
 * brand-coloured monogram tile instead of an <img> that might 404.
 */
function logoUrlFor(slug: string): string | null {
  const direct = SIMPLE_ICON_SLUGS[slug];
  const icon = direct ?? SIMPLE_ICON_SLUGS[slug.split('-')[0]];
  if (!icon) return null;
  return `https://cdn.simpleicons.org/${icon}/ffffff`;
}