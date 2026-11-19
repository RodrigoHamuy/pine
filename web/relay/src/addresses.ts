// Which addresses the relay may connect to. Cloudflare's connect() already refuses some of these;
// the relay does not rely on it, so that it never becomes a way into a network it stands in.

type Range = { bits: number; base: bigint; prefix: number };

function range(cidr: string): Range {
	const [address, prefix] = cidr.split("/");
	const parsed = parse(address);
	if (!parsed) throw new Error(`bad range ${cidr}`);
	return { bits: parsed.bits, base: parsed.value, prefix: Number(prefix) };
}

function inRange(bits: number, value: bigint, r: Range) {
	if (r.bits !== bits) return false;
	const shift = BigInt(bits - r.prefix);
	return value >> shift === r.base >> shift;
}

/** Addresses that are not on the public internet: this host, private networks, link-local, multicast, reserved. */
const NOT_PUBLIC = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"224.0.0.0/4",
	"240.0.0.0/4",
	"::/96",
	"100::/64",
	"fc00::/7",
	"fe80::/10",
	"fec0::/10",
	"ff00::/8",
].map(range);

/**
 * Cloudflare's own ranges (cloudflare.com/ips), and its public resolver, which a Worker must
 * not be turned against.
 */
const CLOUDFLARE = [
	"173.245.48.0/20",
	"103.21.244.0/22",
	"103.22.200.0/22",
	"103.31.4.0/22",
	"141.101.64.0/18",
	"108.162.192.0/18",
	"190.93.240.0/20",
	"188.114.96.0/20",
	"197.234.240.0/22",
	"198.41.128.0/17",
	"162.158.0.0/15",
	"104.16.0.0/13",
	"104.24.0.0/14",
	"172.64.0.0/13",
	"131.0.72.0/22",
	"1.1.1.0/24",
	"1.0.0.0/24",
	"2400:cb00::/32",
	"2606:4700::/32",
	"2803:f800::/32",
	"2405:b500::/32",
	"2405:8100::/32",
	"2a06:98c0::/29",
	"2c0f:f248::/32",
].map(range);

/** IPv6 ranges that carry an IPv4 address, and where it sits: mapped, NAT64, 6to4. */
const CARRIES_V4: [Range, number][] = [
	[range("::ffff:0:0/96"), 0],
	[range("64:ff9b::/96"), 0],
	[range("2002::/16"), 80],
];

/** An IP address written as such, as a number; null for anything else. Brackets and an IPv6 zone are dropped. */
export function parse(text: string): { bits: 32 | 128; value: bigint } | null {
	let s = text.trim();
	if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
	const zone = s.indexOf("%");
	if (zone !== -1 && s.includes(":")) s = s.slice(0, zone);
	const v4 = parse4(s);
	if (v4 !== null) return { bits: 32, value: v4 };
	const v6 = parse6(s);
	if (v6 !== null) return { bits: 128, value: v6 };
	return null;
}

function parse4(s: string): bigint | null {
	const parts = s.split(".");
	if (parts.length !== 4) return null;
	let value = 0n;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
		value = (value << 8n) | BigInt(part);
	}
	return value;
}

function parse6(s: string): bigint | null {
	if (!s.includes(":") || !/^[0-9a-fA-F:.]+$/.test(s)) return null;
	let groups: string[] = [];
	// An IPv4 tail counts as the last two groups.
	const lastColon = s.lastIndexOf(":");
	const tail = s.slice(lastColon + 1);
	if (tail.includes(".")) {
		const v4 = parse4(tail);
		if (v4 === null) return null;
		s = s.slice(0, lastColon + 1) + ((v4 >> 16n) & 0xffffn).toString(16) + ":" + (v4 & 0xffffn).toString(16);
	}
	const halves = s.split("::");
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(":") : [];
	const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
	if (halves.length === 2) {
		const missing = 8 - head.length - rest.length;
		if (missing < 1) return null;
		groups = [...head, ...Array(missing).fill("0"), ...rest];
	} else groups = head;
	if (groups.length !== 8) return null;
	let value = 0n;
	for (const group of groups) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
		value = (value << 16n) | BigInt(parseInt(group, 16));
	}
	return value;
}

/** Whether the relay may connect to this address. */
export function allowed(address: { bits: 32 | 128; value: bigint }): boolean {
	const { bits, value } = address;
	if (NOT_PUBLIC.some((r) => inRange(bits, value, r))) return false;
	if (CLOUDFLARE.some((r) => inRange(bits, value, r))) return false;
	if (bits === 128) {
		for (const [r, shift] of CARRIES_V4) {
			if (inRange(128, value, r)) return allowed({ bits: 32, value: (value >> BigInt(shift)) & 0xffffffffn });
		}
	}
	return true;
}

const LOOPBACK = [range("127.0.0.0/8"), range("::1/128")];

/** Whether the address is this computer's own: 127.0.0.0/8 or ::1, written as itself. */
export function isLoopback(address: { bits: 32 | 128; value: bigint }): boolean {
	return LOOPBACK.some((r) => inRange(address.bits, address.value, r));
}

/** A host name as DNS has it: letters, digits, hyphens and dots. */
export function isName(text: string) {
	return text.length <= 253 && /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,62}\.?)*$/.test(text) && /[a-zA-Z]/.test(text);
}

/** The address written the way connect() takes it. */
export function format(address: { bits: 32 | 128; value: bigint }) {
	if (address.bits === 32) return [24n, 16n, 8n, 0n].map((shift) => String((address.value >> shift) & 0xffn)).join(".");
	const groups: string[] = [];
	for (let shift = 112n; shift >= 0n; shift -= 16n) groups.push(((address.value >> shift) & 0xffffn).toString(16));
	return groups.join(":");
}
