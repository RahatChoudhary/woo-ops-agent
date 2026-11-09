// Manual smoke check against a real store (never used by tests).
// Run: npm run test:wc   (loads .env via --env-file)
import { getLowStockProducts, getProduct, searchProducts } from "../src/woo/products.js";
import { listOrders, getOrder } from "../src/woo/orders.js";
import { getCustomerByEmail } from "../src/woo/customers.js";

console.log("low stock:", await getLowStockProducts(5));
const found = await searchProducts("a");
console.log("search 'a':", found);
if (found.length > 0) console.log("first product:", await getProduct(found[0].id));

const orders = await listOrders({ limit: 5 });
console.log("orders:", orders);

if (orders.length > 0) {
  const order = await getOrder(orders[0].id);
  console.log("first order:", order);
  if (order.customer.email) console.log("customer:", await getCustomerByEmail(order.customer.email));
}
