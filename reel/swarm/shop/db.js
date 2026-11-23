// A stand-in for a database: made-up products and the one test account.
const products = [{ name: "Pine cone", price: "2.50" }, { name: "Bicycle bell", price: "7.00" }, { name: "Fish (toy)", price: "4.20" }];
export const db = {
  async user(name) { return name === "demo" ? { id: 1, name, password: "demo" } : undefined; },
  async all(_sql) { return products; },
};
