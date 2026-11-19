import { type ComponentProps, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Something going on (an agent at work, a page loading): a small grey dot that fades out and in, in
 * place of the stock spinner. Every dot in the window is in step, however late it came: its fade is
 * started at the beginning of the page's timeline, so all of them are at the same point of the beat.
 */
export function Pulse({ className, label = "Working", ...props }: ComponentProps<"span"> & { label?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		for (const a of ref.current?.getAnimations?.() ?? []) a.startTime = 0;
	}, []);
	return <span ref={ref} data-slot="pulse" role="status" aria-label={label} className={cn("inline-block size-2 shrink-0 animate-pulse rounded-full bg-muted-foreground", className)} {...props} />;
}
