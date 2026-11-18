import type { Meta, StoryObj } from "@storybook/react-vite";
import { Palette as Dialog } from "./Palette.tsx";

// The palette lists what the app has: here, without a daemon, its commands and the settings' pages.
// No docs page: it would open every story's palette at once, one over the other.
const meta = { component: Dialog, tags: ["!autodocs"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof Dialog>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Palette: Story = {};
