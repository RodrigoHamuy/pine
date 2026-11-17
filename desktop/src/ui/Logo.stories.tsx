import type { Meta, StoryObj } from "@storybook/react-vite";
import { Logo } from "./Logo.tsx";

const meta = { component: Logo, args: { size: 18 } } satisfies Meta<typeof Logo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = { args: { size: 48 } };
