import { useEffect, useState } from "react";

/** Load something when the part appears, and again when `reload` is called or a dependency changes. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): { data?: T; error?: string; loading: boolean; reload: () => void } {
	const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
	const [tick, setTick] = useState(0);
	useEffect(() => {
		let live = true;
		setState((s) => ({ ...s, loading: true }));
		load().then(
			(data) => live && setState({ data, loading: false }),
			(e) => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }),
		);
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...deps, tick]);
	return { ...state, reload: () => setTick((t) => t + 1) };
}
