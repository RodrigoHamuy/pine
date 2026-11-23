import { db } from "../db.js";

// Products whose name contains what was typed.
export async function search(req, res) {
  const rows = await db.all("SELECT name, price FROM products WHERE name LIKE '%" + req.query.q + "%'");
  res.send(`<h1>Results for ${req.query.q}</h1>` + rows.map((r) => `<p>${r.name}: ${r.price}</p>`).join(""));
}
