import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Switch } from "../ui.tsx";

const meta = {
	component: Switch,
	args: { on: false, onChange: () => {} },
	// Controlled: the story keeps the state so that a click flips it.
	render: function Render(args) {
		const [on, setOn] = useState(args.on);
		return <Switch {...args} on={on} onChange={setOn} />;
	},
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = { args: { on: true } };

export const DisabledOff: Story = { args: { disabled: true } };

export const DisabledOn: Story = { args: { on: true, disabled: true } };
