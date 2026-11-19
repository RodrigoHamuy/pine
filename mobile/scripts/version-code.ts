// The Android versionCode of a release: major * 1 000 000 + minor * 1 000 + patch. Android installs an
// update only over a smaller versionCode, so a later release has to give a larger number, which this
// does while minor and patch stay below 1000. Google Play takes at most 2 100 000 000.
//   node scripts/version-code.ts 0.38.0   prints 38000
const LIMIT = 2_100_000_000;

export function versionCode(version: string): number {
	const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!parts) throw new Error(`"${version}" is not the version of a release (like 0.38.0).`);
	const [major, minor, patch] = parts.slice(1).map(Number);
	if (minor > 999 || patch > 999) throw new Error(`version ${version}: minor and patch must stay below 1000 for an Android versionCode.`);
	const code = major * 1_000_000 + minor * 1_000 + patch;
	if (code < 1 || code > LIMIT) throw new Error(`version ${version} gives no Android versionCode between 1 and ${LIMIT}.`);
	return code;
}

if (import.meta.main) {
	try {
		console.log(versionCode(process.argv[2] ?? ""));
	} catch (e) {
		console.error((e as Error).message);
		process.exit(1);
	}
}
