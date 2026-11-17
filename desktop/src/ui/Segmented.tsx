import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { Icon } from "./Icon.tsx";

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; icon?: string; badge?: number }>; onChange: (v: T) => void }) {
	return (
		<SegmentedControl className="segmented" value={value} onValueChange={(next) => next !== null && onChange(next as T)}>
			{options.map((o) => (
				<SegmentedControlItem key={o.value} value={o.value}>
					{o.icon ? <Icon name={o.icon} size={14} /> : null}
					{o.label}
					{o.badge ? <span className="badge">{o.badge}</span> : null}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}
