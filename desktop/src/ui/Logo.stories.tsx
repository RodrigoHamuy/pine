import type { Meta, StoryObj } from "@storybook/react-vite";
import { Logo } from "../ui.tsx";

const meta = { component: Logo, args: {} } satisfies Meta<typeof Logo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = { args: { className: "size-12" } };
