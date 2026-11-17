import { MessageSquareIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Empty } from "../ui.tsx";

const meta = { component: Empty, args: { icon: MessageSquareIcon, title: "No conversation yet", children: "Write a message to begin." } } satisfies Meta<typeof Empty>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TitleOnly: Story = { args: { icon: undefined, children: undefined } };
