// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Check } from "lucide-react";
import { AlertDialog, Checkbox } from "radix-ui";
import { type ButtonHTMLAttributes, type ReactNode, type RefObject, useId, useRef } from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`su-button ${className}`} {...props} />;
}

export function CheckField({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean | "indeterminate";
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="su-check-field" htmlFor={id}>
      <Checkbox.Root
        id={id}
        className="su-checkbox"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      >
        <Checkbox.Indicator>
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span>{children}</span>
    </label>
  );
}

export function ConfirmAction({
  trigger,
  title,
  description,
  action,
  cancel = "Cancel",
  onConfirm,
  disabled = false,
  destructive = true,
  closeFocusFallback,
}: {
  trigger: string;
  title: string;
  description: string;
  action: string;
  cancel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  destructive?: boolean;
  closeFocusFallback?: RefObject<HTMLElement | null>;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild ref={triggerRef}>
        <Button disabled={disabled} className={destructive ? "su-destructive" : ""}>
          {trigger}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="su-overlay" />
        <AlertDialog.Content
          className="su-confirm su-stack"
          onCloseAutoFocus={(event) => {
            if (triggerRef.current?.disabled && closeFocusFallback?.current) {
              event.preventDefault();
              closeFocusFallback.current.focus();
            }
          }}
        >
          <AlertDialog.Title className="su-title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="su-muted">{description}</AlertDialog.Description>
          <div className="su-equal-actions">
            <AlertDialog.Cancel asChild>
              <Button>{cancel}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                className="su-destructive"
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onConfirm();
                }}
              >
                {action}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
