// The page's Web Storage in its iframe. Under its opaque origin the page has none (reading
// `localStorage` throws), so it gets one in memory, seeded with what the web bridge kept, and what
// it writes under its own keys ("pine.", the side panel's widths, what is folded) is handed back to
// the bridge, all of it at once after a short pause, which keeps it with the preferences.

const OWN = /^pine\./;

/** A Storage that starts with `initial` and hands the page's own entries to `save` after each change settles. */
export function keptStorage(initial: Record<string, string>, save: (all: Record<string, string>) => void, pauseMs = 300): Storage {
	const kept = new Map<string, string>(Object.entries(initial));
	let timer: ReturnType<typeof setTimeout> | undefined;
	const changed = (key: string) => {
		if (!OWN.test(key)) return;
		clearTimeout(timer);
		timer = setTimeout(() => save(Object.fromEntries([...kept].filter(([k]) => OWN.test(k)))), pauseMs);
	};
	return {
		get length() {
			return kept.size;
		},
		key: (i) => [...kept.keys()][i] ?? null,
		getItem: (k) => kept.get(String(k)) ?? null,
		setItem: (k, v) => {
			kept.set(String(k), String(v));
			changed(String(k));
		},
		removeItem: (k) => {
			if (kept.delete(String(k))) changed(String(k));
		},
		clear: () => {
			const own = [...kept.keys()].some((k) => OWN.test(k));
			kept.clear();
			if (own) changed("pine.");
		},
	};
}
