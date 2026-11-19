// The daemon's pictures, video and sound in the page's iframe. The page has no network and an
// opaque origin, so an address the bridge served could not be loaded there: its media addresses
// (`MEDIA_BASE` of frame-bridge.ts, which desktop/src/api.ts builds them on) are never loaded as
// they are. The bytes are asked of the web bridge, which fetches them under the desktop's rules
// (`media` of host.ts), and the page makes its own object URL of them, which its policy allows
// (`blob:` in img-src and media-src).

type Media = { type: string; bytes: Uint8Array };

/** The most object URLs kept at once: the browser's view asks for a new picture several times a second. */
const KEPT = 64;

/** Media addresses turned into object URLs, each made once while it is among the last `KEPT`. */
export function mediaUrls(deps: {
	base: string;
	media(target: string): Promise<Media>;
	createObjectURL(blob: Blob): string;
	revokeObjectURL(url: string): void;
}) {
	const prefix = `${deps.base}/`;
	const made = new Map<string, Promise<string | undefined>>();
	return {
		/** Whether an address is one of the daemon's media. */
		handles: (src: string) => src.startsWith(prefix),
		/** The object URL for a media address; none when the bridge refused it or it could not be had. */
		resolve(src: string): Promise<string | undefined> {
			const known = made.get(src);
			if (known) {
				made.delete(src);
				made.set(src, known);
				return known;
			}
			const url = deps.media(src.slice(deps.base.length)).then(
				(m) => deps.createObjectURL(new Blob([m.bytes as Uint8Array<ArrayBuffer>], { type: m.type })),
				() => undefined,
			);
			made.set(src, url);
			url.then((u) => u === undefined && made.get(src) === url && made.delete(src));
			while (made.size > KEPT) {
				const [oldest, gone] = made.entries().next().value!;
				made.delete(oldest);
				void gone.then((u) => u && deps.revokeObjectURL(u));
			}
			return url;
		},
	};
}

/**
 * Makes `src` of pictures, videos, sounds and their sources, whether set as a property or as an
 * attribute (React sets it so), go through `urls` when it is a media address: the element gets
 * the object URL once it is there, or an empty picture that fails to load (so that its `onerror`
 * runs) when there is none. Any other address is set as it is.
 */
export function installMedia(win: Window & typeof globalThis, urls: ReturnType<typeof mediaUrls>): void {
	const asked = new WeakMap<Element, string>();
	let broken: string | undefined;
	const setters = new Map<object, (this: Element, value: string) => void>();
	for (const proto of [win.HTMLImageElement.prototype, win.HTMLMediaElement.prototype, win.HTMLSourceElement.prototype]) {
		const own = Object.getOwnPropertyDescriptor(proto, "src")!;
		setters.set(proto, own.set!);
		Object.defineProperty(proto, "src", {
			...own,
			set(this: Element, value: string) {
				take(this, own.set!, String(value));
			},
		});
	}
	const setterOf = (el: Element) => {
		for (const [proto, set] of setters) if (proto.isPrototypeOf(el)) return set;
		return undefined;
	};
	const take = (el: Element, set: (this: Element, value: string) => void, value: string) => {
		if (!urls.handles(value)) {
			asked.delete(el);
			return set.call(el, value);
		}
		asked.set(el, value);
		void urls.resolve(value).then((url) => {
			if (asked.get(el) !== value) return;
			set.call(el, url ?? (broken ??= win.URL.createObjectURL(new win.Blob([], { type: "image/png" }))));
		});
	};
	const setAttribute = win.Element.prototype.setAttribute;
	win.Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
		const set = String(name).toLowerCase() === "src" ? setterOf(this) : undefined;
		if (set) return take(this, set, String(value));
		return setAttribute.call(this, name, value);
	};
}
