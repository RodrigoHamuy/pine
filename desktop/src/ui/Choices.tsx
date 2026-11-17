import { type ReactNode } from "react";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";

/**
 * Answers to choose one of, a radio group: the marked one is `at`, the arrows move the mark once it
 * has focus, and a click or Enter on one chooses it.
 */
export function Choices({ label, choices, at, onAt, onChoose }: { label: string; choices: ReactNode[]; at: number | null; onAt: (i: number) => void; onChoose: (i: number) => void }) {
	return (
		<RadioGroup className="pick-list" style={{ padding: 0 }} aria-label={label} value={at === null ? null : String(at)} onValueChange={(v) => v !== null && onAt(Number(v))}>
			{choices.map((c, i) => (
				<Radio key={i} value={String(i)} className="pick-item" onMouseMove={() => at !== i && onAt(i)} onClick={() => onChoose(i)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onChoose(i))}>
					{c}
				</Radio>
			))}
		</RadioGroup>
	);
}
