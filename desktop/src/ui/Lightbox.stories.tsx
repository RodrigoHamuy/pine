import type { Meta, StoryObj } from "@storybook/react-vite";
import { Lightbox } from "./Lightbox.tsx";

const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#2f6f4f"/><circle cx="240" cy="160" r="90" fill="#f2efe6"/></svg>')}`;

const meta = {
	component: Lightbox,
	parameters: { layout: "fullscreen" },
	args: { src: PICTURE, onClose: () => {} },
} satisfies Meta<typeof Lightbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
