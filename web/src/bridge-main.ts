// The top-level document of the web client: the web bridge, and the page in an iframe sandboxed
// with scripts only. The bridge holds the browser's key, the SSH connection and the daemon's token;
// the page, under an opaque origin, reaches none of them and asks by message (serve.ts).
import { webBridge } from "./host.ts";
import { idbStore } from "./idb-store.ts";
import { serve } from "./serve.ts";
import { connect } from "./ssh.ts";

declare const __PINE_WEB_VERSION__: string;

/** Whether this browser's WebCrypto signs with Ed25519, which the key needs. */
async function ed25519(): Promise<boolean> {
	try {
		await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
		return true;
	} catch {
		return false;
	}
}

/** The relay of this deployment, for a host and port: the same host, at /ssh. */
function relay(host: string, port: number): string {
	const url = new URL("ssh", location.href);
	url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
	url.search = new URLSearchParams({ host, port: String(port) }).toString();
	return url.toString();
}

async function main() {
	if (!(await ed25519())) {
		const p = document.createElement("p");
		p.className = "unsupported";
		p.textContent = "This browser cannot make the SSH key Pine needs (Ed25519 in WebCrypto). Open this page in Chrome 137 or later, Firefox 130 or later, or Safari 17 or later.";
		document.body.append(p);
		return;
	}
	const bridge = webBridge({
		connect,
		store: idbStore(),
		relay,
		clipboard: (text) => navigator.clipboard.writeText(text),
		share: typeof navigator.share === "function" ? (title, text) => navigator.share({ title, text }) : undefined,
		version: __PINE_WEB_VERSION__,
		// A new tab that gets no handle on this document, and is not told where it was opened from.
		open: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
		save: (name, text) => {
			const a = document.createElement("a");
			a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
			a.download = name;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
		},
	});
	const frame = document.createElement("iframe");
	// Scripts and nothing else: no same origin (so no storage of the bridge's), no popups, no top navigation, no forms.
	frame.setAttribute("sandbox", "allow-scripts");
	frame.title = "Pine";
	serve(bridge, window, () => frame.contentWindow);
	// The page is loaded once. A frame that loads anything again was navigated by what it drew:
	// the whole client starts anew, so that nothing is told to another document in its place.
	let loads = 0;
	frame.addEventListener("load", () => {
		if (++loads > 1) location.reload();
	});
	frame.src = "page/";
	document.body.append(frame);
}

void main();
