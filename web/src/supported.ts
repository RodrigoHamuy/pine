// Whether this browser can hold the web client's key: an Ed25519 key that WebCrypto makes and
// keeps. A browser that cannot is told so in one sentence, and the bridge starts nothing else.

/** What a browser without Ed25519 in WebCrypto is told, or nothing when it has it. */
export async function unsupported(subtle: SubtleCrypto): Promise<string | undefined> {
	try {
		await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
		return undefined;
	} catch {
		return "Pine needs a browser that makes Ed25519 keys in WebCrypto, which this one does not: open this page in Chrome 137 or later, Firefox 130 or later, or Safari 17 or later.";
	}
}
