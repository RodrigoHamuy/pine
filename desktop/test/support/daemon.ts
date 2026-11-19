// Telling a test's own daemon from another run's. Tests of several runs (several checkouts on one
// Mac) start daemons side by side, and a port a test picked can be taken by another run's daemon
// before its own binds it. `/health` answers without the token, so any daemon passes it: these ask
// `/overview` with the token of the test's home, which only that home's daemon takes.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/** A port nothing listens on now. */
export const freePort = () =>
	new Promise<number>((resolve) => {
		const s = net.createServer().listen(0, "127.0.0.1", () => {
			const { port } = s.address() as net.AddressInfo;
			s.close(() => resolve(port));
		});
	});

const tokenOf = (home: string) => {
	try {
		return fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	} catch {
		return undefined;
	}
};

/**
 * Who answers at this port: "ours" (the daemon of `home`), "other" (a daemon that does not take
 * its token, or that runs on another home), or "none" (nothing, or a home that has no token yet).
 */
export async function whoAnswers(port: number | string, home: string): Promise<"ours" | "other" | "none"> {
	const token = tokenOf(home);
	try {
		const res = await fetch(`http://127.0.0.1:${port}/overview`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000) });
		const body = res.ok ? ((await res.json()) as { home?: string }) : (await res.body?.cancel(), undefined);
		if (!token) return "none";
		return body && path.resolve(String(body.home)) === path.resolve(home) ? "ours" : "other";
	} catch {
		return "none";
	}
}

/** The daemon of `home` answers at this port: true when it does. */
export const ours = async (port: number | string, home: string) => (await whoAnswers(port, home)) === "ours";

/** Wait until the daemon of `home` answers at this port; fail at once when another one does. */
export async function waitForDaemon(port: number | string, home: string, timeoutMs = 15_000): Promise<void> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const who = await whoAnswers(port, home);
		if (who === "ours") return;
		if (who === "other") throw new Error(`port ${port} is answered by a daemon that does not take the token of ${home}: another run's. Pick another port.`);
		if (Date.now() > until) throw new Error(`the daemon of ${home} did not come up on port ${port} within ${timeoutMs / 1000} s`);
		await new Promise((r) => setTimeout(r, 100));
	}
}

/** Wait until the daemon of `home` no longer answers at this port: true when it is gone. Another run's daemon there does not count. */
export async function daemonGone(port: number | string, home: string, timeoutMs = 15_000): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	while (await ours(port, home)) {
		if (Date.now() > until) return false;
		await new Promise((r) => setTimeout(r, 150));
	}
	return true;
}
