import type { Meta, StoryObj } from "@storybook/react-vite";
import { PickDialog } from "../App.tsx";

const meta = {
	component: PickDialog,
	parameters: { layout: "fullscreen" },
	args: {
		p: {
			title: "Model for main",
			placeholder: "Search models",
			current: "mock/m",
			items: [
				{ value: "mock/m", label: "mock/m" },
				{ value: "anthropic/claude", label: "anthropic/claude", about: "signed in" },
				{ value: "studio/qwen", label: "studio/qwen", about: "a model server of your own" },
			],
			done: () => {},
		},
	},
} satisfies Meta<typeof PickDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Dark: Story = { globals: { theme: "dark" } };

/** A long list gets a field that narrows it. */
export const Typed: Story = {
	args: { p: { title: "New conversation with", done: () => {}, items: ["main", "scout", "books", "home", "mail", "notes", "news", "garden"].map((id) => ({ value: id, label: id, about: `the agent ${id}` })) } },
};

/** A choice that cannot be taken back makes it an alert dialog. */
export const Removing: Story = {
	args: {
		p: {
			title: "Remove the agent spare?",
			done: () => {},
			items: [
				{ value: "erase", label: "Remove it with everything it has", about: "its 2 conversations, sources, schedules, servers, skills and its folder. This cannot be undone", tone: "bad" },
				{ value: "keep", label: "Remove it, but keep its folder", about: "the folder is moved to removed/ in pine's home" },
				{ value: "no", label: "Cancel" },
			],
		},
	},
};

export const RemovingDark: Story = { ...Removing, globals: { theme: "dark" } };
