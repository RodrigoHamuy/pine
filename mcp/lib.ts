// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). No dependencies.
import readline from "node:readline";
import { StringDecoder } from "node:string_decoder";

/** A part of a tool's result: text, or a picture for a model that can see. */
export type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: Record<string, unknown>;
	handler(args: Record<string, any>): Promise<string | McpContent[]> | string | McpContent[];
}

/**
 * The lines of a stream, cut at "\n" and nowhere else. (readline also cuts at U+2028 and U+2029,
 * which JSON leaves as they are inside a text: a page that holds one would arrive as two halves
 * of a message, and neither is one.)
 */
export function onLines(input: NodeJS.ReadableStream, each: (line: string) => void, ended?: () => void): void {
	const decoder = new StringDecoder("utf8");
	let rest = "";
	input.on("data", (chunk: Buffer | string) => {
		rest += typeof chunk === "string" ? chunk : decoder.write(chunk);
		for (let i = rest.indexOf("\n"); i >= 0; i = rest.indexOf("\n")) {
			const line = rest.slice(0, i);
			rest = rest.slice(i + 1);
			each(line.endsWith("\r") ? line.slice(0, -1) : line);
		}
	});
	input.on("end", () => {
		if (rest) each(rest);
		rest = "";
		ended?.();
	});
}

export function options<T = Record<string, any>>(): T {
	try {
		return JSON.parse(process.env.PINE_MCP_OPTIONS ?? "{}");
	} catch {
		return {} as T;
	}
}

/** `missing`: what a call to a tool that is not offered is answered with, instead of "unknown tool". */
export function serve(info: { name: string; version: string; instructions?: string }, tools: McpTool[], missing?: (name: string) => string): void {
	const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
	const rl = readline.createInterface({ input: process.stdin });
	rl.on("line", async (line) => {
		if (!line.trim()) return;
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
		}
		if (msg.id === undefined) return; // notification
		const reply = (result: unknown) => send({ jsonrpc: "2.0", id: msg.id, result });
		switch (msg.method) {
			case "initialize":
				return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: info.name, version: info.version }, instructions: info.instructions });
			case "ping":
				return reply({});
			case "tools/list":
				return reply({ tools: tools.map(({ handler: _h, ...t }) => t) });
			case "tools/call": {
				const tool = tools.find((t) => t.name === msg.params?.name);
				if (!tool) return reply({ content: [{ type: "text", text: missing?.(String(msg.params?.name)) ?? `unknown tool ${msg.params?.name}` }], isError: true });
				try {
					const result = await tool.handler(msg.params?.arguments ?? {});
					return reply({ content: typeof result === "string" ? [{ type: "text", text: result }] : result });
				} catch (e) {
					return reply({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
				}
			}
			default:
				return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
		}
	});
	rl.on("close", () => process.exit(0));
}
