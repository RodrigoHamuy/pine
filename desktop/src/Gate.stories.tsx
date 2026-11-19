import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ServiceState } from "./bridge.ts";
import { Gate } from "./App.tsx";
import { store } from "./model.ts";

// What the window shows before a pine answers (`Gate` in App.tsx), under a bridge with no local
// machine (the phone): there the machines are the only way to a pine, so they are listed below the
// message, with the phone's key, as Settings > Environments lists them.

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

const meta = { component: Before, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Before>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The first start: no machine yet, the phone's key to put on one, and the field to add it. */
export const NoMachineYet: Story = {
	args: { hosts: [], state: { status: "error", kind: "ssh", message: "Add the machine whose pine this phone is to use, as you would write it after ssh: user@host, or user@host:port. Put this phone's key into ~/.ssh/authorized_keys there first." } },
};

/** A machine met for the first time: its host key's fingerprint, which Try again trusts. */
export const HostKeyToConfirm: Story = {
	args: {
		hosts: ["me@build-box"],
		state: { status: "error", kind: "ssh", host: "me@build-box", message: "This phone does not know me@build-box yet. Its host key's fingerprint is SHA256:Xv2k0yq3pZ8bW9cQm1sT4uE7rN6aL5dH2fJ0gK3iO8Y. If that is what the machine shows (ssh-keygen -lf on its /etc/ssh/ssh_host_*_key.pub), press Try again to trust it and connect." },
	},
};
