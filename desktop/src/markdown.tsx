// An answer, drawn. What an agent writes can repeat what a web page told it to write, so the
// text is treated as content from outside. Streamdown parses it and draws it as it streams, and
// three things of pine's own replace its defaults, which are not safe here (a picture at any
// address loaded by itself, a button that downloads, links opened by the page):
//
//   - CLEAN, the rule set the text is cleaned with: no scripts, styles, forms, frames, svg, media
//     tags, no style, class or id attributes, and links only to http(s) and mailto. Pictures in
//     the text itself (`data:`) are kept, which GitHub's rules, Streamdown's default, drop;
//   - Link: it opens in the owner's browser, only for http(s), it has no href that the page could
//     follow, and its address stands next to it whenever its words are not the address itself;
//   - Picture: one at a web address is never fetched because an answer contains it. It is a line
//     to click, and then the daemon fetches it (the page's own policy allows no address on the
//     web). One at a path is shown from the agent's workspace, through the daemon; a `data:` png,
//     jpeg, gif or webp is shown as it is. Nothing else, and no download button.
//
// When Streamdown is upgraded, read its defaults again (`defaultRehypePlugins`, the components
// it draws, its controls) and run the desktop suite: its markdown test fails without each of the three.
import { createCodePlugin } from "@streamdown/code";
import { createContext, memo, useContext, useEffect, useState, type ReactNode } from "react";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { type Options as Schema } from "rehype-sanitize";
import { Streamdown, type Components, type ControlsConfig, type ExtraProps } from "streamdown";
import { api, media } from "./api.ts";
import { bridge } from "./bridge.ts";
import { mediaKind } from "./model.ts";
import { errText, short } from "./text.ts";

/** The tags and attributes an answer keeps. Everything else is taken away, its words kept; what is in `strip` goes with its words. */
export const CLEAN: Schema = {
	tagNames: ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "del", "s", "ins", "mark", "sub", "sup", "small", "kbd", "samp", "var", "code", "pre", "blockquote", "q", "cite", "abbr", "dfn", "time", "ul", "ol", "li", "dl", "dt", "dd", "a", "img", "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "details", "summary", "div", "span", "section", "figure", "figcaption", "ruby", "rt", "rp", "wbr"],
	attributes: {
		a: ["href", "title"],
		img: ["src", "alt", "title"],
		// The language of a code block, which the highlighter reads; no other class survives.
		code: [["className", /^language-./]],
		th: ["align", "colSpan", "rowSpan", "scope"],
		td: ["align", "colSpan", "rowSpan"],
		ol: ["start", "reversed"],
		li: ["value"],
		details: ["open"],
		abbr: ["title"],
		time: ["dateTime"],
		"*": ["lang", "dir"],
	},
	protocols: { href: ["http", "https", "mailto"], src: ["http", "https", "data"] },
	ancestors: { tbody: ["table"], td: ["table"], th: ["table"], thead: ["table"], tfoot: ["table"], tr: ["table"], caption: ["table"] },
	strip: ["script", "style", "template", "textarea", "select", "noscript", "title", "iframe", "frame", "object", "embed", "svg", "math", "video", "audio"],
	clobber: [],
	clobberPrefix: "",
};

const REHYPE = [rehypeRaw, [rehypeSanitize, CLEAN]] as const;

const isWeb = (url: string) => /^https?:\/\//i.test(url);
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/i;

export interface Where {
	agent: string;
	session?: string;
}

/** Whose workspace a path in the answer is in: a context, so that the components below stay the same for every answer. */
const WhereContext = createContext<Where | undefined>(undefined);

type Node = ExtraProps["node"];
const textOf = (node: Node | { type: string; value?: string; children?: unknown[] }): string => {
	if (!node) return "";
	if (node.type === "text") return (node as { value?: string }).value ?? "";
	return ((node as { children?: Node[] }).children ?? []).map(textOf).join("");
};

const open = (url: string) => (e: React.MouseEvent) => {
	e.preventDefault();
	void bridge.open(url);
};

function Link({ href, children, node }: React.ComponentProps<"a"> & ExtraProps) {
	const url = typeof href === "string" ? href : "";
	const shown = textOf(node).trim();
	if (!isWeb(url)) return <span>{url && shown !== url ? <>{children} ({url})</> : children}</span>;
	const plain = shown === url || shown === url.replace(/^https?:\/\//, "").replace(/\/$/, "");
	return (
		<>
			<a data-href={url} title={url} className="cursor-pointer text-primary underline decoration-primary/40 underline-offset-2" onClick={open(url)}>
				{children}
			</a>
			{/* Beside the link, not inside it: it is the address in plain letters, not more of the link's words.
			    It flows with the sentence: a line of its own would cut the link off from where it leads. */}
			{plain ? null : (
				<span data-target="" className="ml-1 inline cursor-pointer font-mono text-xs text-faint wrap-anywhere before:content-['→_']" title={url} onClick={open(url)}>
					{short(url.replace(/^https?:\/\//, ""), 72)}
				</span>
			)}
		</>
	);
}

const zoom = (src: string) => window.dispatchEvent(new CustomEvent("pine:zoom", { detail: src }));

/** How a picture, a video or a sound is drawn, in an answer and in a conversation: never wider than its place. */
export const MEDIA = {
	box: { image: "block max-w-md", video: "block max-w-lg", audio: "block max-w-md" },
	image: "block max-h-80 max-w-full cursor-zoom-in rounded-md border",
	video: "block max-h-90 max-w-full rounded-md bg-black",
	audio: "block w-full",
	cap: "mt-1 block text-xs text-faint",
};

function Player({ kind, src, alt }: { kind: "image" | "video" | "audio"; src: string; alt: string }) {
	return (
		<span className={`my-2.5 ${MEDIA.box[kind]}`}>
			{kind === "image" ? <img className={MEDIA.image} src={src} alt={alt} draggable={false} onClick={() => zoom(src)} /> : kind === "video" ? <video className={MEDIA.video} src={src} controls preload="metadata" /> : <audio className={MEDIA.audio} src={src} controls preload="metadata" />}
			{alt ? <span className={MEDIA.cap}>{alt}</span> : null}
		</span>
	);
}

/** A line to click instead of a picture: the address is shown, and nothing is fetched before the click. */
function Remote({ url, alt }: { url: string; alt: string }) {
	const [state, setState] = useState<{ loading?: boolean; error?: string; got?: { kind: "image" | "video" | "audio"; src: string } }>({});
	useEffect(() => () => void (state.got && URL.revokeObjectURL(state.got.src)), [state.got]);
	if (state.got) return <Player kind={state.got.kind} src={state.got.src} alt={alt} />;
	const kind = mediaKind(url.split(/[?#]/)[0]) ?? "image";
	const load = async () => {
		if (state.loading) return;
		setState({ loading: true });
		try {
			const got = await api.fetchImage(url);
			const kind = got.mime.startsWith("video/") ? "video" : got.mime.startsWith("audio/") ? "audio" : "image";
			const blob = new Blob([Uint8Array.from(atob(got.base64), (c) => c.charCodeAt(0))], { type: got.mime });
			setState({ got: { kind, src: URL.createObjectURL(blob) } });
		} catch (err) {
			setState({ error: errText(err) });
		}
	};
	const label = state.loading ? `Loading · ${short(url, 90)}` : state.error ? `Could not load ${short(url, 70)}: ${state.error}` : `Load ${kind === "image" ? "picture" : kind} · ${short(url, 90)}`;
	return (
		<button type="button" data-remote={url} title={url} className="inline-flex cursor-pointer rounded-md border border-dashed px-2.5 py-1 text-muted-foreground text-xs select-none hover:border-primary hover:text-foreground" onClick={() => void load()}>
			{label}
		</button>
	);
}

function Picture({ src, alt }: React.ComponentProps<"img"> & ExtraProps) {
	const where = useContext(WhereContext);
	const url = typeof src === "string" ? src : "";
	const words = alt ?? "";
	if (isWeb(url)) return <Remote url={url} alt={words} />;
	if (DATA_IMAGE.test(url)) return <Player kind="image" src={url} alt={words} />;
	if (where && url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
		const kind = mediaKind(url.split(/[?#]/)[0]);
		let file = url;
		try {
			file = decodeURIComponent(url);
		} catch {
			// as written
		}
		if (kind) return <Player kind={kind} src={media.workspace(where.agent, file, where.session)} alt={words} />;
	}
	return <>{words || url}</>;
}

const COMPONENTS: Components = { a: Link, img: Picture };
const PLUGINS = { code: createCodePlugin({ themes: ["github-light", "poimandres"] }) };
const CONTROLS: ControlsConfig = { code: { copy: true, download: false }, table: false, mermaid: false, image: false };

// Streamdown draws every element with its own look. What it leaves unstyled is a folded part written as
// raw HTML (`details`), drawn here as a box. `md` and `md-live` are what the tests look for.
const LOOK = "md cursor-auto select-text wrap-anywhere [&_details]:my-3 [&_details]:rounded-lg [&_details]:border [&_details]:px-3 [&_details[open]]:pb-2.5 [&_summary]:cursor-pointer [&_summary]:py-2 [&_summary]:font-medium [&_summary]:text-muted-foreground [&_summary]:select-none [&_summary:hover]:text-foreground";

/** Markdown, drawn into the page. While `live`, the text grows; what the reader opened stays open. */
export const Markdown = memo(function Markdown({ text, where, live }: { text: string; where?: Where; live?: boolean }): ReactNode {
	return (
		<WhereContext.Provider value={where}>
			<Streamdown className={`${LOOK}${live ? " md-live" : ""}`} caret="block" rehypePlugins={REHYPE as never} components={COMPONENTS} plugins={PLUGINS} controls={CONTROLS} linkSafety={{ enabled: false }} shikiTheme={["github-light", "poimandres"]} isAnimating={!!live} lineNumbers={false}>
				{text}
			</Streamdown>
		</WhereContext.Provider>
	);
});
