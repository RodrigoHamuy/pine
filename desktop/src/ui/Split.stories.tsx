import type { Meta, StoryObj } from "@storybook/react-vite";
import { Split } from "../ui.tsx";

const meta = {
	component: Split,
	args: {
		id: "story",
		label: "Resize side bar",
		side: "start",
		pane: <div style={{ padding: 12 }}>Side bar</div>,
		width: 220,
		min: 160,
		max: 360,
		restMin: 200,
		className: "split",
		children: <div style={{ padding: 12 }}>The rest</div>,
	},
	decorators: [
		(Story) => (
			<div style={{ display: "flex", height: 240 }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof Split>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Start: Story = {};

export const End: Story = { args: { id: "story-end", label: "Resize code panel", side: "end", pane: <div style={{ padding: 12 }}>Code panel</div> } };

export const WithoutPane: Story = { args: { pane: null } };
