import type { Meta, StoryObj } from "@storybook/react-vite";
import { Confirm } from "./Confirm.tsx";

const meta = { component: Confirm, args: { label: "Remove", onConfirm: () => {} } } satisfies Meta<typeof Confirm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = { args: { icon: "trash" } };
