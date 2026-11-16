// Draws the app's icon and writes it in the forms the system wants.
//   npx electron scripts/icon.mjs      (it runs in Electron: the icon is a drawing, and a browser draws it)
// Writes assets/icon.png (1024 px) and, on a Mac, assets/icon.icns.
import { app, BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const assets = path.resolve(import.meta.dirname, "..", "assets");

// A rounded square in the shape macOS gives its icons, black, and on it the P of pine's wordmark
// (docs/images/logo-dark.svg: the first letter, four blocks on a grid of 800), in white.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
	<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1c1c"/><stop offset="1" stop-color="#000000"/></linearGradient>
</defs>
<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
<rect x="100.5" y="100.5" width="823" height="823" rx="185.5" fill="none" stroke="#ffffff" stroke-opacity=".1"/>
<g transform="translate(280 280) scale(0.58)" fill="#ffffff">
	<rect x="280" y="560" width="240" height="240"/>
	<rect x="280" y="280" width="240" height="240"/>
	<rect x="0" y="280" width="240" height="240"/>
	<path d="M560 0H280V240H560V520H800V0H560Z"/>
</g>
</svg>`;

app.dock?.hide();
// (Not awaited at the top: Electron holds "ready" back until this module has run to its end.)
void app.whenReady().then(async () => {
	// Drawn off screen: the page hands over each picture it paints, and the first whole one is the icon.
	const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
	win.webContents.setFrameRate(10);
	const painted = new Promise((resolve) => {
		let last;
		let timer;
		win.webContents.on("paint", (_e, _dirty, picture) => {
			last = picture;
			clearTimeout(timer);
			timer = setTimeout(() => resolve(last), 500);
		});
	});
	void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="margin:0;background:transparent;overflow:hidden">${SVG}</body>`)}`);
	const image = await Promise.race([painted, new Promise((_, no) => setTimeout(() => no(new Error("nothing was painted within 20 seconds")), 20_000))]);
	fs.mkdirSync(assets, { recursive: true });
	fs.writeFileSync(path.join(assets, "icon.png"), image.resize({ width: 1024, height: 1024 }).toPNG());
	if (process.platform === "darwin") {
		const set = path.join(assets, "icon.iconset");
		fs.rmSync(set, { recursive: true, force: true });
		fs.mkdirSync(set);
		for (const size of [16, 32, 128, 256, 512]) {
			for (const scale of [1, 2]) fs.writeFileSync(path.join(set, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`), image.resize({ width: size * scale, height: size * scale, quality: "best" }).toPNG());
		}
		execFileSync("/usr/bin/iconutil", ["-c", "icns", "-o", path.join(assets, "icon.icns"), set]);
		fs.rmSync(set, { recursive: true, force: true });
	}
	console.log(`wrote ${assets}/icon.png${process.platform === "darwin" ? " and icon.icns" : ""}`);
	app.exit(0);
}).catch((e) => {
	console.error(e);
	app.exit(1);
});
