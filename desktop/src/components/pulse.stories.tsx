import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pulse as Dot } from "./pulse.tsx";

// Work going on: a grey dot that fades out and in, every one in step.
const meta = { title: "Components/Pulse", component: Dot } satisfies Meta<typeof Dot>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Pulse: Story = { args: {} };

/** Beside a line of text, as under a conversation while its agent works. */
export const PulseInLine: Story = {
	args: {},
	render: (args) => (
		<div className="flex flex-col gap-2 text-sm text-muted-foreground">
			<span className="flex items-center gap-2"><Dot {...args} />working · 12s</span>
			<span className="flex items-center gap-2"><Dot {...args} />another conversation, in step with the first</span>
		</div>
	),
};
