import type { Meta, StoryObj } from "@storybook/react-vite";
import { Ask } from "./Ask.tsx";

const meta = {
	component: Ask,
	parameters: { layout: "fullscreen" },
	args: {
		title: "Leave without saving?",
		yes: "Leave",
		no: "Stay",
		onAnswer: () => {},
		children: <p>The changes to settings.json will be lost.</p>,
	},
} satisfies Meta<typeof Ask>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
