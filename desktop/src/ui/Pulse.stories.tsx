import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pulse } from "../ui.tsx";

// The dot breathes; Chromatic pauses CSS animations at their end, so the snapshot is steady.
const meta = { component: Pulse, args: { size: 14 } } satisfies Meta<typeof Pulse>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = { args: { size: 20 } };
