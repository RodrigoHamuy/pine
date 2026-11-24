import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "./agent-avatar.tsx";
import { AgentColorPicker, AgentNameInput } from "./agent-identity.tsx";

// An agent's color and name, changed where they are shown: the color on its avatar, the name in place.
const meta = { title: "Components/AgentIdentity", component: AgentColorPicker } satisfies Meta<typeof AgentColorPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

const avatarButton = (id: string) => <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Color of ${id}`} />;

/** The color of an agent in coral, open: None, the presets drawn as its avatar would be, and Other. */
export const ColorPicker: Story = {
	args: { agent: { id: "scout", color: "#e0805a" }, onChange: fn(), trigger: avatarButton("scout"), open: true },
	render: (args) => {
		const [color, setColor] = useState(args.agent.color);
		return (
			<AgentColorPicker {...args} agent={{ ...args.agent, color }} onChange={(c) => (setColor(c === "none" ? undefined : c), args.onChange(c))}>
				<AgentAvatar agent={{ id: args.agent.id, color }} />
			</AgentColorPicker>
		);
	},
};

/** An agent without a color of its own: None is chosen, and Other shows a neutral grey. */
export const ColorPickerNone: Story = {
	args: { agent: { id: "main" }, onChange: fn(), trigger: avatarButton("main"), open: true },
	render: (args) => (
		<AgentColorPicker {...args}>
			<AgentAvatar agent={args.agent} />
		</AgentColorPicker>
	),
};

/** The name made editable, as a click on it on the agent's page or Rename in the side bar does. */
export const NameInput: Story = {
	args: { agent: { id: "scout" }, onChange: fn(), trigger: avatarButton("scout") },
	render: () => <AgentNameInput id="scout" className="max-w-60" onDone={fn()} />,
};

/** A name that cannot be an agent's id ("-" first) is marked, and leaving the field sends nothing. */
export const NameInputInvalid: Story = {
	args: { agent: { id: "scout" }, onChange: fn(), trigger: avatarButton("scout") },
	render: () => <AgentNameInput id="-scout" className="max-w-60" onDone={fn()} />,
};
