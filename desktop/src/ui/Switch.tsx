import { SwitchThumb, Switch as UiSwitch } from "@ui-sdk/react/switch";

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
	return (
		<UiSwitch checked={on} onCheckedChange={(next) => onChange(next)} disabled={disabled} className="switch">
			<SwitchThumb className="switch-thumb" />
		</UiSwitch>
	);
}
