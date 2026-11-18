import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** A picture of the conversation, larger, over the page. A click on it, beside it, or Escape closes it. */
export function Lightbox() {
	const [src, setSrc] = useState<string>();
	useEffect(() => {
		const show = (e: Event) => setSrc((e as CustomEvent<string>).detail);
		window.addEventListener("pine:zoom", show);
		return () => window.removeEventListener("pine:zoom", show);
	}, []);
	if (!src) return null;
	return (
		<Dialog open onOpenChange={(open) => open || setSrc(undefined)}>
			<DialogContent showCloseButton={false} className="flex max-h-11/12 w-auto max-w-11/12 flex-col items-center sm:max-w-11/12">
				<DialogTitle className="sr-only">The picture, larger</DialogTitle>
				<img src={src} alt="" className="min-h-0 max-w-full rounded-md object-contain" onClick={() => setSrc(undefined)} />
			</DialogContent>
		</Dialog>
	);
}
