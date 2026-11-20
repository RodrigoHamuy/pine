import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { SidebarFooter, SidebarMenu, SidebarProvider } from "@/components/ui/sidebar";
import { Machines } from "./App.tsx";
import { store } from "./model.ts";

// The foot of the side bar, open on its list of machines, without a daemon: the store is set as
// the bridge's state would set it. `local` stands for what the bridge's `state()` says: false
// under a bridge with no "this computer" (the phone), where the list holds only the machines added.

function Foot({ local }: { local: boolean }) {
	store.local = local;
	store.prefs = { ...store.prefs, hosts: ["me@build-box", "studio"], use: "me@build-box" };
	store.service = { status: "ready", mode: "on build-box", started: false, home: "build-box:~/.pine", version: "0.23.0", from: "ssh me@build-box", host: "me@build-box", label: "build-box" };
	store.connected = true;
	return (
		<SidebarProvider className="min-h-0 w-64">
			<SidebarFooter className="w-full">
				<SidebarMenu>
					<Machines />
				</SidebarMenu>
			</SidebarFooter>
		</SidebarProvider>
	);
}

const meta = {
	component: Foot,
	parameters: { layout: "padded" },
	// What a story sets on the store is put back after it: the next story starts from the store as it was.
	beforeEach: () => {
		const { local, service, prefs, connected } = store;
		return () => void Object.assign(store, { local, service, prefs, connected });
	},
	// Opened, so that the snapshot shows the list of machines.
	play: async ({ canvas, userEvent }) => await userEvent.click(canvas.getByRole("button", { name: /The pine the app uses/ })),
} satisfies Meta<typeof Foot>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The desktop app: this computer first, then the machines added in Settings > Environments, the one in use checked. */
export const MachinesWithThisComputer: Story = {
	args: { local: true },
	play: async (context) => {
		await meta.play(context);
		const items = await within(document.body).findAllByRole("menuitemradio");
		await expect(items.filter((item) => !item.hasAttribute("data-host"))).toHaveLength(1);
		// This computer is there to go back to: nothing to disconnect.
		await expect(within(document.body).queryByRole("menuitem", { name: "Disconnect" })).toBeNull();
	},
};

const disconnected = fn(async () => ({ ...store.prefs, use: undefined }));

/** A bridge with no local machine: only the machines added, no "This Mac" or "This computer" to pick, and Disconnect, back to the list (the web client's). */
export const MachinesWithoutLocal: Story = {
	args: { local: false },
	beforeEach: () => {
		disconnected.mockClear();
		window.pine.disconnect = disconnected;
		return () => void delete (window.pine as Partial<typeof window.pine>).disconnect;
	},
	play: async (context) => {
		await meta.play(context);
		// The menu is drawn outside the story's root.
		const items = await within(document.body).findAllByRole("menuitemradio");
		await expect(items.map((item) => item.getAttribute("data-host"))).toEqual(["me@build-box", "studio"]);
		await expect(within(document.body).queryAllByText(/This (Mac|computer)/)).toHaveLength(0);
		await context.userEvent.click(await within(document.body).findByRole("menuitem", { name: "Disconnect" }));
		await expect(disconnected).toHaveBeenCalledTimes(1);
		// Opened again for the snapshot.
		await meta.play(context);
	},
};
