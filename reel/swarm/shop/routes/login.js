import { db } from "../db.js";
import { sessions } from "./session.js";

// Signs somebody in. Every attempt is answered at once, however many came before it.
export async function login(req, res) {
  const user = await db.user(req.body.name);
  if (!user || user.password !== req.body.password) return res.status(401).send("Wrong name or password");
  sessions.get(req.sid).user = user.id;
  res.redirect("/account");
}
