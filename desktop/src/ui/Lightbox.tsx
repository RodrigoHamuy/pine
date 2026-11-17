import { Dialog as UiDialog, DialogContent } from "@ui-sdk/react/dialog";

/**
 * A picture over the whole page, open while `src` is set. Escape and a press anywhere close it,
 * and focus goes back to `from`, the picture it was opened from.
 */
export function Lightbox({ src, from, onClose }: { src?: string; from?: HTMLElement | null; onClose: () => void }) {
	return (
		<UiDialog open={Boolean(src)} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="lightbox" aria-label="Picture" finalFocus={from ?? undefined} onClick={onClose}>
				<img src={src} alt="" />
			</DialogContent>
		</UiDialog>
	);
}
