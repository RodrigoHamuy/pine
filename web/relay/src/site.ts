// The one deployment: /ssh is the relay, everything else the web client's built files (web/dist,
// Cloudflare's static assets), served with the headers the two documents need.
//
// The bridge's document (/) holds the browser's key and the daemon's token: no other site may
// frame it. The page (/page/) runs in the bridge's iframe sandboxed with scripts only, under an
// opaque origin, so its module scripts, styles and fonts are fetched cross-origin and need
// `Access-Control-Allow-Origin`; they are public files of the build, and nothing else gets it.
import type { Env } from "./relay.ts";

export type SiteEnv = Env & { ASSETS: { fetch(request: Request): Promise<Response> } };

const PAGE = "/page/";

export function site(relay: (request: Request, env: Env) => Promise<Response>) {
	return async function fetch(request: Request, env: SiteEnv): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/ssh") return relay(request, env);
		const served = await env.ASSETS.fetch(request);
		const response = new Response(served.body, served);
		response.headers.set("X-Content-Type-Options", "nosniff");
		response.headers.set("Referrer-Policy", "no-referrer");
		if (url.pathname.startsWith(PAGE)) {
			response.headers.set("Access-Control-Allow-Origin", "*");
			if ((response.headers.get("content-type") ?? "").startsWith("text/html")) response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
		} else if ((response.headers.get("content-type") ?? "").startsWith("text/html")) {
			response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
		}
		return response;
	};
}
