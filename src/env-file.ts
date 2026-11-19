import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

// pine's .env file holds the secrets the configuration refers to as ${NAME}. A secret that reaches
// pine through a tool call (a broker's password, say) is put here, not into pine.json or an
// agent.json, so that the configuration files never hold one.

const fileOf = (home: string) => path.join(home, ".env");

/** How a value is written so that it reads back exactly as it is. */
function quoted(value: string): string {
	if (/[\r\n]/.test(value)) throw new Error("a secret cannot contain a line break");
	for (const form of [value, `'${value}'`, `"${value}"`, `\`${value}\``]) if (parseEnv(`X=${form}`).X === value) return form;
	throw new Error("this value cannot be stored in the .env file (it mixes every kind of quote)");
}

/** Set entries in .env, replacing ones of the same name. The file stays readable by its owner only. */
export function setEnv(home: string, entries: Record<string, string>): void {
	const names = Object.keys(entries);
	if (!names.length) return;
	for (const name of names) if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`"${name}" is not a usable name for an .env entry`);
	const lines = Object.entries(entries).map(([name, value]) => `${name}=${quoted(value)}`);
	const kept = fs.existsSync(fileOf(home)) ? fs.readFileSync(fileOf(home), "utf8").split("\n").filter((line) => !names.some((name) => line.startsWith(`${name}=`))) : [];
	while (kept.length && !kept.at(-1)!.trim()) kept.pop();
	fs.writeFileSync(fileOf(home), `${[...kept, ...lines].join("\n")}\n`, { mode: 0o600 });
	fs.chmodSync(fileOf(home), 0o600);
}

/** Take entries out of .env again. */
export function unsetEnv(home: string, names: string[]): void {
	if (!names.length || !fs.existsSync(fileOf(home))) return;
	const lines = fs.readFileSync(fileOf(home), "utf8").split("\n");
	const kept = lines.filter((line) => !names.some((name) => line.startsWith(`${name}=`)));
	if (kept.length !== lines.length) fs.writeFileSync(fileOf(home), kept.join("\n"), { mode: 0o600 });
}

/**
 * The name pine gives a secret it keeps for a source ("SOURCE") or an MCP server ("MCP") in .env:
 * the thing's name, the agent it belongs to (none for one of all agents) and the option.
 */
export function secretName(kind: "SOURCE" | "MCP", name: string, agentId: string | undefined, option: string): string {
	return `PINE_${kind}_${[name, ...(agentId ? [agentId] : []), option].join("_").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

/** Give entries of .env other names, keeping their values (an agent that was renamed). */
export function renameEnv(home: string, pairs: Array<[from: string, to: string]>): void {
	if (!pairs.length || !fs.existsSync(fileOf(home))) return;
	for (const [, to] of pairs) if (!/^[A-Z][A-Z0-9_]*$/.test(to)) throw new Error(`"${to}" is not a usable name for an .env entry`);
	const lines = fs.readFileSync(fileOf(home), "utf8").split("\n");
	const renamed = lines.map((line) => {
		const pair = pairs.find(([from]) => line.startsWith(`${from}=`));
		return pair ? `${pair[1]}${line.slice(pair[0].length)}` : line;
	});
	fs.writeFileSync(fileOf(home), renamed.join("\n"), { mode: 0o600 });
}
