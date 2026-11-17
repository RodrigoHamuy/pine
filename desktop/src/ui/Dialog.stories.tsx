import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Dialog, Field } from "../ui.tsx";

const meta = {
	component: Dialog,
	parameters: { layout: "fullscreen" },
	args: {
		title: "Rename the conversation",
		onClose: () => {},
		footer: (
			<>
				<Button>Cancel</Button>
				<Button variant="primary">Rename</Button>
			</>
		),
		children: (
			<Field label="Name">
				<input className="input" defaultValue="Morning check" />
			</Field>
		),
	},
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};

export const Warn: Story = {
	args: {
		tone: "warn",
		title: "Allow this command?",
		onClose: undefined,
		footer: (
			<>
				<Button>No</Button>
				<Button variant="primary">Yes, once</Button>
			</>
		),
		children: <p>The agent wants to run a command outside its sandbox.</p>,
	},
};

export const Accent: Story = {
	args: { tone: "accent", title: "A newer Pine is out", width: 420, footer: undefined, children: <p>Version 0.40.0 can be downloaded from GitHub.</p> },
};
