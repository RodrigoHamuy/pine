import { Trash2Icon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Confirm } from "../ui.tsx";

const meta = { component: Confirm, args: { label: "Remove", onConfirm: () => {} } } satisfies Meta<typeof Confirm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = { args: { icon: Trash2Icon } };
