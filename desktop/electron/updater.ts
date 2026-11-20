// The app's own update: a newer release downloaded in the background and installed by macOS's
// updater (Squirrel.Mac, through Electron's autoUpdater), never by itself: when the owner presses
// "Restart to update", or when the app quits with an update ready. The feed's address is the one
// updates.ts made from the release's version and this Mac's arch; Squirrel.Mac installs only an app
// signed like this one. Nothing the updater says is shown: a failure is one fixed line of the app's.
//
// This module is the one seam the tests replace: PINE_DESKTOP_UPDATER (for tests only) names a
// folder, and a stand-in that reads what to do from its plan.json and writes each call into its
// calls.jsonl takes the place of Electron's autoUpdater.
import fs from "node:fs";
import path from "node:path";
import { app, autoUpdater } from "electron";
import type { UpdaterState } from "./updates.ts";

export interface Updater {
	state(): UpdaterState;
	/** Download the release of `version` from its feed; once is enough, a second call for the same release does nothing. */
	download(feed: string, version: string): void;
	/** Quit and install the update that is ready (the daemons the app started are stopped before). */
	install(): void;
	/** The app quits: an update that is ready is installed on the way out. */
	quitting(): void;
}

const FAILED = "The update could not be downloaded or installed here.";
const READ_ONLY = "This app cannot replace itself where it is (the disk image, or a folder it cannot write): move it to Applications.";

/** The updater of this app: the stand-in of a test, macOS's for a packaged app on a Mac, none otherwise (a checkout updates nothing). */
export function makeUpdater(changed: (state: UpdaterState) => void): Updater | undefined {
	if (process.env.PINE_DESKTOP_UPDATER) return standIn(process.env.PINE_DESKTOP_UPDATER, changed);
	if (process.platform === "darwin" && app.isPackaged) return squirrel(changed);
	return undefined;
}

function squirrel(changed: (state: UpdaterState) => void): Updater {
	let now: UpdaterState = { state: "idle" };
	let version = "";
	const set = (s: UpdaterState) => changed((now = s));
	autoUpdater.on("update-downloaded", () => set({ state: "ready", version }));
	// Squirrel.Mac's own words are not shown; only whether it is the place the app runs from that is the trouble.
	autoUpdater.on("error", (e) => set({ state: "failed", version, reason: /read-only|translocat/i.test(String(e?.message)) ? READ_ONLY : FAILED }));
	return {
		state: () => now,
		download(feed, v) {
			if (now.state !== "idle" && now.state !== "failed" && version === v) return;
			version = v;
			set({ state: "downloading", version });
			try {
				// The feed is a file on the release ({ url, name, pub_date }), served as Squirrel.Mac's default server would answer.
				autoUpdater.setFeedURL({ url: feed, serverType: "default" });
				autoUpdater.checkForUpdates();
			} catch {
				set({ state: "failed", version, reason: FAILED });
			}
		},
		install: () => autoUpdater.quitAndInstall(),
		// Squirrel.Mac installs a downloaded update when the app quits by itself.
		quitting: () => {},
	};
}

function standIn(folder: string, changed: (state: UpdaterState) => void): Updater {
	let now: UpdaterState = { state: "idle" };
	let installed = false;
	const set = (s: UpdaterState) => changed((now = s));
	const note = (call: Record<string, unknown>) => fs.appendFileSync(path.join(folder, "calls.jsonl"), `${JSON.stringify(call)}\n`);
	return {
		state: () => now,
		download(feed, version) {
			if (now.state === "downloading" || now.state === "ready") return;
			note({ call: "download", feed });
			set({ state: "downloading", version });
			let outcome = "ready";
			try {
				outcome = JSON.parse(fs.readFileSync(path.join(folder, "plan.json"), "utf8")).outcome ?? "ready";
			} catch {
				// no plan: it goes well
			}
			setTimeout(() => set(outcome === "failed" ? { state: "failed", version, reason: FAILED } : { state: "ready", version }), 200);
		},
		install() {
			installed = true;
			note({ call: "install" });
			app.quit();
		},
		quitting() {
			if (now.state === "ready" && !installed) note({ call: "install-on-quit" });
		},
	};
}
