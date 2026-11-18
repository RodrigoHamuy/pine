import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { Lightbox as Dialog } from "./Lightbox.tsx";

// A picture of 120 by 80, drawn here: the page loads nothing from the web.
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#5de4c7"/><circle cx="240" cy="160" r="90" fill="#1b1e28"/></svg>')}`;

// It opens when a picture of the conversation asks for it, as a click on one does.
function ZoomedLightbox() {
	useEffect(() => void window.dispatchEvent(new CustomEvent("pine:zoom", { detail: PICTURE })), []);
	return <Dialog />;
}

// No docs page: it would open every story's picture at once, one over the other.
const meta = { component: ZoomedLightbox, tags: ["!autodocs"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof ZoomedLightbox>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Lightbox: Story = {};

export const LightboxDark: Story = { globals: { theme: "dark" } };
