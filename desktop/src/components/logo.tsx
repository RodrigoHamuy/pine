import { cn } from "@/lib/utils";

/** pine's mark: the P of its wordmark (docs/images/logo-dark.svg), four blocks on a grid. Sized by `className` (`size-*`). */
export function Logo({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 800 800" fill="currentColor" aria-hidden="true" className={cn("size-4.5 shrink-0 text-foreground", className)}>
			<rect x="280" y="560" width="240" height="240" />
			<rect x="280" y="280" width="240" height="240" />
			<rect x="0" y="280" width="240" height="240" />
			<path d="M560 0H280V240H560V520H800V0H560Z" />
		</svg>
	);
}
