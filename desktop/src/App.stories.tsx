import type { Meta, StoryObj } from "@storybook/react-vite";
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
	// Opened, so that the snapshot shows the list of machines.
	play: async ({ canvas, userEvent }) => await userEvent.click(canvas.getByRole("button", { name: /The pine the app uses/ })),
} satisfies Meta<typeof Foot>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The desktop app: this computer first, then the machines added in Settings > Environments, the one in use checked. */
export const MachinesWithThisComputer: Story = { args: { local: true } };

/** A bridge with no local machine: only the machines added, and no "This Mac" to pick. */
export const MachinesWithoutLocal: Story = { args: { local: false } };
