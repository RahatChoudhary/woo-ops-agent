// Raw WooCommerce REST payloads shaped like wc/v3 responses, including personal
// fields that must never reach tool output.

export const PII = {
  phone: "+1-555-0100-SECRET",
  address_1: "742 Evergreen Terrace",
  address_2: "Apt 9",
  postcode: "90210-PII",
  ip: "203.0.113.77",
  transaction_id: "txn_SECRET_123",
  user_agent: "Mozilla/5.0 PII-Agent",
};

const address = {
  first_name: "Ada",
  last_name: "Lovelace",
  company: "Analytical Engines Ltd",
  address_1: PII.address_1,
  address_2: PII.address_2,
  city: "London",
  state: "LDN",
  postcode: PII.postcode,
  country: "GB",
};

export function rawProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: "Beanie",
    slug: "beanie",
    permalink: "https://shop.example.com/product/beanie",
    type: "simple",
    status: "publish",
    sku: "BEANIE-1",
    price: "18.00",
    regular_price: "20.00",
    sale_price: "18.00",
    on_sale: true,
    manage_stock: true,
    stock_quantity: 3,
    stock_status: "instock",
    total_sales: 42,
    date_modified: "2026-11-01T10:00:00",
    description: "<p>Warm &amp; <strong>cosy</strong> beanie.</p><script>alert(1)</script>",
    short_description: "<p>Wool beanie</p>",
    categories: [{ id: 1, name: "Accessories", slug: "accessories" }],
    variations: [],
    images: [{ src: "https://shop.example.com/beanie.jpg" }],
    meta_data: [{ key: "_supplier_cost", value: "4.00" }],
    ...overrides,
  };
}

export function rawOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    number: "501",
    status: "processing",
    currency: "GBP",
    total: "38.00",
    discount_total: "2.00",
    shipping_total: "4.00",
    total_tax: "0.00",
    date_created: "2026-11-07T09:30:00",
    date_paid: "2026-11-07T09:31:00",
    date_completed: null,
    customer_id: 7,
    customer_note: "Leave at the door",
    customer_ip_address: PII.ip,
    customer_user_agent: PII.user_agent,
    payment_method: "stripe",
    payment_method_title: "Credit card",
    transaction_id: PII.transaction_id,
    billing: { ...address, email: "ada@example.com", phone: PII.phone },
    shipping: { ...address, phone: PII.phone },
    line_items: [
      { id: 1, product_id: 10, name: "Beanie", sku: "BEANIE-1", quantity: 2, total: "36.00", meta_data: [] },
    ],
    shipping_lines: [{ method_title: "Flat rate", total: "4.00" }],
    meta_data: [{ key: "_stripe_customer_id", value: "cus_SECRET" }],
    ...overrides,
  };
}

export function rawCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    email: "ada@example.com",
    first_name: "Ada",
    last_name: "Lovelace",
    username: "ada",
    role: "customer",
    date_created: "2025-01-15T12:00:00",
    is_paying_customer: true,
    avatar_url: "https://secure.gravatar.com/avatar/x",
    billing: { ...address, email: "ada@example.com", phone: PII.phone },
    shipping: { ...address, phone: PII.phone },
    meta_data: [{ key: "notes", value: "VIP" }],
    ...overrides,
  };
}

/** A paged response like the store returns, with the WordPress paging headers. */
export function page(data: unknown[], totalPages = 1, total = data.length) {
  return { data, headers: { "x-wp-totalpages": String(totalPages), "x-wp-total": String(total) } };
}

/** Asserts no personal or sensitive value appears anywhere in the output. */
export function expectNoPII(output: unknown, expect: (v: unknown) => any) {
  const text = JSON.stringify(output);
  for (const value of Object.values(PII)) expect(text).not.toContain(value);
  for (const key of ["phone", "address_1", "address_2", "postcode", "billing", "shipping", "meta_data"]) {
    expect(text).not.toContain(`"${key}"`);
  }
}
