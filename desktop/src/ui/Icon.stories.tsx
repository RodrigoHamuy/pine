import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "../ui.tsx";

const meta = { component: Icon, args: { name: "gear", size: 16 } } satisfies Meta<typeof Icon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = { args: { size: 32 } };

const NAMES = ["plus", "x", "check", "gear", "folder", "file", "branch", "terminal", "play", "stop", "search", "copy", "alert", "trash", "edit", "clock", "shield", "chat", "book", "mic"];

export const All: Story = {
	render: (args) => (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 12, maxWidth: 360 }}>
			{NAMES.map((name) => (
				<span key={name} title={name}>
					<Icon {...args} name={name} />
				</span>
			))}
		</div>
	),
};
