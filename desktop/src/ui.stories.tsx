import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AutoText, Button, Confirm, Dialog, Empty, Field, Icon, Logo, Pulse, Segmented, Switch } from "./ui.tsx";

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
