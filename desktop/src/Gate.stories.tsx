import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import type { ServiceState } from "./bridge.ts";
import { Gate } from "./App.tsx";
import { store } from "./model.ts";

// What the window shows before a pine answers (`Gate` in App.tsx), under a bridge with no local
// machine (a phone, a browser): there the machines are the only way to a pine, so they are listed below the
// message, with the client's own key, as Settings > Environments lists them.

window.pine.deviceKey = async () => ({ key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq3lYcVb0mXkJ2yq8rV6tZsP4dW1nE9fKcH7uR2aB3m pine-android", copy: async () => {}, share: async () => {} });

function Before({ state, hosts }: { state: ServiceState; hosts: string[] }) {
	store.local = false;
	store.prefs = { ...store.prefs, hosts, use: state.host };
	store.service = state;
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
		const { local, service, prefs } = store;
		return () => void Object.assign(store, { local, service, prefs });
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

/** A machine being reached, which can take a minute: the machines stay listed, to switch to another, and Disconnect lets go of this one. */
export const Connecting: Story = {
	args: { hosts: ["me@build-box", "studio"], state: { status: "starting", host: "me@build-box" } },
	beforeEach: () => {
		disconnected.mockClear();
		window.pine.disconnect = disconnected;
		return () => void delete (window.pine as Partial<typeof window.pine>).disconnect;
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		// Only on the row of the machine being reached.
		await expect(canvasElement.querySelector('[data-environment="studio"] [data-slot="disconnect"]')).toBeNull();
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
