// The app's main process. It owns three things the page must not: the daemon's token, the
// operating system (windows, menus, dialogs, notifications), and the child that is the daemon
// when this app had to start one. The page gets a narrow bridge (preload.ts) and nothing else.
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme, Notification, protocol, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildVoice, Listening, NOT_HERE } from "../../src/tui/voice.ts";
import { type Command, install, look, remove, said } from "./command.ts";
import { callDaemon, followEvents, mediaFromDaemon, pageCsp } from "./daemon.ts";
import { connect, connectSsh, findPine, type Launch, loginEnv, pineRoot, readHosts, runPine, type Service, ServiceError, sshHost } from "./service.ts";
import { Terminals } from "./terminal.ts";
import { LATEST, lookForUpdate, type Update } from "./updates.ts";
import { cleanLook, type Look } from "../src/theme.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..");
const DEV_URL = process.env.PINE_DESKTOP_DEV_URL || undefined;
/** Scheme and host of an address. (Node's own `origin` says "null" for a scheme of the app's own.) */
const originOf = (url: string) => {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.host}`;
	} catch {
		return "";
	}
};
const ORIGIN = DEV_URL ? originOf(DEV_URL) : "app://pine";
const isMac = process.platform === "darwin";
/** Tests only: the window opens behind the owner's windows and the app never takes the focus or a place in the Dock. */
const BACKGROUND = Boolean(process.env.PINE_DESKTOP_BACKGROUND);
if (BACKGROUND && isMac) app.setActivationPolicy("accessory");

// A second set of windows and data for tests and for trying things out beside the real app.
if (process.env.PINE_DESKTOP_DATA) app.setPath("userData", path.resolve(process.env.PINE_DESKTOP_DATA));
app.setName("Pine");

protocol.registerSchemesAsPrivileged([
	{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
	{ scheme: "pine-media", privileges: { standard: true, secure: true, stream: true, bypassCSP: false } },
]);

// ---- preferences of the app itself (not pine's settings: those are the daemon's) -----------------

interface Prefs {
	/** Another pine home than ~/.pine. */
	home?: string;
	/** A daemon this app started goes on when the app quits. */
	keepRunning: boolean;
	/** Other machines whose pine the app can use, each a host for ssh (Settings > Environments). */
	hosts: string[];
	/** The one of them the app uses; none: the pine of this computer. */
	use?: string;
	notify: boolean;
	/** Whether GitHub is asked for a newer app when this one starts. */
	updates: boolean;
	/** `pine` for a terminal was looked after once (see firstCommand): a link the owner removed stays removed. */
	commandTried: boolean;
	/**
	 * The theme the page was last drawn in, as pine resolved it and cleanLook made it safe: the window
	 * opens in it, and its frame (light or dark) and background follow it. None: pmndre.
	 */
	look?: Look;
	/** While a coloured agent's conversation is in front, the window's accent is its colour. */
	agentAccent: boolean;
	bounds?: { x?: number; y?: number; width: number; height: number };
}

const prefsFile = () => path.join(app.getPath("userData"), "prefs.json");
let prefs: Prefs = { keepRunning: false, hosts: [], notify: true, updates: true, commandTried: false, agentAccent: true };

function loadPrefs(): void {
	try {
		const raw = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
		prefs = {
			home: typeof raw.home === "string" && raw.home ? raw.home : undefined,
			keepRunning: raw.keepRunning === true,
			hosts: readHosts(raw.hosts),
			use: undefined,
			notify: raw.notify !== false,
			updates: raw.updates !== false,
			commandTried: raw.commandTried === true,
			look: cleanLook(raw.look),
			// Off when the owner turned it off, or unticked the primary when the window took role families from the agent.
			agentAccent: raw.agentAccent === false ? false : raw.agentAccent === true || !(Array.isArray(raw.agentFamilies) && !raw.agentFamilies.includes("primary")),
			bounds: raw.bounds && Number(raw.bounds.width) > 300 && Number(raw.bounds.height) > 200 ? raw.bounds : undefined,
		};
		// Only a machine that is in the list: what else might be written there is not connected to.
		if (typeof raw.use === "string" && prefs.hosts.includes(raw.use)) prefs.use = raw.use;
	} catch {
		// first start
	}
	nativeTheme.themeSource = prefs.look?.kind ?? "dark";
}

/**
 * What the window shows before the page draws: the page colour of the theme it was last drawn in
 * (pmndre's before there was one). On a Mac the window is transparent, behind its vibrancy.
 */
function windowBackground(look = prefs.look): string {
	if (isMac) return "#00000000";
	return (look?.colors.bg ?? "#1b1e28").slice(0, 7);
}

/** Repaints a window's background for its current theme. */
function refreshBackground(entry: WinEntry): void {
	if (!entry.win.isDestroyed()) entry.win.setBackgroundColor(windowBackground(entry.look));
}

function savePrefs(): void {
	try {
		fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
		fs.writeFileSync(prefsFile(), `${JSON.stringify(prefs, null, 2)}\n`);
	} catch {
		// a preference that is not kept is not worth an error
	}
}

// ---- windows & daemons -------------------------------------------------------------------------

// Each window shows one pine at a time: this computer's, or another machine's over SSH (Settings >
// Environments). Multiple windows can be open at once, on the same pine or on different ones.
type ServiceState = { status: "starting"; host?: string } | { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string; host?: string; label?: string } | { status: "error"; kind: ServiceError["kind"]; message: string; host?: string };

interface WinEntry {
	id: number;
	wcId: number;
	win: BrowserWindow;
	host?: string;
	pageReady: boolean;
	pendingFolders: string[];
	pendingCommands: string[];
	look?: Look;
	badgeCount: number;
	terminals: Terminals;
}

interface EnvConnection {
	key: string;
	host?: string;
	service?: Service;
	state: ServiceState;
	connected: boolean;
	stream?: AbortController;
	starting?: Promise<void>;
	round: number;
}

const windows = new Map<number, WinEntry>();
const windowById = new Map<number, WinEntry>();
const envs = new Map<string, EnvConnection>();
let launch: Launch | undefined;
let lastFocusedWcId: number | undefined;
let quitting = false;
let listening: Listening | undefined;
let listeningWin: WinEntry | undefined;

const sendToWindow = (entry: WinEntry | undefined, channel: string, ...args: unknown[]) => {
	if (entry && !entry.win.isDestroyed()) entry.win.webContents.send(channel, ...args);
};

const broadcast = (channel: string, ...args: unknown[]) => {
	for (const entry of windows.values()) sendToWindow(entry, channel, ...args);
};

const windowsOn = (key: string): WinEntry[] => [...windows.values()].filter((w) => (w.host ?? "") === key && !w.win.isDestroyed());

const sendToEnv = (key: string, channel: string, ...args: unknown[]) => {
	for (const w of windowsOn(key)) if (w.pageReady) sendToWindow(w, channel, ...args);
};

function activeWindow(): WinEntry | undefined {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused && !focused.isDestroyed()) {
		const entry = windows.get(focused.webContents.id);
		if (entry) return entry;
	}
	if (lastFocusedWcId !== undefined) {
		const entry = windows.get(lastFocusedWcId);
		if (entry && !entry.win.isDestroyed()) return entry;
	}
	for (const entry of windows.values()) if (!entry.win.isDestroyed()) return entry;
	return undefined;
}

function updateBadge(): void {
	const total = [...windows.values()].reduce((sum, w) => sum + w.badgeCount, 0);
	if (isMac) app.dock?.setBadge(total > 0 ? String(total) : "");
	else app.setBadgeCount(total);
}

function setEnvState(env: EnvConnection, next: ServiceState): void {
	env.state = next;
	sendToEnv(env.key, "pine:service", next);
}

/** Whether a pine still answers: one on another machine may have lost its connection meanwhile. */
const answers = (s: Service) => fetch(`${s.base}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);

/** Lets go of a pine: the SSH connection to another machine ends (and a pine it started there); one this app started here stops, unless it is to go on. */
async function letGo(s: Service | undefined): Promise<void> {
	if (s?.host || (s?.started && !prefs.keepRunning)) await s.stop();
}

/** The daemon's live events, handed to every window on that pine in small batches (`followEvents`). */
function followEnv(env: EnvConnection): void {
	if (!env.service || env.stream) return;
	const s = env.service;
	const ac = new AbortController();
	env.stream = ac;
	followEvents(s, ac.signal, {
		batch: (events) => sendToEnv(env.key, "pine:events", events),
		connection: (up) => {
			env.connected = up;
			sendToEnv(env.key, "pine:connection", up);
		},
		// A daemon this app started and that is gone will not come back by waiting: start it again.
		// Nor does an SSH connection that broke: it is made again.
		lost: (times) => {
			if (times !== 5 || !(s.started || s.host) || quitting) return false;
			if (env.service === s) {
				env.service = undefined;
				env.stream = undefined;
				env.connected = false;
			}
			void letGo(s);
			if (windowsOn(env.key).length > 0) void startEnv(env.key, true);
			return true;
		},
	});
}

function syncStreams(): void {
	for (const env of envs.values()) {
		const count = windowsOn(env.key).length;
		if (count === 0 && env.stream) {
			env.stream.abort();
			env.stream = undefined;
			env.connected = false;
		} else if (count > 0 && env.service && !env.stream) {
			followEnv(env);
		}
	}
}

async function startEnv(key: string, force = false): Promise<void> {
	const host = key || undefined;
	let env = envs.get(key);
	if (!env) {
		env = { key, host, state: { status: "starting", host }, connected: false, round: 0 };
		envs.set(key, env);
	}
	if (!force && env.starting) return env.starting;
	if (!force && env.service) {
		if (env.connected && env.state.status === "ready") {
			if (windowsOn(key).length > 0) followEnv(env);
			return;
		}
		if (await answers(env.service)) {
			if (windowsOn(key).length > 0) followEnv(env);
			return;
		}
		const stale = env.service;
		env.service = undefined;
		env.stream?.abort();
		env.stream = undefined;
		env.connected = false;
		void letGo(stale);
	}
	const mine = ++env.round;
	env.stream?.abort();
	env.stream = undefined;
	env.service = undefined;
	env.connected = false;
	setEnvState(env, { status: "starting", host });
	let run: Promise<void> | undefined;
	run = (async () => {
		try {
			const made = host ? await connectSsh(host, await loginEnv()) : await connect((launch = await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined)), { home: prefs.home ?? process.env.PINE_HOME, keep: prefs.keepRunning });
			if (mine !== env.round) {
				void letGo(made);
				return;
			}
			env.service = made;
			setEnvState(env, { status: "ready", mode: made.mode, started: made.started, home: made.home, version: made.version, from: host ? `ssh ${host}` : (launch?.from ?? ""), host: made.host, label: made.label });
			if (windowsOn(key).length > 0) followEnv(env);
		} catch (e) {
			if (mine !== env.round) return;
			setEnvState(env, { status: "error", kind: e instanceof ServiceError ? e.kind : "failed", message: e instanceof Error ? e.message : String(e), host });
		} finally {
			if (env.starting === run) env.starting = undefined;
		}
	})();
	env.starting = run;
	return run;
}

/** A window shows another pine: this computer's (no host) or a machine's of the list. The tabs are that pine's own. */
async function use(entry: WinEntry, host: string | undefined): Promise<void> {
	if (host !== undefined && !prefs.hosts.includes(host)) throw new Error("That machine is not in the list: add it in Settings > Environments.");
	const key = host ?? "";
	const env = envs.get(key);
	if (host === entry.host && env?.service) return;
	prefs.use = host;
	savePrefs();
	// The terminals are in the folders of the other pine's conversations.
	entry.terminals.closeAll();
	entry.host = host;
	syncStreams();
	const current = envs.get(key);
	if (current && !current.starting && current.service && current.state.status === "ready") {
		if (await answers(current.service)) {
			sendToWindow(entry, "pine:service", current.state);
			followEnv(current);
			if (current.connected) sendToWindow(entry, "pine:connection", true);
			return;
		}
	}
	sendToWindow(entry, "pine:service", { status: "starting", host });
	await startEnv(key, current?.state.status === "error");
}

/** A picture, video or sound of the daemon's, for the page's `pine-media:` addresses. */
async function media(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const m = /^w(\d+)$/.exec(url.hostname);
	const entry = m ? windowById.get(Number(m[1])) : activeWindow();
	const s = entry ? envs.get(entry.host ?? "")?.service : undefined;
	return mediaFromDaemon(s, request.method, url.pathname, url.search);
}

// ---- the page ----------------------------------------------------------------------------------

const CSP = pageCsp();

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".map": "application/json" };

function page(request: Request): Response {
	const dist = path.join(APP_ROOT, "dist");
	const url = new URL(request.url);
	const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
	const file = path.normalize(path.join(dist, rel));
	if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("not found", { status: 404 });
	return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-security-policy": CSP, "x-content-type-options": "nosniff" } });
}

function windowFor(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): WinEntry | undefined {
	const frame = e.senderFrame;
	if (!frame || originOf(frame.url) !== ORIGIN) return undefined;
	const entry = windows.get(e.sender.id);
	if (!entry || entry.win.isDestroyed() || frame !== entry.win.webContents.mainFrame) return undefined;
	return entry;
}

/** Only pages on the web open outside the app; a link in an answer never starts a program or opens a file. */
function openOutside(url: string): void {
	try {
		const u = new URL(url);
		if (u.protocol === "http:" || u.protocol === "https:") void shell.openExternal(u.href);
	} catch {
		// not an address
	}
}

function createWindow(host?: string): WinEntry {
	if (host !== undefined && !prefs.hosts.includes(host)) throw new Error("That machine is not in the list: add it in Settings > Environments.");
	const b = prefs.bounds;
	const cascade = windows.size > 0 && b?.x !== undefined && b?.y !== undefined ? windows.size * 26 : 0;
	const win = new BrowserWindow({
		width: b?.width ?? 1280,
		height: b?.height ?? 820,
		x: b?.x !== undefined ? b.x + cascade : undefined,
		y: b?.y !== undefined ? b.y + cascade : undefined,
		// As narrow as a phone: below the page's breakpoint the side bar and the panel beside a conversation lie over it.
		minWidth: 360,
		minHeight: 480,
		show: false,
		title: "Pine",
		titleBarStyle: isMac ? "hiddenInset" : "default",
		trafficLightPosition: { x: 16, y: 16 },
		// Gives the page where the window buttons end (env(titlebar-area-x), 0 in full screen), so the bars make room for them by themselves.
		titleBarOverlay: isMac,
		vibrancy: isMac ? "sidebar" : undefined,
		visualEffectState: "followWindow",
		// So that the window does not flash another colour before the page draws.
		backgroundColor: windowBackground(),
		webPreferences: {
			preload: path.join(HERE, "preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			spellcheck: true,
			navigateOnDragDrop: false,
		},
	});
	const wcId = win.webContents.id;
	const entry: WinEntry = {
		id: win.id,
		wcId,
		win,
		host,
		pageReady: false,
		pendingFolders: pendingFolders.splice(0),
		pendingCommands: [],
		look: prefs.look,
		badgeCount: 0,
		// The owner's terminal of each conversation (terminal.ts): their own shell, which ends with the window.
		terminals: new Terminals(
			{ data: (id, data) => sendToWindow(entry, "pine:term-data", id, data), exit: (id, code) => sendToWindow(entry, "pine:term-exit", id, code), run: (id, report) => sendToWindow(entry, "pine:term-run", id, report) },
			{ env: loginEnv, hooks: path.join(app.getPath("userData"), "shell-hooks"), shell: process.env.PINE_DESKTOP_SHELL ? [process.env.PINE_DESKTOP_SHELL] : undefined, stillRunningMs: Number(process.env.PINE_DESKTOP_STILL_RUNNING_MS) || undefined },
		),
	};
	windows.set(wcId, entry);
	windowById.set(win.id, entry);
	lastFocusedWcId = wcId;
	win.once("ready-to-show", () => (BACKGROUND ? win.showInactive() : win.show()));
	win.webContents.setWindowOpenHandler(({ url }) => (openOutside(url), { action: "deny" }));
	win.webContents.on("will-navigate", (e, url) => {
		// The page stays the page. (Reloading it during development is the one navigation there is.)
		if (originOf(url) !== ORIGIN) {
			e.preventDefault();
			openOutside(url);
		}
	});
	win.webContents.on("will-attach-webview", (e) => e.preventDefault());
	const keep = () => {
		if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
		prefs.bounds = win.getBounds();
	};
	win.on("resize", keep);
	win.on("move", keep);
	win.on("close", savePrefs);
	win.on("focus", () => {
		lastFocusedWcId = wcId;
		nativeTheme.themeSource = entry.look?.kind ?? "dark";
		sendToWindow(entry, "pine:focus", true);
	});
	win.on("blur", () => sendToWindow(entry, "pine:focus", false));
	win.on("closed", () => {
		entry.terminals.closeAll();
		if (listeningWin === entry) {
			listening?.cancel();
			listening = undefined;
			listeningWin = undefined;
		}
		windows.delete(wcId);
		windowById.delete(entry.id);
		if (lastFocusedWcId === wcId) lastFocusedWcId = undefined;
		updateBadge();
		syncStreams();
	});
	void win.loadURL(DEV_URL ?? "app://pine/");
	if (process.env.PINE_DESKTOP_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
	void startEnv(host ?? "");
	return entry;
}

function showWindow(entry?: WinEntry): void {
	const target = entry && !entry.win.isDestroyed() ? entry : createWindow(prefs.use);
	const w = target.win;
	if (w.isMinimized()) w.restore();
	if (BACKGROUND) w.showInactive();
	else {
		w.show();
		w.focus();
	}
}

// ---- `pine` for a terminal -----------------------------------------------------------------------

/** What the packed app carries; a checkout has none of it. */
const RESOURCES = app.isPackaged ? process.resourcesPath : undefined;

const worded = (c: Command) => ({ ...c, text: said(c) });

/**
 * Once, the first time an app that carries pine is started from where it will stay: the link is
 * made where that takes no password. Where it takes one, nothing is asked out of nowhere; the
 * menu and Settings > App offer it. Not in a second set of data for tests and trying things out.
 */
async function firstCommand(): Promise<void> {
	if (prefs.commandTried || process.env.PINE_DESKTOP_DATA) return;
	const env = await loginEnv();
	const now = look(RESOURCES, env);
	if (now.state === "unavailable") return;
	prefs.commandTried = true;
	savePrefs();
	if (now.state === "none" && !now.password) await install(RESOURCES, env);
}

/** The menu's way to the same thing: asks before it sets the command up, and says what is so. */
async function commandFromMenu(): Promise<void> {
	const env = await loginEnv();
	let now = look(RESOURCES, env);
	if (now.state === "none") {
		const answer = await dialog.showMessageBox({ type: "question", message: "Use pine in a terminal too?", detail: said(now).replace(/^Not set up\. /, ""), buttons: ["Set Up", "Not Now"], defaultId: 0, cancelId: 1 });
		if (answer.response !== 0) return;
		now = await install(RESOURCES, env);
	}
	await dialog.showMessageBox({ type: "info", message: "pine in a terminal", detail: said(now) });
}

// ---- a newer app ---------------------------------------------------------------------------------

/**
 * Whom this app asks for the last release. An app from a checkout is no release and has no
 * version to compare: it asks nobody. PINE_DESKTOP_RELEASES is for tests, which name a stand-in
 * for GitHub (and with nothing in it, nobody is asked). Whatever answers there, the link the
 * owner gets leads to GitHub.
 */
const RELEASE_API = process.env.PINE_DESKTOP_RELEASES !== undefined ? process.env.PINE_DESKTOP_RELEASES || undefined : app.isPackaged ? LATEST : undefined;

/** The last answer that said something, for a page that is opened again. */
let known: Update | undefined;
/** The question of this start, asked once. */
let atStart: Promise<Update> | undefined;

async function askForUpdate(): Promise<Update> {
	const said = await lookForUpdate(app.getVersion(), process.arch, RELEASE_API);
	if (said.status !== "unknown") known = said;
	return said;
}

/**
 * What the page is told: with `again` (the menu, the settings) what GitHub says now, without it
 * what the start found. A start that got no answer asks again when the window is next opened.
 */
async function update(again?: boolean): Promise<Update | undefined> {
	if (!RELEASE_API) return undefined;
	if (again) return askForUpdate();
	if (prefs.updates) await (atStart ??= askForUpdate().then((said) => (said.status === "unknown" && (atStart = undefined), said)));
	return known;
}

// ---- menus -------------------------------------------------------------------------------------

/** A menu item that asks the frontmost window's page to do something: the page knows which conversation is in front. */
const item = (label: string, command: string, accelerator?: string, more: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => ({
	label,
	accelerator,
	click: () => {
		const target = activeWindow();
		if (target) {
			showWindow(target);
			if (target.pageReady) sendToWindow(target, "pine:menu", command);
			else target.pendingCommands.push(command);
		} else {
			const created = createWindow(prefs.use);
			created.pendingCommands.push(command);
		}
	},
	...more,
});

function buildMenu(): void {
	const template: MenuItemConstructorOptions[] = [
		...(isMac
			? [
					{
						label: "Pine",
						submenu: [{ role: "about" as const }, ...(RELEASE_API ? [item("Check for Updates…", "updates")] : []), { type: "separator" as const }, item("Settings…", "settings", "Cmd+,"), ...(RESOURCES && fs.existsSync(path.join(RESOURCES, "bin", "pine")) ? [{ label: "pine in a Terminal…", click: () => void commandFromMenu() }] : []), { type: "separator" as const }, { role: "services" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				{ label: "New Window", accelerator: "CmdOrCtrl+N", click: () => void createWindow(activeWindow()?.host ?? prefs.use) },
				item("New Conversation", "new", "CmdOrCtrl+T"),
				item("New Conversation with…", "agent", "CmdOrCtrl+Shift+T"),
				item("Open Folder…", "open-folder", "CmdOrCtrl+O"),
				item("New Conversation in a Worktree…", "new-worktree", "CmdOrCtrl+Alt+T"),
				{ type: "separator" },
				item("Attach Files…", "attach", "CmdOrCtrl+Shift+A"),
				item("Save File", "save", "CmdOrCtrl+S"),
				item("Export Conversation…", "export", "CmdOrCtrl+Shift+E"),
				{ type: "separator" },
				item("Close Tab", "close", "CmdOrCtrl+W"),
				{ role: "close", label: "Close Window", accelerator: "CmdOrCtrl+Shift+W" },
				...(isMac ? [] : [{ type: "separator" as const }, item("Settings…", "settings", "Ctrl+,"), { role: "quit" as const }]),
			],
		},
		{ label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "selectAll" }, { type: "separator" }, item("Find in Conversation", "find", "CmdOrCtrl+F"), item("Copy Last Answer", "copy", "CmdOrCtrl+Shift+C"), ...(isMac ? [item("Dictate Message", "voice", "Ctrl+R")] : [])] },
		{
			label: "View",
			submenu: [
				item("Command Palette…", "palette", "CmdOrCtrl+K"),
				{ type: "separator" },
				item("Toggle Sidebar", "sidebar", "CmdOrCtrl+B"),
				item("Toggle Side Panel", "code", "CmdOrCtrl+Alt+B"),
				item("Agent", "code-agent", "CmdOrCtrl+Shift+I"),
				item("Files", "code-files", "CmdOrCtrl+Shift+F"),
				item("Changes", "code-changes", "CmdOrCtrl+Shift+G"),
				item("Terminal", "code-terminal", "Ctrl+`"),
				item("Toggle Browser", "browser", "CmdOrCtrl+Shift+B"),
				item("Events", "events", "CmdOrCtrl+Shift+L"),
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
				...(app.isPackaged ? [] : [{ type: "separator" as const }, { role: "reload" as const }, { role: "toggleDevTools" as const }]),
			],
		},
		{
			label: "Conversation",
			submenu: [
				item("Stop", "stop", "CmdOrCtrl+."),
				{ type: "separator" },
				item("Take Back Last Message", "undo", "CmdOrCtrl+Shift+Z"),
				item("Bring It Back", "redo", "CmdOrCtrl+Shift+Y"),
				item("Shorten (Compact)", "compact"),
				item("Start Over (Reset)…", "reset"),
				{ type: "separator" },
				item("Model…", "model", "CmdOrCtrl+Shift+M"),
				item("Reasoning…", "reasoning"),
				item("Mode…", "mode", "CmdOrCtrl+Shift+P"),
				item("Goal…", "goal"),
				item("Worktree…", "worktree"),
				{ type: "separator" },
				item("Pin", "pin"),
				item("Rename…", "rename"),
				{ type: "separator" },
				item("Next Tab", "next-tab", "Ctrl+Tab"),
				item("Previous Tab", "prev-tab", "Ctrl+Shift+Tab"),
				...Array.from({ length: 9 }, (_, i) => item(`Tab ${i + 1}`, `tab-${i + 1}`, `CmdOrCtrl+${i + 1}`, { visible: false, acceleratorWorksWhenHidden: true })),
			],
		},
		{ role: "windowMenu" },
		{ role: "help", submenu: [item("Keys and Commands", "help"), ...(RELEASE_API && !isMac ? [item("Check for Updates…", "updates")] : []), { label: "pine on GitHub", click: () => openOutside("https://github.com/pmndre/pine") }] },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- what the page may ask for -----------------------------------------------------------------

function handle<T extends unknown[]>(channel: string, fn: (entry: WinEntry, ...args: T) => unknown): void {
	ipcMain.handle(channel, (e, ...args) => {
		const entry = windowFor(e);
		if (!entry) throw new Error("not from the app's page");
		return fn(entry, ...(args as T));
	});
}

function wire(): void {
	handle("pine:state", (entry) => {
		const env = envs.get(entry.host ?? "");
		return {
			state: env?.state ?? { status: "starting", host: entry.host },
			connected: Boolean(env?.service) && Boolean(env?.connected),
			home: prefs.home ?? process.env.PINE_HOME,
			prefs: { ...prefs, bounds: undefined },
			platform: process.platform,
			focused: entry.win.isFocused(),
			updates: Boolean(RELEASE_API),
			versions: { app: app.getVersion(), electron: process.versions.electron },
			mediaBase: `pine-media://w${entry.id}`,
		};
	});
	handle("pine:call", (entry, method: string, url: string, body?: unknown) => callDaemon(envs.get(entry.host ?? "")?.service, method, url, body));
	handle("pine:retry", (entry) => startEnv(entry.host ?? "", true));
	handle("pine:update", (_entry, again?: boolean) => update(again === true));
	handle("pine:restart", async (entry) => {
		const key = entry.host ?? "";
		const env = envs.get(key);
		// Only a daemon of this app's own is its to restart; another one is somebody's terminal.
		if (!env?.service?.started) throw new Error("this pine was started somewhere else (a terminal, a service). Restart it there.");
		env.stream?.abort();
		env.stream = undefined;
		const old = env.service;
		env.service = undefined;
		env.connected = false;
		setEnvState(env, { status: "starting", host: env.host });
		await old.stop();
		await startEnv(key, true);
	});
	handle("pine:init", async (entry) => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		const args = ["init", ...(prefs.home ? [prefs.home] : []), "--yes"];
		return runPine(launch, args, (line) => sendToWindow(entry, "pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	// The browser the web tools drive, fetched by the pine the app runs: each pine wants the build
	// of its own Playwright, and a home that was set up by another pine has an older one.
	handle("pine:browser", async (entry) => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		return runPine(launch, ["browser-install"], (line) => sendToWindow(entry, "pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	handle("pine:command", async (_entry, action?: string) => {
		const env = await loginEnv();
		return worded(action === "install" ? await install(RESOURCES, env) : action === "remove" ? await remove(RESOURCES, env) : look(RESOURCES, env));
	});
	handle("pine:use", (entry, host?: string) => use(entry, typeof host === "string" ? host : undefined));
	handle("pine:new-window", (entry, host?: string | null) => {
		const target = host === null ? entry.host : typeof host === "string" ? host || undefined : undefined;
		createWindow(target);
	});
	// A machine is added by its name alone; it is connected to when it is picked.
	handle("pine:hosts-add", (_entry, value: string) => {
		const host = sshHost(String(value ?? ""))?.host;
		if (!host) throw new Error("Write the machine as you would after ssh: host or user@host.");
		if (!prefs.hosts.includes(host)) {
			if (prefs.hosts.length >= 20) throw new Error("There are 20 machines in the list already: forget one first.");
			prefs.hosts.push(host);
			savePrefs();
			broadcast("pine:prefs", { ...prefs, bounds: undefined });
		}
		return { ...prefs, bounds: undefined };
	});
	handle("pine:hosts-forget", (_entry, host: string) => {
		if ([...windows.values()].some((w) => w.host === host)) throw new Error("A window uses this machine now. Close it or use another one first.");
		prefs.hosts = prefs.hosts.filter((h) => h !== host);
		savePrefs();
		broadcast("pine:prefs", { ...prefs, bounds: undefined });
		// Its connection ends, and a pine it started there with it.
		const env = envs.get(String(host));
		if (env) {
			env.round++;
			env.stream?.abort();
			envs.delete(String(host));
			if (env.service) void letGo(env.service);
		}
		return { ...prefs, bounds: undefined };
	});
	handle("pine:prefs", (entry, change: Partial<Prefs>) => {
		let shared = false;
		if (typeof change.notify === "boolean") ((prefs.notify = change.notify), (shared = true));
		if (typeof change.updates === "boolean") ((prefs.updates = change.updates), (shared = true));
		if (typeof change.keepRunning === "boolean") ((prefs.keepRunning = change.keepRunning), (shared = true));
		if ("home" in change) {
			const home = typeof change.home === "string" && change.home.trim() ? change.home.trim() : undefined;
			// Another home is another pine: the one held for this computer is not used again (the page restarts or reconnects).
			const old = envs.get("");
			if (home !== prefs.home && old) {
				old.round++;
				old.stream?.abort();
				envs.delete("");
				if (old.service) void letGo(old.service);
			}
			prefs.home = home;
			shared = true;
		}
		// The theme the page draws now: the window's frame (light or dark, the Mac's materials) and background follow it.
		if ("look" in change) {
			entry.look = cleanLook(change.look);
			refreshBackground(entry);
			if (entry.win.isFocused() || windows.size === 1) {
				prefs.look = entry.look;
				nativeTheme.themeSource = entry.look?.kind ?? "dark";
			}
		}
		if (typeof change.agentAccent === "boolean") ((prefs.agentAccent = change.agentAccent), (shared = true));
		savePrefs();
		const out = { ...prefs, bounds: undefined };
		if (shared) broadcast("pine:prefs", out);
		return out;
	});
	handle("pine:pick-folder", async (entry, title?: string) => {
		const r = await dialog.showOpenDialog(entry.win, { title: typeof title === "string" ? title.slice(0, 80) : "Choose a folder", properties: ["openDirectory", "createDirectory"] });
		return r.canceled ? undefined : r.filePaths[0];
	});
	handle("pine:save-text", async (entry, name: string, text: string) => {
		const r = await dialog.showSaveDialog(entry.win, { defaultPath: path.join(app.getPath("documents"), path.basename(String(name))) });
		if (r.canceled || !r.filePath) return undefined;
		fs.writeFileSync(r.filePath, String(text));
		return r.filePath;
	});
	handle("pine:open", (_entry, url: string) => openOutside(String(url)));
	handle("pine:reveal", (_entry, file: string) => {
		// Shown in the Finder, never opened: opening would start whatever the file is.
		if (typeof file === "string" && path.isAbsolute(file) && fs.existsSync(file)) shell.showItemInFolder(file);
	});
	handle("pine:notify", (entry, title: string, body: string, tab?: string) => {
		if (!prefs.notify || !Notification.isSupported() || entry.win.isFocused()) return;
		const n = new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 160), silent: false });
		n.on("click", () => (showWindow(entry), tab && sendToWindow(entry, "pine:menu", `focus:${tab}`)));
		n.show();
	});
	handle("pine:badge", (entry, count: number) => {
		entry.badgeCount = Math.max(0, Number(count) || 0);
		updateBadge();
	});
	// Dictating a message. The words are recognised on this Mac by the helper the terminal UI
	// uses too (src/tui/voice.ts): nothing is sent anywhere, and what is heard is text for the
	// input and nothing more. The page puts it there; nothing here sends a message.
	handle("pine:voice-start", async (entry, language?: string) => {
		listening?.cancel();
		listening = undefined;
		listeningWin = entry;
		const lang = typeof language === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : undefined;
		let command: string[];
		if (process.env.PINE_DESKTOP_VOICE) command = [process.env.PINE_DESKTOP_VOICE]; // a stand-in, for tests
		else {
			if (!isMac) throw new Error(NOT_HERE);
			launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
			const source = path.join(pineRoot(launch) ?? "", "src", "tui", "voice.swift");
			if (!fs.existsSync(source)) throw new Error("this pine has no voice input: its helper's source was not found. Update pine.");
			command = [await buildVoice(path.join(app.getPath("userData"), "voice"), source)];
		}
		const mine: Listening = new Listening(command, lang, {
			ready: () => listening === mine && sendToWindow(entry, "pine:voice", { type: "ready" }),
			partial: (text) => listening === mine && sendToWindow(entry, "pine:voice", { type: "partial", text }),
			model: (state) => listening === mine && sendToWindow(entry, "pine:voice", { type: "model", state }),
			done: (text, error) => {
				if (listening !== mine) return;
				listening = undefined;
				listeningWin = undefined;
				sendToWindow(entry, "pine:voice", { type: "done", text, error });
			},
		});
		listening = mine;
	});
	handle("pine:voice-stop", (_entry, cancel?: boolean) => {
		if (cancel) (listening?.cancel(), (listening = undefined), (listeningWin = undefined));
		else listening?.stop();
	});
	// The owner's terminal beside a conversation. What is written into it comes from the page's
	// keyboard, or from a code block of an answer that the owner ran with its button.
	handle("pine:term-open", (entry, id: string, cwd?: string, cols?: number, rows?: number) => entry.terminals.open(String(id), cwd, cols, rows));
	handle("pine:term-write", (entry, id: string, data: string) => entry.terminals.write(String(id), data));
	handle("pine:term-run", (entry, id: string, code: string) => entry.terminals.run(String(id), code));
	handle("pine:term-resize", (entry, id: string, cols: number, rows: number) => entry.terminals.resize(String(id), cols, rows));
	handle("pine:term-close", (entry, id: string) => entry.terminals.close(String(id)));
	// An item with `checked` is one of a set of choices (the side bar's "Sort by"), drawn with the system's mark.
	handle("pine:context-menu", (entry, items: Array<{ id: string; label: string; enabled?: boolean; separator?: boolean; danger?: boolean; checked?: boolean }>) => {
		return new Promise<string | undefined>((resolve) => {
			let picked: string | undefined;
			const menu = Menu.buildFromTemplate(items.slice(0, 30).map((i) => (i.separator ? { type: "separator" as const } : { label: String(i.label).slice(0, 80), enabled: i.enabled !== false, ...(typeof i.checked === "boolean" ? { type: "radio" as const, checked: i.checked } : {}), click: () => (picked = String(i.id)) })));
			menu.popup({ window: entry.win, callback: () => resolve(picked) });
		});
	});
}

// ---- life of the app ---------------------------------------------------------------------------

/** A folder the app was opened with before the app was ready (dropped on its icon, or `open -a Pine <folder>`). */
const pendingFolders: string[] = [];
function openFolder(dir: string): void {
	try {
		if (!fs.statSync(dir).isDirectory()) return;
	} catch {
		return;
	}
	if (!app.isReady()) {
		pendingFolders.push(dir);
		return;
	}
	const target = activeWindow() ?? createWindow(prefs.use);
	if (target.pageReady) (showWindow(target), sendToWindow(target, "pine:menu", `folder:${dir}`));
	else target.pendingFolders.push(dir);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", (_e, argv) => {
		const dir = argv.slice(1).find((a) => !a.startsWith("-") && path.isAbsolute(a));
		if (dir) openFolder(dir);
		else showWindow(activeWindow());
	});
	app.on("open-file", (e, file) => {
		e.preventDefault();
		openFolder(file);
	});
	app.on("web-contents-created", (_e, contents) => {
		// Nothing the page shows gets the camera, the microphone, the place or anything else of the system's.
		contents.session.setPermissionRequestHandler((_wc, _permission, done) => done(false));
	});
	void app.whenReady().then(() => {
		loadPrefs();
		protocol.handle("app", page);
		protocol.handle("pine-media", media);
		session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
		wire();
		ipcMain.on("pine:ready", (e) => {
			const entry = windowFor(e);
			if (!entry) return;
			entry.pageReady = true;
			const env = envs.get(entry.host ?? "");
			if (env) {
				sendToWindow(entry, "pine:service", env.state);
				if (env.service && env.connected) sendToWindow(entry, "pine:connection", true);
			}
			for (const dir of entry.pendingFolders.splice(0)) sendToWindow(entry, "pine:menu", `folder:${dir}`);
			for (const cmd of entry.pendingCommands.splice(0)) sendToWindow(entry, "pine:menu", cmd);
		});
		// From a checkout the program is Electron's, and so would be its icon in the Dock.
		if (isMac && !app.isPackaged) {
			try {
				app.dock?.setIcon(path.join(APP_ROOT, "assets", "icon.png"));
			} catch {
				// an icon is not worth failing over
			}
		}
		buildMenu();
		createWindow(prefs.use);
		void firstCommand();
		app.on("activate", () => showWindow(activeWindow()));
	});
	app.on("window-all-closed", () => {
		// On a Mac the app, and the daemon it started, stay when all windows are closed.
		if (!isMac) app.quit();
	});
	app.on("before-quit", (e) => {
		if (quitting) return;
		savePrefs();
		for (const entry of windows.values()) entry.terminals.closeAll();
		// The connections to other machines end with the app, and a pine one started there with it.
		const going = [...envs.values()].map((env) => env.service).filter((s): s is Service => Boolean(s && (s.host || (s.started && !prefs.keepRunning))));
		if (!going.length) return;
		// A daemon this app started ends with it, as the terminal UI's does: its agents are stopped
		// and its database closed before the app is gone.
		e.preventDefault();
		quitting = true;
		for (const env of envs.values()) env.stream?.abort();
		void Promise.all(going.map((s) => s.stop())).finally(() => app.quit());
	});
}
