// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select } from "radix-ui";
import { useId } from "react";

export type SharingRole = "viewer" | "commenter" | "editor" | "manager";
export const sharingRoles = [
  { value: "viewer", label: "Viewer", description: "Can see" },
  { value: "commenter", label: "Commenter", description: "Can comment" },
  { value: "editor", label: "Editor", description: "Can change" },
  { value: "manager", label: "Manager", description: "Can manage access" },
] as const;
export type DisabledReason =
  | { disabled: true; reason: string }
  | { disabled?: false; reason?: never };

export interface RoleSelectProps {
  value: SharingRole;
  onChange: (role: SharingRole) => void;
  options?: Partial<Record<SharingRole, DisabledReason>>;
  roles?: readonly SharingRole[];
  disabled?: boolean;
  label?: string;
  onRemove?: () => void;
}

export function RoleSelect({
  value,
  onChange,
  options = {},
  roles,
  disabled = false,
  label = "Role",
  onRemove,
}: RoleSelectProps) {
  const id = useId();
  return (
    <div className="su-stack">
      <label className="su-label" htmlFor={id}>
        {label}
      </label>
      <Select.Root
        disabled={disabled}
        value={value}
        onValueChange={(next) =>
          next === "remove-access" ? onRemove?.() : onChange(next as SharingRole)
        }
      >
        <Select.Trigger className="su-input su-role-trigger" id={id}>
          <Select.Value>{sharingRoles.find((role) => role.value === value)?.label}</Select.Value>
          <Select.Icon>
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="su-role-menu" position="popper" sideOffset={4}>
            <Select.Viewport>
              {sharingRoles
                .filter((role) => !roles || roles.includes(role.value))
                .map((role) => {
                  const option = options[role.value];
                  return (
                    <Select.Item
                      className="su-role-option"
                      value={role.value}
                      key={role.value}
                      disabled={option?.disabled ?? false}
                      title={option?.disabled ? option.reason : undefined}
                      aria-label={role.label}
                      aria-describedby={`${id}-${role.value}-description`}
                    >
                      <Select.ItemText>{role.label}</Select.ItemText>
                      <span className="su-muted" id={`${id}-${role.value}-description`}>
                        {role.description}
                        {option?.disabled && <> · {option.reason}</>}
                      </span>
                      <Select.ItemIndicator className="su-role-indicator">
                        <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                      </Select.ItemIndicator>
                    </Select.Item>
                  );
                })}
              {onRemove && (
                <Select.Item className="su-role-option su-error" value="remove-access">
                  <Select.ItemText>Remove access</Select.ItemText>
                </Select.Item>
              )}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
