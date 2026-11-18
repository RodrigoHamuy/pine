import type * as React from "react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Stock ScrollArea with shadcn's scroll-fade utility on the part that scrolls.
 *
 * Why this exists: scroll-fade has to sit on the element that scrolls (it is a mask driven by
 * `animation-timeline: scroll(self)`), and stock ScrollArea hands `className` to its Root, not to
 * its Viewport. The one way to reach the Viewport is a `[data-slot]` variant from the Root, aimed at
 * its direct child only so that a ScrollArea inside another is left alone. It is written here once.
 *
 * - `axis`: `"y"` (the default) fades top and bottom; `"x"` fades the start and end and scrolls
 *   sideways; `"both"` fades top and bottom and scrolls both ways (a diff wider than the panel).
 *   A sideways bar is drawn only where `bar` is not false: a row of tabs scrolls without one.
 * - `viewportRef`: the element that scrolls, for code that reads or sets where it is scrolled to.
 * - `className` goes to the Root, which takes the place of the old scrolling box in its layout.
 *   The Root is a flex column, so that its Viewport (a scroll container, whose least height is
 *   none) shrinks to a `max-h-*` on the Root: with a block Root its `size-full` would follow the
 *   content past it.
 * - Children go straight into the Viewport: what needs a flex column (an Empty centred with
 *   `m-auto`) brings its own `flex min-h-full flex-col` box.
 */
export function ScrollFadeArea({ axis = "y", bar = true, viewportRef, className, children, ...props }: React.ComponentProps<typeof ScrollArea> & { axis?: "x" | "y" | "both"; bar?: boolean; viewportRef?: React.Ref<HTMLDivElement | null> }) {
	const root = (el: HTMLDivElement | null) => {
		if (!viewportRef) return;
		const viewport = (el?.querySelector(":scope > [data-slot=scroll-area-viewport]") as HTMLDivElement | null) ?? null;
		if (typeof viewportRef === "function") viewportRef(viewport);
		else viewportRef.current = viewport;
	};
	return (
		<ScrollArea ref={root} className={cn("flex min-h-0 flex-col", axis === "x" ? "*:data-[slot=scroll-area-viewport]:scroll-fade-x" : "*:data-[slot=scroll-area-viewport]:scroll-fade", className)} {...props}>
			{children}
			{axis !== "y" && bar ? <ScrollBar orientation="horizontal" /> : null}
		</ScrollArea>
	);
}
