import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Segmented } from "./Segmented.tsx";

const meta = {
	component: Segmented,
	args: {
		value: "chat",
		onChange: () => {},
		options: [
			{ value: "chat", label: "Chat" },
			{ value: "code", label: "Code" },
			{ value: "events", label: "Events" },
		],
	},
	render: function Render(args) {
		const [value, setValue] = useState(args.value);
		return <Segmented {...args} value={value} onChange={setValue} />;
	},
} satisfies Meta<typeof Segmented<string>>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIconsAndBadge: Story = {
	args: {
		options: [
			{ value: "chat", label: "Chat", icon: "chat" },
			{ value: "code", label: "Code", icon: "branch", badge: 3 },
			{ value: "events", label: "Events", icon: "bolt" },
		],
	},
};
