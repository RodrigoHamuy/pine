import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApprovalDialog } from "../App.tsx";

const meta = {
	component: ApprovalDialog,
	parameters: { layout: "fullscreen" },
	args: { req: { id: "a1", agent: "main", task: 12, tool: "bash", summary: "echo hello", why: "bash is on your approve list.", expires: 0, remember: "bash" } },
} satisfies Meta<typeof ApprovalDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Dark: Story = { globals: { theme: "dark" } };

/** Something only the owner has, typed here and sent to the daemon alone. */
export const WithSecret: Story = {
	args: { req: { id: "a2", agent: "main", task: 13, tool: "add_source", summary: "telegram source: chat with you", why: "it needs a token.", expires: 0, inputs: [{ name: "TELEGRAM_TOKEN", label: "TELEGRAM_TOKEN: the bot's token from @BotFather" }] } },
};
