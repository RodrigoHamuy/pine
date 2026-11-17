import { useLayoutEffect, useRef } from "react";

/**
 * Something is at work: a green dot that breathes. `size` is the room it stands in (an icon's),
 * so that what it takes the place of does not move. Every such dot on screen breathes in step,
 * whenever it appeared: each one's animation is set to have begun when the page did.
 */
export function Pulse({ size = 14 }: { size?: number }) {
	const dot = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		for (const breath of dot.current?.getAnimations() ?? []) breath.startTime = 0;
	}, []);
	const d = Math.min(9, Math.max(6, Math.round(size * 0.6)));
	return (
		<span className="pulse" style={{ width: size, height: size }} aria-label="working">
			<span ref={dot} style={{ width: d, height: d }} />
		</span>
	);
}
