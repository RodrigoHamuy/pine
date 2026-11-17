import { type ButtonHTMLAttributes } from "react";
import { type IconName, Icon } from "./Icon.tsx";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "plain"; icon?: IconName | string; small?: boolean };

export function Button({ variant = "plain", icon, small, className, children, ...rest }: ButtonProps) {
	return (
		<button type="button" className={`btn btn-${variant}${small ? " btn-small" : ""}${children ? "" : " btn-icon"}${className ? ` ${className}` : ""}`} {...rest}>
			{icon ? <Icon name={icon} size={small ? 14 : 16} /> : null}
			{children}
		</button>
	);
}
