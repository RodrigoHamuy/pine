import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Select } from "../ui.tsx";

const meta = {
	component: Select,
	args: {
		value: "sonnet",
		onChange: () => {},
		options: [
			{ value: "opus", label: "Opus" },
			{ value: "sonnet", label: "Sonnet" },
			{ value: "haiku", label: "Haiku" },
		],
	},
	// Controlled: the story keeps the state so that a choice sticks.
	render: function Render(args) {
		const [value, setValue] = useState(args.value);
		return <Select {...args} value={value} onChange={setValue} />;
	},
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

// Opened by a click, as a user would: the list shows under the trigger, the current value checked.
export const Open: Story = {
	parameters: { layout: "padded" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox"));
		await expect(await within(document.body).findByRole("listbox")).toBeVisible();
	},
};
