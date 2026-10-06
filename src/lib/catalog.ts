export interface Product {
  id: string;
  slug: string;
  name: string;
  shortName?: string | null;
  description?: string;
  logoUrl?: string | null;
  brand?: { id: string; name: string; logoUrl?: string } | null;
  category: { id: string; name: string; slug: string };
  priceFromUsd: number;
  displayPriceFrom?: string | null;
  displayCurrency?: string | null;
  displayRate?: string | null;
  denominations: { faceValue: number; currency: string }[];
  inStock: boolean;
  rating?: number | null;
  productCount?: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  productCount: number;
}

const MOCK_PRODUCTS: Product[] = [
  {
    id: '1',
    slug: 'netflix',
    name: 'Netflix',
    shortName: 'Netflix',
    description: 'Stream movies and TV shows',
    logoUrl: 'https://cdn.cryptorefills.com/logos_v2/netflix_500x318.webp',
    brand: { id: 'netflix', name: 'Netflix', logoUrl: 'https://cdn.cryptorefills.com/logos_v2/netflix_500x318.webp' },
    category: { id: 'entertainment', name: 'Entertainment', slug: 'entertainment' },
    priceFromUsd: 15,
    displayPriceFrom: '$15.00',
    denominations: [
      { faceValue: 15, currency: 'USD' },
      { faceValue: 25, currency: 'USD' },
      { faceValue: 50, currency: 'USD' },
      { faceValue: 100, currency: 'USD' },
    ],
    inStock: true,
    rating: 4.8,
  },
  {
    id: '2',
    slug: 'spotify',
    name: 'Spotify',
    shortName: 'Spotify',
    description: 'Music streaming',
    logoUrl: 'https://cdn.cryptorefills.com/logos_v2/spotify_500x318.webp',
    brand: { id: 'spotify', name: 'Spotify', logoUrl: 'https://cdn.cryptorefills.com/logos_v2/spotify_500x318.webp' },
    category: { id: 'entertainment', name: 'Entertainment', slug: 'entertainment' },
    priceFromUsd: 10,
    displayPriceFrom: '$10.00',
    denominations: [
      { faceValue: 10, currency: 'USD' },
      { faceValue: 25, currency: 'USD' },
      { faceValue: 50, currency: 'USD' },
      { faceValue: 100, currency: 'USD' },
    ],
    inStock: true,
    rating: 4.7,
  },
  {
    id: '3',
    slug: 'amazon',
    name: 'Amazon',
    shortName: 'Amazon',
    description: 'Everything store',
    logoUrl: 'https://cdn.cryptorefills.com/logos_v2/amazon_500x318.webp',
    brand: { id: 'amazon', name: 'Amazon', logoUrl: 'https://cdn.cryptorefills.com/logos_v2/amazon_500x318.webp' },
    category: { id: 'store', name: 'Shopping', slug: 'store' },
    priceFromUsd: 25,
    displayPriceFrom: '$25.00',
    denominations: [
      { faceValue: 25, currency: 'USD' },
      { faceValue: 50, currency: 'USD' },
      { faceValue: 100, currency: 'USD' },
      { faceValue: 200, currency: 'USD' },
    ],
    inStock: true,
    rating: 4.9,
  },
  {
    id: '4',
    slug: 'playstation',
    name: 'PlayStation Store',
    shortName: 'PlayStation',
    description: 'Games & content',
    logoUrl: 'https://cdn.cryptorefills.com/logos_v2/playstation_500x318.webp',
    brand: { id: 'playstation', name: 'PlayStation', logoUrl: 'https://cdn.cryptorefills.com/logos_v2/playstation_500x318.webp' },
    category: { id: 'gaming', name: 'Gaming', slug: 'gaming' },
    priceFromUsd: 20,
    displayPriceFrom: '$20.00',
    denominations: [
      { faceValue: 20, currency: 'USD' },
      { faceValue: 50, currency: 'USD' },
      { faceValue: 100, currency: 'USD' },
    ],
    inStock: true,
    rating: 4.8,
  },
  {
    id: '5',
    slug: 'xbox',
    name: 'Xbox',
    shortName: 'Xbox',
    description: 'Games & subscriptions',
    logoUrl: 'https://cdn.cryptorefills.com/logos_v2/xbox_500x318.webp',
    brand: { id: 'xbox', name: 'Xbox', logoUrl: 'https://cdn.cryptorefills.com/logos_v2/xbox_500x318.webp' },
    category: { id: 'gaming', name: 'Gaming', slug: 'gaming' },
    priceFromUsd: 15,
    displayPriceFrom: '$15.00',
    denominations: [
      { faceValue: 15, currency: 'USD' },
      { faceValue: 25, currency: 'USD' },
      { faceValue: 50, currency: 'USD' },
    ],
    inStock: true,
    rating: 4.7,
  },
  {
    id: '6',
    slug: 'steam',
    name: 'Steam',
    shortName: 'Steam',
    description: 'PC games',
    logoUrl: 'https://cdn.cryptorefills.com/logos_v2/steam_500x318.webp',
    brand: { id: 'steam', name: 'Steam', logoUrl: 'https://cdn.cryptorefills.com/logos_v2/steam_500x318.webp' },
    category: { id: 'gaming', name: 'Gaming', slug: 'gaming' },
    priceFromUsd: 20,
    displayPriceFrom: '$20.00',
    denominations: [
      { faceValue: 20, currency: 'USD' },
      { faceValue: 50, currency: 'USD' },
      { faceValue: 100, currency: 'USD' },
    ],
    inStock: true,
    rating: 4.9,
  },
  {
    id: '7',
    slug: 'apple',
    name: 'Apple',
    shortName: 'Apple',
    description: 'Apps, music, iCloud',
    logoUrl: 'https://cdn.cryptorefills.com/logos_v2/apple_500x318.webp',
    brand: { id: 'apple', name: 'Apple', logoUrl: 'https://cdn.cryptorefills.com/logos_v2/apple_500x318.webp' },
    category: { id: 'entertainment', name: 'Entertainment', slug: 'entertainment' },
    priceFromUsd: 10,
    displayPriceFrom: '$10.00',
    denominations: [
      { faceValue: 10, currency: 'USD' },
      { faceValue: 25, currency: 'USD' },
      { faceValue: 50, currency: 'USD' },
      { faceValue: 100, currency: 'USD' },
    ],
    inStock: true,
    rating: 4.8,
  },
  {
    id: '8',
    slug: 'roblox',
    name: 'Roblox',
    shortName: 'Roblox',
    description: 'Robux for games',
    logoUrl: 'https://cdn.cryptorefills.com/logos_v2/roblox_500x318.webp',
    brand: { id: 'roblox', name: 'Roblox', logoUrl: 'https://cdn.cryptorefills.com/logos_v2/roblox_500x318.webp' },
    category: { id: 'gaming', name: 'Gaming', slug: 'gaming' },
    priceFromUsd: 10,
    displayPriceFrom: '$10.00',
    denominations: [
      { faceValue: 10, currency: 'USD' },
      { faceValue: 25, currency: 'USD' },
      { faceValue: 50, currency: 'USD' },
    ],
    inStock: true,
    rating: 4.6,
  },
];

const MOCK_CATEGORIES: Category[] = [
  { id: 'gaming', name: 'Gaming', slug: 'gaming', icon: '🎮', productCount: 150 },
  { id: 'entertainment', name: 'Entertainment', slug: 'entertainment', icon: '🎬', productCount: 200 },
  { id: 'store', name: 'Shopping', slug: 'store', icon: '🛍️', productCount: 100 },
  { id: 'food', name: 'Food Delivery', slug: 'food', icon: '🍔', productCount: 50 },
  { id: 'travel', name: 'Travel', slug: 'travel', icon: '✈️', productCount: 30 },
];

export async function getFeaturedProducts(limit = 12): Promise<Product[]> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 100));
  return MOCK_PRODUCTS.slice(0, limit);
}

export async function getCategories(): Promise<Category[]> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return MOCK_CATEGORIES;
}

export async function getProducts(): Promise<Product[]> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return MOCK_PRODUCTS;
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return MOCK_PRODUCTS.find((p) => p.slug === slug) || null;
}

export async function getProductsByCategory(categorySlug: string): Promise<Product[]> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return MOCK_PRODUCTS.filter((p) => p.category.slug === categorySlug);
}