function uuidv4(): string {
  return crypto.randomUUID();
}

export interface Order {
  id: string;
  orderNumber: string;
  tenantId: string;
  email: string;
  lines: OrderLine[];
  subtotalUsd: string;
  platformFee: string;
  totalUsd: string;
  token: string;
  status: OrderStatus;
  depositAddress?: string;
  depositAddressIndex?: number;
  expiresAt: Date;
  createdAt: Date;
  paidAt?: Date;
  completedAt?: Date;
}

export interface OrderLine {
  productId: string;
  faceValue: number;
  quantity: number;
  unitPriceUsd: number;
  productName?: string;
  logoUrl?: string;
}

export type OrderStatus = 
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'FULFILLING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED';

const orders = new Map<string, Order>();

export async function createOrder(params: {
  tenantId: string;
  email: string;
  lines: OrderLine[];
  subtotalUsd: string;
  platformFee: string;
  totalUsd: string;
  token: string;
  status: OrderStatus;
}): Promise<Order> {
  const id = uuidv4();
  const orderNumber = `GC-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const order: Order = {
    id,
    orderNumber,
    tenantId: params.tenantId,
    email: params.email,
    lines: params.lines,
    subtotalUsd: params.subtotalUsd,
    platformFee: params.platformFee,
    totalUsd: params.totalUsd,
    token: params.token,
    status: params.status,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    createdAt: new Date(),
  };

  orders.set(id, order);
  return order;
}

export async function getOrder(id: string): Promise<Order | null> {
  return orders.get(id) || null;
}

export async function getOrderByNumber(orderNumber: string): Promise<Order | null> {
  for (const order of orders.values()) {
    if (order.orderNumber === orderNumber) return order;
  }
  return null;
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const order = orders.get(id);
  if (order) {
    order.status = status;
    if (status === 'PAID') order.paidAt = new Date();
    if (status === 'COMPLETED') order.completedAt = new Date();
    orders.set(id, order);
  }
}

export async function updateOrderDepositAddress(id: string, address: string, index: number): Promise<void> {
  const order = orders.get(id);
  if (order) {
    order.depositAddress = address;
    order.depositAddressIndex = index;
    orders.set(id, order);
  }
}

export async function markOrderPaid(id: string, txSignature: string): Promise<void> {
  const order = orders.get(id);
  if (order) {
    order.status = 'PAID';
    order.paidAt = new Date();
    orders.set(id, order);
  }
}

export async function markOrderCompleted(id: string, codes: string[]): Promise<void> {
  const order = orders.get(id);
  if (order) {
    order.status = 'COMPLETED';
    order.completedAt = new Date();
    // Store codes in fulfillment table in production
    orders.set(id, order);
  }
}