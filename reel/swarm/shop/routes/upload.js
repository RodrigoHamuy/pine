import fs from "node:fs/promises";
import path from "node:path";

// A picture for the account. It is kept under the name it came with.
export async function upload(req, res) {
  const { name, data } = req.body;
  await fs.writeFile(path.join("public/uploads", name), Buffer.from(data, "base64"));
  res.redirect("/account");
}
