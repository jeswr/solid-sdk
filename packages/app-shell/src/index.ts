// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/app-shell — the suite's framework-agnostic React shell components.
// Public API barrel. The two P0 surfaces shipped here:
//  - Theme system: <ThemeProvider>, <ThemeToggle>, useTheme, themeScript.
//  - Account menu: <AccountMenu>, initials.
// The shadcn-compatible primitives are exported too for apps that want to build
// their own header chrome on the same Radix + token base.

export { AccountMenu, type AccountMenuProps, initials } from "./components/account-menu.js";
export {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  type ButtonProps,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/primitives.js";
export {
  type ResolvedTheme,
  type Theme,
  type ThemeContextValue,
  ThemeProvider,
  type ThemeProviderProps,
  themeScript,
  useTheme,
} from "./components/theme-provider.js";
export { ThemeToggle } from "./components/theme-toggle.js";
export { cn } from "./lib/cn.js";
