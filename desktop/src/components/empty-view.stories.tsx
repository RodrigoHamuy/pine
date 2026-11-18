import { MessageSquareIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyView as View } from "./empty-view.tsx";

// A view with nothing in it: an icon, a title and what to do.
const meta = { title: "Components/EmptyView", component: View } satisfies Meta<typeof View>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyView: Story = { args: { icon: MessageSquareIcon, title: "No conversation yet", children: "Write a message to begin." } };

export const EmptyViewTitleOnly: Story = { args: { title: "No conversation yet" } };
