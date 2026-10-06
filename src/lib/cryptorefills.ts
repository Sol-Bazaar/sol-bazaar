const API_BASE = process.env.CRYPTOREFILLS_API_BASE || 'https://api.cryptorefills.com';
const API_KEY = process.env.CRYPTOREFILLS_API_KEY;

if (!API_KEY) {
  console.warn('CRYPTOREFILLS_API_KEY not set');
}

interface CryptorefillsPriceResponse {
  price: {
    currency: string;
    amount: number;
    network: string;
  };
}

interface CryptorefillsOrderValidationResponse {
  valid: boolean;
  errors?: string[];
}

interface CryptorefillsOrderResponse {
  order_id: string;
  status: string;
  product: {
    id: string;
    name: string;
    face_value: number;
    currency: string;
  };
  payment: {
    currency: string;
    network: string;
    amount: number;
    address: string;
    qr_code: string;
  };
  delivery_email: string;
  created_at: string;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  if (!API_KEY) {
    throw new Error('CRYPTOREFILLS_API_KEY not configured');
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `API error: ${res.status}`);
  }

  return res.json();
}

export async function getProducts(country = 'US'): Promise<any[]> {
  try {
    const data = await request<{ products: any[] }>(`/v2/brands?country=${country}`);
    return data.products || [];
  } catch (e) {
    console.error('Failed to fetch products:', e);
    return [];
  }
}

export async function getProductPrice(productId: string, currency = 'USDC', network = 'solana'): Promise<{ price: string; currency: string }> {
  try {
    const data = await request<CryptorefillsPriceResponse>(
      `/v4/products/price?product_id=${productId}&currency=${currency}&network=${network}`
    );
    return { price: data.price.amount.toString(), currency: data.price.currency };
  } catch (e) {
    console.error('Failed to fetch price:', e);
    return { price: '0', currency };
  }
}

export async function validateOrder(params: {
  product_id: string;
  currency: string;
  network: string;
  delivery_email: string;
}): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    const data = await request<{ valid: boolean; errors?: string[] }>('/v5/orders/validations', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return data;
  } catch (e) {
    console.error('Order validation failed:', e);
    return { valid: false, errors: [(e as Error).message] };
  }
}

export async function createCryptorefillsOrder(params: {
  product_id: string;
  currency: string;
  network: string;
  delivery_email: string;
}): Promise<CryptorefillsOrderResponse> {
  const data = await request<CryptorefillsOrderResponse>('/v5/orders', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data;
}

export async function getCryptorefillsOrder(orderId: string): Promise<CryptorefillsOrderResponse | null> {
  try {
    const data = await request<CryptorefillsOrderResponse>(`/v5/orders/${orderId}`);
    return data;
  } catch (e) {
    console.error('Failed to fetch order:', e);
    return null;
  }
}

export function mapCryptorefillsProduct(p: any) {
  return {
    id: p.id,
    slug: p.id.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: p.name,
    shortName: p.brand,
    description: `${p.brand} ${p.category} gift card`,
    logoUrl: p.image_url,
    brand: { id: p.brand.toLowerCase(), name: p.brand, logoUrl: undefined },
    category: { id: p.category.toLowerCase(), name: p.category, slug: p.category.toLowerCase() },
    priceFromUsd: p.price?.amount || p.face_value,
    displayPriceFrom: `$${(p.price?.amount || p.face_value).toFixed(2)}`,
    denominations: [{ faceValue: p.face_value, currency: p.currency }],
    inStock: true,
  };
}