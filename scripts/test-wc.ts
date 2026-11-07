// Manual smoke check against a real store (never used by tests).
// Run: npm run test:wc   (loads .env via --env-file)
import { getLowStockProducts, searchProducts } from "../src/woo/products.js";
import { listOrders, getOrder } from "../src/woo/orders.js";
import { getCustomerByEmail } from "../src/woo/customers.js";

console.log("low stock:", await getLowStockProducts(5));
console.log("search 'a':", await searchProducts("a"));

const orders = await listOrders(undefined, 5);
console.log("orders:", orders);

if (orders.length > 0) {
  const order = await getOrder(orders[0].id);
  console.log("first order:", order);
  if (order.email) console.log("customer:", await getCustomerByEmail(order.email));
}
