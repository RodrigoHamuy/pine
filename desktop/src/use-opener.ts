import { useState } from "react";

/**
 * What had focus when a dialog opened, to give it back when it closes. A dialog whose field takes focus
 * as it is drawn (autoFocus: the keys typed at once go there) would otherwise give it back to that field.
 */
export function useOpener(): () => HTMLElement | null {
	const [opener] = useState(() => document.activeElement as HTMLElement | null);
	return () => opener;
}
