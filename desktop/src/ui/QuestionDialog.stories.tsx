import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuestionDialog } from "../App.tsx";

const meta = {
	component: QuestionDialog,
	parameters: { layout: "fullscreen" },
	args: { req: { id: "q1", agent: "main", task: 12, tool: "question", summary: "Which database?", why: "", expires: 0, choices: ["the old one", "the new one"] } },
} satisfies Meta<typeof QuestionDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Dark: Story = { globals: { theme: "dark" } };
