import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "../ui.tsx";

const meta = {
	component: Field,
	args: { label: "Name", children: <input className="input" defaultValue="main" /> },
	decorators: [(Story) => <div style={{ width: 420 }}><Story /></div>],
} satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHint: Story = { args: { hint: "What the agent is called in lists." } };

export const Wide: Story = { args: { label: "Instructions", wide: true, children: <textarea className="input" rows={3} defaultValue="You look after the house." /> } };
