import { createToaster, Toast, ToastRegion, ToastTitle } from "@ui-sdk/react/toast";

/** The app's passing messages: `toast()` says one from anywhere, the one `Toasts` region shows it. */
export const toast = createToaster();

/** Where toasts show, each announced to screen readers once. */
export function Toasts() {
	return (
		<ToastRegion toaster={toast} className="toasts" side="bottom" align="center" maxVisible={4} expanded>
			{() => (
				<Toast className="toast">
					<ToastTitle />
				</Toast>
			)}
		</ToastRegion>
	);
}
