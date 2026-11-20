import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import type { ServiceState } from "./bridge.ts";
import { Gate } from "./App.tsx";
import { store } from "./model.ts";

// What the window shows before a pine answers (`Gate` in App.tsx), under a bridge with no local
// machine (a phone, a browser): there the machines are the only way to a pine, so they are listed below the
// message, with the client's own key, as Settings > Environments lists them.

window.pine.deviceKey = async () => ({ key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq3lYcVb0mXkJ2yq8rV6tZsP4dW1nE9fKcH7uR2aB3m pine-android", copy: async () => {}, share: async () => {} });

function Before({ state, hosts, loadError, names, canAddHost = true, pairFailed = false }: { state: ServiceState; hosts: string[]; loadError?: string; names?: Record<string, string>; canAddHost?: boolean; pairFailed?: boolean }) {
	store.local = false;
	store.prefs = { ...store.prefs, hosts, use: state.host, names };
	store.service = state;
	store.loadError = loadError;
	store.canAddHost = canAddHost;
	store.pairFailed = pairFailed;
	return (
		<div className="flex h-200 w-full">
			<Gate />
		</div>
	);
}

const meta = {
	component: Before,
	parameters: { layout: "fullscreen" },
	// What a story sets on the store is put back after it: the next story starts from the store as it was.
	beforeEach: () => {
		const { local, service, prefs, loadError, canAddHost, pairFailed } = store;
		return () => void Object.assign(store, { local, service, prefs, loadError, canAddHost, pairFailed });
	},
	// Nothing of a local machine, and the machines listed: they are the only way to a pine.
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('[data-slot="gate-machines"]')).not.toBeNull();
		await expect(canvasElement.querySelector('[data-environment="local"]')).toBeNull();
		await expect(within(canvasElement).queryAllByText(/This Mac|This computer|Use this Mac|Set up pine/)).toHaveLength(0);
	},
} satisfies Meta<typeof Before>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The first start: no machine yet, the client's key to put on one, and the field to add it. */
export const NoMachineYet: Story = {
	args: { hosts: [], state: { status: "error", kind: "ssh", message: "Add the machine whose pine this device is to use, as you would write it after ssh: user@host, or user@host:port. Put this device's key into ~/.ssh/authorized_keys there first." } },
};

const fingerprint = "SHA256:Xv2k0yq3pZ8bW9cQm1sT4uE7rN6aL5dH2fJ0gK3iO8Y";
const trusted = fn();

/** A machine met for the first time: its host key's fingerprint, and Trust this key, the owner's yes to exactly that one (Try again only connects again). */
export const HostKeyToConfirm: Story = {
	args: {
		hosts: ["me@build-box"],
		state: { status: "error", kind: "ssh", host: "me@build-box", fingerprint, changed: false, message: `This device does not know me@build-box yet. Its host key's fingerprint is ${fingerprint}. If that is what the machine shows (ssh-keygen -lf on its /etc/ssh/ssh_host_*_key.pub), trust it and connect.` },
	},
	beforeEach: () => {
		trusted.mockClear();
		window.pine.trustHostKey = trusted;
		return () => void delete (window.pine as Partial<typeof window.pine>).trustHostKey;
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		const gate = canvasElement.querySelector<HTMLElement>('[data-slot="gate-machines"]')!.parentElement!;
		await expect(gate.querySelector('[data-slot="host-key-fingerprint"]')).toHaveTextContent(fingerprint);
		await userEvent.click(gate.querySelector<HTMLElement>(':scope > div > [data-slot="trust-host-key"]')!);
		await expect(trusted).toHaveBeenCalledTimes(1);
		await expect(trusted).toHaveBeenCalledWith("me@build-box", fingerprint);
		// The machine's row says it too, with a button of its own.
		const row = canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"]')!;
		await expect(row.querySelector('[data-slot="host-key-fingerprint"]')).toHaveTextContent(fingerprint);
		await expect(row.querySelector('[data-slot="trust-host-key"]')).not.toBeNull();
		// Its three buttons go below the text where they would squeeze it into a column (a phone, and the Gate's narrow card at any width).
		const text = row.querySelector<HTMLElement>('[data-slot="item-content"]')!;
		await expect(text.getBoundingClientRect().width).toBeGreaterThan(row.getBoundingClientRect().width / 2);
	},
};

/** A machine whose host key changed: never offered to trust, only to forget and add again. */
export const HostKeyChanged: Story = {
	args: {
		hosts: ["me@build-box"],
		state: { status: "error", kind: "ssh", host: "me@build-box", fingerprint, changed: true, message: `The host key of me@build-box changed: it is now ${fingerprint}. If you know why, forget the machine and add it again.` },
	},
	play: async (context) => {
		await meta.play(context);
		await expect(context.canvasElement.querySelector('[data-slot="trust-host-key"]')).toBeNull();
	},
};

const disconnected = fn(async () => ({ ...store.prefs, use: undefined }));
/** The bridge offers Disconnect for the story, and takes it back after. */
const offerDisconnect = () => {
	disconnected.mockClear();
	window.pine.disconnect = disconnected;
	return () => void delete (window.pine as Partial<typeof window.pine>).disconnect;
};

/** A machine being reached, which can take a minute: the machines stay listed, to switch to another, and Disconnect lets go of this one. */
export const Connecting: Story = {
	args: { hosts: ["me@build-box", "studio"], state: { status: "starting", host: "me@build-box" } },
	beforeEach: offerDisconnect,
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		// Only on the row of the machine being reached.
		await expect(canvasElement.querySelector('[data-environment="studio"] [data-slot="disconnect"]')).toBeNull();
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"] [data-slot="disconnect"]')!);
		await expect(disconnected).toHaveBeenCalledTimes(1);
	},
};

/** A machine not reached: the bridge keeps trying it, so Disconnect lets go of it and keeps its host key, which Forget would drop. */
export const NotReached: Story = {
	args: { hosts: ["me@build-box", "studio"], state: { status: "error", kind: "ssh", host: "me@build-box", message: "Connection refused." } },
	beforeEach: offerDisconnect,
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		await expect(within(canvasElement).getByText(/is not reached over SSH/)).toHaveTextContent("me@build-box is not reached over SSH");
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="badge"]')).toHaveTextContent("not reached");
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"] [data-slot="disconnect"]')!);
		await expect(disconnected).toHaveBeenCalledTimes(1);
	},
};

/** A long host (a Tailscale Funnel name and its port): it wraps between its parts, and the badge goes onto a line of its own, inside the row. */
export const LongHost: Story = {
	args: {
		hosts: ["someone@machine.tailnet1234.ts.net:10000", "someone@other.tailnet1234.ts.net:10000"],
		state: { status: "starting", host: "someone@machine.tailnet1234.ts.net:10000" },
	},
	play: async (context) => {
		await meta.play(context);
		const rows = [...context.canvasElement.querySelectorAll<HTMLElement>("[data-environment]")];
		await expect(rows).toHaveLength(2);
		for (const row of rows) await expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
		const row = rows[0]!;
		const badge = row.querySelector<HTMLElement>('[data-slot="badge"]')!;
		await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right);
	},
};

const ready: ServiceState = { status: "ready", mode: "on build-box", started: false, home: "build-box:~/.pine", version: "0.40.0", from: "ssh me@build-box", host: "me@build-box", label: "build-box" };

/** The machine's pine answered and its agents are being asked for over SSH: the same screen as while it was reached, so connecting reads as one wait. */
export const LoadingAgents: Story = {
	args: { hosts: ["me@build-box", "studio"], state: ready },
	beforeEach: offerDisconnect,
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/Connecting to/)).toHaveTextContent("Connecting to me@build-box");
		await expect(canvas.getByText("Loading its agents…")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="badge"]')).toHaveTextContent("connecting");
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"] [data-slot="disconnect"]')!);
		await expect(disconnected).toHaveBeenCalledTimes(1);
	},
};

const reloaded = fn(async () => {});

/** The machine's pine answered and its agents could not be loaded: what went wrong, Try again, and the machines to switch or disconnect. */
export const LoadFailed: Story = {
	args: { hosts: ["me@build-box", "studio"], state: ready, loadError: "The channel to the daemon was closed." },
	beforeEach: () => {
		reloaded.mockClear();
		store.reload = reloaded;
		return () => void delete (store as Partial<typeof store>).reload;
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/Could not load the agents of/)).toHaveTextContent("me@build-box");
		await expect(canvas.getByText("The channel to the daemon was closed.")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="disconnect"]')).not.toBeNull();
		// No wait shown on the row: it answered, and did not load.
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="badge"]')).toHaveTextContent("not loaded");
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-slot="gate-reload"]')!);
		await expect(reloaded).toHaveBeenCalledTimes(1);
	},
};

// ---- Macs paired by their code (the web client's) ----

const MAC = "mac:q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";

/** A pairing link being paired with, the Mac asking the owner: the four digits it shows too, and where to answer. */
export const PairingConfirmOnMac: Story = {
	args: { hosts: [], state: { status: "starting", pairing: { code: "4821", name: "Chrome on Android" } } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Confirm on your Mac")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-slot="pairing-code"]')).toHaveTextContent("4821");
		await expect(canvas.getByText(/Chrome on Android/)).toBeInTheDocument();
	},
};

/** A pairing link that expired or was used: said, with what to do next. */
export const PairingExpired: Story = {
	args: { hosts: [], canAddHost: false, pairFailed: true, state: { status: "error", kind: "ssh", message: "This pairing link has expired or was used already. Open Pine on the Mac and add this device again." } },
	play: async (context) => {
		await meta.play(context);
		const canvas = within(context.canvasElement);
		await expect(canvas.getByText("The pairing did not go through")).toBeInTheDocument();
		await expect(canvas.getByText(/expired or was used already/)).toBeInTheDocument();
	},
};

const opened = fn(async () => {});

/** The official service, nothing paired yet: how to pair in three lines and where the app is; no user@host field and no key for one. */
export const PairFirst: Story = {
	args: { hosts: [], canAddHost: false, state: { status: "error", kind: "ssh", message: "Pair this browser with the Pine app on your Mac: open Pine on your Mac, go to Settings > Browser access, and scan the code it shows." } },
	beforeEach: () => {
		opened.mockClear();
		const was = window.pine.open;
		window.pine.open = opened;
		return () => void (window.pine.open = was);
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		await expect(within(canvasElement).getByText("Pair this browser with your Mac")).toBeInTheDocument();
		await expect(canvasElement.querySelectorAll('[data-slot="pair-how-to"] li')).toHaveLength(3);
		await expect(canvasElement.querySelector("input")).toBeNull();
		await expect(canvasElement.querySelector('[data-slot="device-key"]')).toBeNull();
		await expect(within(canvasElement).queryAllByText(/user@host/)).toHaveLength(0);
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-slot="get-the-app"]')!);
		await expect(opened).toHaveBeenCalledWith("https://github.com/pmndre/pine/releases/latest");
	},
};

const renamed = fn(async () => {});

/** A paired Mac that does not answer: by its name, never its id, with what the owner is told and Rename and Forget on its row. */
export const PairedMacNotReached: Story = {
	args: { hosts: [MAC], canAddHost: false, names: { [MAC]: "Studio Mac" }, state: { status: "error", kind: "ssh", host: MAC, message: "Your Mac does not answer: it is off, asleep, or Pine is closed. This browser keeps trying, and connects when the Mac is back." } },
	beforeEach: () => {
		renamed.mockClear();
		window.pine.renameHost = async () => store.prefs;
		const was = store.renameMachine;
		store.renameMachine = renamed;
		return () => {
			delete (window.pine as Partial<typeof window.pine>).renameHost;
			store.renameMachine = was;
		};
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		await expect(within(canvasElement).getByText(/is not reached$/)).toHaveTextContent("Studio Mac is not reached");
		await expect(within(canvasElement).queryAllByText(/q1w2e3r4/)).toHaveLength(0);
		const row = canvasElement.querySelector<HTMLElement>(`[data-environment="${MAC}"]`)!;
		await expect(row).toHaveTextContent("Studio Mac");
		await expect(row).toHaveTextContent(/Your Mac does not answer/);
		await userEvent.click(row.querySelector<HTMLElement>('[data-slot="rename-machine"]')!);
		await expect(renamed).toHaveBeenCalledWith(MAC);
		await expect(within(row).getByText("Forget")).toBeInTheDocument();
	},
};
