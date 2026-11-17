import { useEffect, useState } from "react";
import { Button } from "./Button.tsx";

/** Ask twice before something that cannot be taken back: the first click arms the button, the second does it. */
export function Confirm({ label, sure = "Sure?", onConfirm, icon, small = true }: { label?: string; sure?: string; onConfirm: () => void; icon?: string; small?: boolean }) {
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!armed) return;
		const t = window.setTimeout(() => setArmed(false), 3000);
		return () => window.clearTimeout(t);
	}, [armed]);
	return (
		<Button
			small={small}
			variant={armed ? "danger" : "ghost"}
			icon={armed ? undefined : icon}
			title={label}
			onClick={(e) => {
				e.stopPropagation();
				if (armed) onConfirm();
				setArmed(!armed);
			}}
		>
			{armed ? sure : icon ? undefined : label}
		</Button>
	);
}
