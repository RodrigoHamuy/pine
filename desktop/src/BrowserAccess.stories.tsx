import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { AccessState } from "./bridge.ts";
import { BrowserAccessView } from "./BrowserAccess.tsx";

// Settings > Browser access drawn from a state, as the main process tells it: no bridge, the calls
// are stand-ins, and the clock is fixed so that the time left and "last connected" stay the same.
const NOW = Date.parse("2026-11-20T10:00:00Z");
const SERVICE = "https://pine.example.workers.dev";
const LINK = `${SERVICE}/#pair=x8Qk2vJp1mZl3nRt5yWb7cDf9gHs0aEu4iOq6eTr2wA.Zm9vYmFyYmF6cXV4cXV1eA`;

const off: AccessState = { enabled: false, service: SERVICE, openAtLogin: false, status: "off", devices: [] };
const devices: AccessState["devices"] = [
	{ id: "d1", name: "Chrome on Android", paired: "2026-11-02T08:12:00Z", seen: "2026-11-20T09:58:00Z", connected: { path: "lan" } },
	{ id: "d2", name: "Safari on iPhone", paired: "2026-10-14T19:40:00Z", seen: "2026-11-19T22:05:00Z" },
	{ id: "d3", name: "Firefox on Linux, the laptop in the kitchen that everybody uses on Sundays", paired: "2026-11-20T09:30:00Z", connected: { path: "ipv6" } },
];
const waiting: AccessState = { ...off, enabled: true, openAtLogin: true, status: "waiting", devices };

const meta = {
	component: BrowserAccessView,
	// No docs page: it would open every story's dialog at once, one over the other.
	tags: ["!autodocs"],
	parameters: { layout: "fullscreen" },
	args: { state: off, now: NOW, platform: "darwin", actions: { set: fn(async () => {}), add: fn(), close: fn(), answer: fn(), remove: fn(), copy: fn() } },
	render: (args) => (
		<div className="@container/settings mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-16">
			<BrowserAccessView {...args} />
		</div>
	),
} satisfies Meta<typeof BrowserAccessView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Off, as a fresh app has it: nothing contacted, no device. On a Mac the section is about "This Mac". */
export const Off: Story = {
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText("This Mac")).toBeInTheDocument();
	},
};

/** The app on another system than macOS: the section is about "This computer", and no text says Mac. */
export const NotAMac: Story = {
	args: { state: waiting, platform: "linux" },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText("This computer")).toBeInTheDocument();
		await expect(canvasElement).not.toHaveTextContent(/\bMac\b/);
	},
};

/** Turned on the first time: "Open Pine at login" is offered, checked. */
export const TurningOn: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole("switch", { name: /Browser access/ }));
		const dialog = await within(document.body).findByRole("alertdialog");
		await expect(within(dialog).getByRole("checkbox", { name: "Open Pine at login" })).toBeChecked();
	},
};

/** No service address (a build that names no official one): the problem is said under the switch. */
export const NeedsAnAddress: Story = {
	args: { state: { ...off, service: "", problem: { kind: "address", message: "Browser access needs the address of the service a browser opens: write the address of your own deployment of pine's web client." } } },
};

/** On and waiting at the service, with devices: one connected on the same network, one seen yesterday, one connected directly over IPv6 with a long name. */
export const Waiting: Story = { args: { state: waiting } };

/** On, and the service cannot be reached. */
export const Unreachable: Story = { args: { state: { ...waiting, status: "unreachable" } } };

/** Add a device: the QR code of the pairing link, Copy link, and the time left. */
export const Pairing: Story = {
	args: { state: { ...waiting, pairing: { link: LINK, expires: new Date(NOW + 98_000).toISOString() } }, opened: { link: LINK, expires: new Date(NOW + 98_000).toISOString() } },
};

/** The two minutes are over: the dialog says so and offers a new code. */
export const PairingExpired: Story = {
	args: { state: waiting, opened: { link: LINK, expires: new Date(NOW - 1000).toISOString() } },
};

/** A device used the code: its name and the four digits its screen shows, with Allow and Refuse. */
export const PairingRequest: Story = {
	args: { state: { ...waiting, request: { name: "Chrome on Android", code: "4821" } }, opened: { link: LINK, expires: new Date(NOW + 60_000).toISOString(), asked: true } },
};
