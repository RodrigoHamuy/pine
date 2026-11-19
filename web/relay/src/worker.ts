// The Worker: the relay at /ssh, with Cloudflare's own connect(), WebSocket pair and a name
// lookup over DNS-over-HTTPS, and the web client's built files beside it (site.ts). Everything
// the relay decides is in relay.ts.
import { connect } from "cloudflare:sockets";
import { relay } from "./relay.ts";
import { site, type SiteEnv } from "./site.ts";

/** A and AAAA records of a name, from Cloudflare's resolver. */
async function resolve(name: string): Promise<string[]> {
	const found: string[] = [];
	for (const type of ["A", "AAAA"]) {
		const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
			headers: { Accept: "application/dns-json" },
		});
		if (!response.ok) continue;
		const answer = (await response.json()) as { Answer?: { type: number; data: string }[] };
		// Type 1 is A and 28 is AAAA; a CNAME's record (5) is followed by the resolver already.
		for (const record of answer.Answer ?? []) if (record.type === 1 || record.type === 28) found.push(record.data);
	}
	return found;
}

const handle = relay({
	connect: (address) => connect(address),
	resolve,
	upgrade: () => {
		const pair = new WebSocketPair();
		return { socket: pair[1], response: new Response(null, { status: 101, webSocket: pair[0] }) };
	},
	timeoutMs: 5000,
});

export default { fetch: site(handle) } satisfies ExportedHandler<SiteEnv>;
