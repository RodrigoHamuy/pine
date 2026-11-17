import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, LabeledField } from "../ui.tsx";

const meta = {
	component: Dialog,
	parameters: { layout: "fullscreen" },
	args: {
		title: "Rename the conversation",
		onClose: () => {},
		footer: (
			<>
				<Button variant="outline">Cancel</Button>
				<Button>Rename</Button>
			</>
		),
		children: (
			<LabeledField label="Name">
				<Input defaultValue="Morning check" />
			</LabeledField>
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
				<Button variant="outline">No</Button>
				<Button>Yes, once</Button>
			</>
		),
		children: <p>The agent wants to run a command outside its sandbox.</p>,
	},
};

export const Accent: Story = {
	args: { tone: "accent", title: "A newer Pine is out", width: 420, footer: undefined, children: <p>Version 0.40.0 can be downloaded from GitHub.</p> },
};
