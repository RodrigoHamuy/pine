import { useLayoutEffect, useRef } from "react";

/** A text field that grows with what is typed into it. */
export function AutoText({ value, onChange, minRows = 3, maxRows = 24, mono, ...rest }: { value: string; onChange: (v: string) => void; minRows?: number; maxRows?: number; mono?: boolean } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
		el.style.height = `${Math.min(Math.max(el.scrollHeight + 2, minRows * line + 18), maxRows * line + 18)}px`;
	}, [value, minRows, maxRows]);
	return <textarea ref={ref} className={`input${mono ? " mono" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} {...rest} />;
}
