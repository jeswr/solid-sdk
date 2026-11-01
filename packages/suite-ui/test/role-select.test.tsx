// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RoleSelect } from "../src/sharing/role-select.js";

afterEach(cleanup);
it("supports a named, disabled row and a restricted role menu with removal", () => {
  const onRemove = vi.fn();
  const onChange = vi.fn();
  const view = render(
    <RoleSelect
      label="Role for Sage"
      value="viewer"
      roles={["viewer", "editor"]}
      disabled
      onChange={onChange}
      onRemove={onRemove}
    />,
  );
  expect(
    (screen.getByRole("combobox", { name: "Role for Sage" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  view.rerender(
    <RoleSelect
      label="Role for Sage"
      value="viewer"
      roles={["viewer", "editor"]}
      onChange={onChange}
      onRemove={onRemove}
    />,
  );
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  expect(screen.queryByRole("option", { name: "Manager" })).toBeNull();
  expect(screen.queryByRole("option", { name: "Commenter" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "Remove access" }));
  expect(onRemove).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
});
