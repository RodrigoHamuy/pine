import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AutoText } from "../ui.tsx";

const meta = {
	component: AutoText,
	args: { value: "You look after the house.\nSay what you saw.", onChange: () => {}, placeholder: "Type here" },
	decorators: [(Story) => <div style={{ width: 420 }}><Story /></div>],
	// Controlled: the story keeps the text so that typing grows the field.
	render: function Render(args) {
		const [value, setValue] = useState(args.value);
		return <AutoText {...args} value={value} onChange={setValue} />;
	},
} satisfies Meta<typeof AutoText>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { value: "" } };

export const Mono: Story = { args: { value: "npm test", mono: true } };
