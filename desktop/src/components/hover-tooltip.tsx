import type { ComponentProps } from "react";
import { useMediaQuery } from "usehooks-ts";
import { Tooltip } from "@/components/ui/tooltip";

/** A primary pointer that can hover: a mouse or a trackpad, not a finger. */
export const CAN_HOVER = "(hover: hover)";

/**
 * The stock tooltip, on a device whose primary pointer hovers and nowhere else. Base UI opens a
 * tooltip on hover only for a mouse, but also on a focus the browser counts as visible, and a phone's
 * WebView counts a focus a script moves as visible (a sheet that opens puts focus on its first
 * button). With no hover to leave, the tooltip then stays over the page. A touch screen has the
 * button's label, and gets no tooltip.
 */
export function HoverTooltip({ disabled, ...props }: ComponentProps<typeof Tooltip>) {
	const hover = useMediaQuery(CAN_HOVER);
	return <Tooltip disabled={disabled || !hover} {...props} />;
}
