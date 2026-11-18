import type { Meta, StoryObj } from "@storybook/react-vite";
import { Palette } from "../App.tsx";

// The palette lists what the app has: here, without a daemon, its commands and the settings' pages.
const meta = { component: Palette, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Palette>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Dark: Story = { globals: { theme: "dark" } };
