// The small parts of pine's own that everything else is built from, on shadcn's components: the
// logo, an empty view, and loading what a view shows.
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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

/**
 * A view with nothing in it: stock Empty, its icon, title and what to do. One line for the twenty
 * places that say so, each with an icon, a title and at most a sentence.
 */
export function EmptyView({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
	return (
		<Empty>
			<EmptyHeader>
				{Icon ? (
					<EmptyMedia variant="icon">
						<Icon />
					</EmptyMedia>
				) : null}
				<EmptyTitle>{title}</EmptyTitle>
				{children ? <EmptyDescription>{children}</EmptyDescription> : null}
			</EmptyHeader>
		</Empty>
	);
}

/** Load something when the part appears, and again when `reload` is called or a dependency changes. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): { data?: T; error?: string; loading: boolean; reload: () => void } {
	const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
	const [tick, setTick] = useState(0);
	useEffect(() => {
		let live = true;
		setState((s) => ({ ...s, loading: true }));
		load().then(
			(data) => live && setState({ data, loading: false }),
			(e) => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }),
		);
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...deps, tick]);
	return { ...state, reload: () => setTick((t) => t + 1) };
}
