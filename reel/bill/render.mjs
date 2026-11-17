// Renders the made-up letters to a PDF and a PNG of each page: `node reel/bill/render.mjs`
// (all of them), or `node reel/bill/render.mjs parking-notice` (one).
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
for (const name of process.argv[2] ? [process.argv[2]] : ["water-bill", "parking-notice"]) {
	const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
	await page.goto("file://" + path.join(here, `${name}.html`));
	await page.pdf({ path: path.join(here, `${name}.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
	// One picture per page: water-bill-page1.png, water-bill-page2.png, ...
	const pages = await page.locator(".page").all();
	for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(here, `${name}-page${i + 1}.png`) });
	console.log(`wrote ${name}.pdf and ${pages.length} page pictures`);
}
await browser.close();
