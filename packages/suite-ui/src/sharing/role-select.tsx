// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { RadioGroup } from "radix-ui";
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
}

export function RoleSelect({ value, onChange, options = {} }: RoleSelectProps) {
  const id = useId();
  return (
    <fieldset className="su-fieldset su-stack">
      <legend className="su-label">Role</legend>
      <RadioGroup.Root
        className="su-role-list"
        value={value}
        onValueChange={(next) => onChange(next as SharingRole)}
        aria-label="Role"
      >
        {sharingRoles.map((role) => {
          const option = options[role.value];
          return (
            <div className="su-role" key={role.value}>
              <RadioGroup.Item
                className="su-radio"
                id={`${id}-${role.value}`}
                value={role.value}
                disabled={option?.disabled}
                title={option?.disabled ? option.reason : undefined}
                aria-labelledby={`${id}-${role.value}-label`}
                aria-describedby={`${id}-${role.value}-description`}
              >
                <RadioGroup.Indicator className="su-radio-dot" />
              </RadioGroup.Item>
              <label htmlFor={`${id}-${role.value}`}>
                <strong id={`${id}-${role.value}-label`}>{role.label}</strong>
                <span className="su-muted" id={`${id}-${role.value}-description`}>
                  {role.description}
                  {option?.disabled && <> · {option.reason}</>}
                </span>
              </label>
            </div>
          );
        })}
      </RadioGroup.Root>
    </fieldset>
  );
}
