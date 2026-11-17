import { type ReactNode } from "react";
import { FieldDescription, FieldLabel, Field as UiField } from "@ui-sdk/react/field";

// The field is a <label> around its control, so a native input or select is named by nesting; ui-sdk's
// controls (switch, segmented control) are named by the field itself.
export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
	return (
		<UiField render={<label />} className={`field${wide ? " field-wide" : ""}`}>
			<FieldLabel render={<span />} className="field-label">
				{label}
			</FieldLabel>
			{children}
			{hint ? <FieldDescription render={<span />} className="field-hint">{hint}</FieldDescription> : null}
		</UiField>
	);
}
