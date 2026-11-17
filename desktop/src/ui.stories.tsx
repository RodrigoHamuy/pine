import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Ask, AutoText, Button, Choices, Confirm, Dialog, Empty, Field, Icon, Lightbox, Logo, Pick, type PickRow, Pulse, Segmented, Select, Switch, Toasts, toast } from "./ui.tsx";

const meta: Meta = { title: "UI" };
export default meta;
type Story = StoryObj;

const ICONS = ["plus", "x", "check", "gear", "folder", "file", "branch", "terminal", "play", "stop", "search", "copy", "alert", "trash", "edit", "clock", "shield", "chat", "book", "mic"];

export const Icons: Story = {
	render: () => (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 12, maxWidth: 360 }}>
			{ICONS.map((name) => (
				<span key={name} title={name}>
					<Icon name={name} />
				</span>
			))}
		</div>
	),
};

export const LogoMark: Story = { render: () => <Logo size={48} /> };

// The dot breathes; Chromatic pauses CSS animations at their end, so the snapshot is steady.
export const Working: Story = { render: () => <Pulse size={20} /> };

export const Buttons: Story = {
	render: () => (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<div style={{ display: "flex", gap: 8 }}>
				<Button variant="primary">Save</Button>
				<Button>Cancel</Button>
				<Button variant="ghost">More</Button>
				<Button variant="danger">Remove</Button>
			</div>
			<div style={{ display: "flex", gap: 8 }}>
				<Button variant="primary" icon="plus" small>
					New
				</Button>
				<Button icon="refresh" small>
					Reload
				</Button>
				<Button icon="gear" title="Settings" />
				<Button disabled>Disabled</Button>
			</div>
		</div>
	),
};

function SwitchDemo({ initial, disabled }: { initial: boolean; disabled?: boolean }) {
	const [on, setOn] = useState(initial);
	return <Switch on={on} onChange={setOn} disabled={disabled} />;
}

export const Switches: Story = {
	render: () => (
		<div style={{ display: "flex", gap: 16 }}>
			<SwitchDemo initial={false} />
			<SwitchDemo initial />
			<SwitchDemo initial={false} disabled />
			<SwitchDemo initial disabled />
		</div>
	),
};

function SegmentedDemo() {
	const [value, setValue] = useState<"chat" | "code" | "events">("chat");
	return (
		<Segmented
			value={value}
			onChange={setValue}
			options={[
				{ value: "chat", label: "Chat", icon: "chat" },
				{ value: "code", label: "Code", icon: "branch", badge: 3 },
				{ value: "events", label: "Events", icon: "bolt" },
			]}
		/>
	);
}

export const SegmentedControl: Story = { render: () => <SegmentedDemo /> };

function AutoTextDemo({ initial, mono }: { initial: string; mono?: boolean }) {
	const [value, setValue] = useState(initial);
	return <AutoText value={value} onChange={setValue} mono={mono} placeholder="Type here" />;
}

export const Fields: Story = {
	render: () => (
		<div style={{ display: "grid", gap: 16, width: 420 }}>
			<Field label="Name" hint="What the agent is called in lists.">
				<input className="input" defaultValue="main" />
			</Field>
			<Field label="Instructions" wide>
				<AutoTextDemo initial={"You look after the house.\nSay what you saw."} />
			</Field>
			<Field label="Command">
				<AutoTextDemo initial="npm test" mono />
			</Field>
		</div>
	),
};

export const EmptyState: Story = {
	render: () => (
		<Empty icon="chat" title="No conversation yet">
			Write a message to begin.
		</Empty>
	),
};

export const ConfirmButton: Story = {
	render: () => (
		<div style={{ display: "flex", gap: 8 }}>
			<Confirm label="Remove" onConfirm={() => {}} />
			<Confirm label="Remove" icon="trash" onConfirm={() => {}} />
		</div>
	),
};

export const DialogPlain: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<Dialog
			title="Rename the conversation"
			onClose={() => {}}
			footer={
				<>
					<Button>Cancel</Button>
					<Button variant="primary">Rename</Button>
				</>
			}
		>
			<Field label="Name">
				<input className="input" defaultValue="Morning check" />
			</Field>
		</Dialog>
	),
};

export const DialogWarn: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<Dialog
			tone="warn"
			title="Allow this command?"
			footer={
				<>
					<Button>No</Button>
					<Button variant="primary">Yes, once</Button>
				</>
			}
		>
			<p>The agent wants to run a command outside its sandbox.</p>
		</Dialog>
	),
};

export const DialogAccent: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<Dialog tone="accent" title="A newer Pine is out" width={420}>
			<p>Version 0.40.0 can be downloaded from GitHub.</p>
		</Dialog>
	),
};

function SelectDemo() {
	const [value, setValue] = useState("sonnet");
	return (
		<Field label="Model">
			<Select value={value} onChange={setValue} options={[{ value: "opus", label: "Opus" }, { value: "sonnet", label: "Sonnet" }, { value: "haiku", label: "Haiku" }]} />
		</Field>
	);
}

export const SelectClosed: Story = { render: () => <SelectDemo /> };

// Opened by a click, as a user would: the list shows under the trigger, the current value checked.
export const SelectOpen: Story = {
	parameters: { layout: "padded" },
	render: () => <SelectDemo />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox"));
		await expect(await within(document.body).findByRole("listbox")).toBeVisible();
	},
};

// Each toast stays until dismissed, so the snapshot does not race a timer.
function ToastsDemo() {
	useLayoutEffect(() => {
		toast.dismiss();
		toast({ title: "Saved the settings.", duration: Infinity });
		toast.success({ title: "The agent is back.", duration: Infinity });
		toast.error({ title: "The daemon could not be reached.", duration: Infinity });
		return () => toast.dismiss();
	}, []);
	return <Toasts />;
}

export const ToastMessages: Story = { parameters: { layout: "fullscreen" }, render: () => <ToastsDemo /> };

const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#2f6f4f"/><circle cx="240" cy="160" r="90" fill="#f2efe6"/></svg>')}`;

export const LightboxPicture: Story = {
	parameters: { layout: "fullscreen" },
	render: () => <Lightbox src={PICTURE} onClose={() => {}} />,
};

export const AskQuestion: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<Ask title="Leave without saving?" yes="Leave" no="Stay" onAnswer={() => {}}>
			<p>The changes to settings.json will be lost.</p>
		</Ask>
	),
};

const ROWS: PickRow[] = [
	{ value: "new", label: "New conversation", keys: "N", group: "Conversations" },
	{ value: "rename", label: "Rename the conversation", group: "Conversations", current: true },
	{ value: "settings", label: "Settings", about: "Models, tools, the sandbox", keys: ",", group: "App" },
	{ value: "quit", label: "Stop the daemon", about: "Every agent stops", group: "App", bad: true },
];

function PickDemo() {
	const [query, setQuery] = useState("");
	const rows = ROWS.filter((r) => String(r.label).toLowerCase().includes(query.toLowerCase()));
	return <Pick title="Commands" label="Search commands" placeholder="Type a command" rows={rows} query={query} onQuery={setQuery} initial="settings" onChoose={() => {}} onClose={() => {}} />;
}

// `initial` highlights a row of the second group.
export const PickList: Story = { parameters: { layout: "fullscreen" }, render: () => <PickDemo /> };

function ChoicesDemo() {
	const [at, setAt] = useState<number | null>(1);
	return (
		<div style={{ width: 360 }}>
			<Choices label="How to go on" choices={["Run the tests first", "Ship it as it is", "Ask the reviewer"]} at={at} onAt={setAt} onChoose={setAt} />
		</div>
	);
}

export const ChoicesGroup: Story = { render: () => <ChoicesDemo /> };
