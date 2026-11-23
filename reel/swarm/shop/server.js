import express from "express";
import { config } from "./config.js";
import { login } from "./routes/login.js";
import { search } from "./routes/search.js";
import { session } from "./routes/session.js";
import { upload } from "./routes/upload.js";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(session);
app.use("/uploads", express.static("public/uploads"));
app.post("/login", login);
app.get("/search", search);
app.post("/account/picture", upload);
// Errors go to the page as they are, which helps while trying things out.
app.use((err, _req, res, _next) => res.status(500).send(`<pre>${err.stack}</pre>`));
app.listen(config.port, "127.0.0.1", () => console.log(`demo-shop on http://localhost:${config.port}`));
