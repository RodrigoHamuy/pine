import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Choices } from "./Choices.tsx";

const meta = {
	component: Choices,
	args: {
		label: "How to go on",
		choices: ["Run the tests first", "Ship it as it is", "Ask the reviewer"],
		at: null,
		onAt: () => {},
		onChoose: () => {},
	},
	decorators: [
		(Story) => (
			<div style={{ width: 360 }}>
				<Story />
			</div>
		),
	],
	// Controlled: the story keeps the state so that a click moves the choice.
	render: function Render(args) {
		const [at, setAt] = useState(args.at);
		return <Choices {...args} at={at} onAt={setAt} onChoose={setAt} />;
	},
} satisfies Meta<typeof Choices>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoneChosen: Story = {};

export const SecondChosen: Story = { args: { at: 1 } };
