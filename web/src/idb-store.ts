// The web bridge's storage: one IndexedDB object store of the top-level document's origin. A
// CryptoKey is kept as it is (structured clone), so a key made non-extractable stays so. The page,
// in its opaque-origin iframe, has no way into it.
import type { Store } from "./host.ts";

const DB = "pine-web";
const STORE = "kept";

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export function idbStore(): Store {
	const db = open();
	const run = <T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>) =>
		db.then(
			(d) =>
				new Promise<T>((resolve, reject) => {
					const req = act(d.transaction(STORE, mode).objectStore(STORE));
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				}),
		);
	return {
		get: (name) => run("readonly", (s) => s.get(name)),
		set: async (name, value) => void (await run("readwrite", (s) => s.put(value, name))),
	};
}
