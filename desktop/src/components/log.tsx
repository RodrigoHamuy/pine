import type * as React from "react";
import { ScrollFadeArea } from "@/components/scroll-fade-area";
import { cn } from "@/lib/utils";

/**
 * What a command printed, as text: monospace, kept as it was written, wrapped anywhere, selectable.
 * It takes the colour of what holds it. The `log` class is what the app's tests look for.
 *
 * Why not stock CodeBlock: it draws a border and a focus ring, makes its text a tab stop, and
 * scrolls sideways; a log here sits on the sunk background and scrolls down within a height.
 */
export function LogText({ className, ...props }: React.ComponentProps<"pre">) {
	return <pre className={cn("log px-3 py-2.5 font-mono text-xs whitespace-pre-wrap wrap-anywhere select-text", className)} {...props} />;
}

/** A log on the sunk background, scrolled when it is long. `className` goes to the box (a `max-h-*` replaces the default). */
export function Log({ className, children }: { className?: string; children: React.ReactNode }) {
	return (
		<ScrollFadeArea className={cn("max-h-60 rounded-md bg-sunk text-muted-foreground", className)}>
			<LogText>{children}</LogText>
		</ScrollFadeArea>
	);
}
