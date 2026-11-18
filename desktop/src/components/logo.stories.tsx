import type { Meta, StoryObj } from "@storybook/react-vite";
import { Logo as Mark } from "./logo.tsx";

// pine's mark, sized by `className`.
const meta = { title: "Components/Logo", component: Mark } satisfies Meta<typeof Mark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Logo: Story = { args: {} };

export const LogoLarge: Story = { args: { className: "size-12" } };
