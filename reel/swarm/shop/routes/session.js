import crypto from "node:crypto";
import { config } from "../config.js";

export const sessions = new Map();

// A visitor keeps the id they came with, also after they signed in.
export function session(req, res, next) {
  const sent = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  req.sid = sent ?? crypto.randomUUID();
  if (!sessions.has(req.sid)) sessions.set(req.sid, {});
  res.setHeader("Set-Cookie", `${config.cookie.name}=${req.sid}; Path=/`);
  next();
}
