---
name: app-session
description: Use when adopting or maintaining @jeswr/app-session shared browser sign-in wiring, React session context and login screens, or migrating copied suite app auth modules.
---
<!-- AUTHORED-BY GPT-6.1 Sol -->

Read [README.md](./README.md) for the three entry points and configuration seams.
Create `createAppPodAuth` once per page in an app-owned module. Keep bundler environment reads
in that module and the app entry; the library takes explicit options. Use `appUrl(path, base, origin?)`
for nested deployment bases. Pass appName and the application's exact obsolete credential keys to
`SessionProvider`; keep signed-in application UI and fetch threading in the app.

Use `/react`'s `SessionGate` inside the provider with `appName`, the configured `LoginScreen`
as `login`, and the signed-in UI as `children`. It owns the shared restore/startup/profile-loading
gate and mounts children only once both WebID and session exist. Use `renderLoading(label)`
for an accessible host spinner; the default is live status text. Keep the loading card's
`login-screen`, `login-card` and `login-sub` CSS hooks. `LoginScreen` resets its own fieldset
inline: hosts need no `.login-sign-in` CSS. Hosts load suite-ui tokens/theme/density/components
styles alongside their layout CSS.

Preserve the StrictMode holder, single restore promise, stale-operation fences and safe error
messages. Pass abort signals to login; cancellation never calls logout. Multiple WebID issuers require
explicit choice. Deep links suggest an account and never initiate login. Public profile data does
not grant credentials. Preserve pod-auth's automatic verified-storage boundary and pristine public
transport; consult [pod-auth's skill](../pod-auth/SKILL.md) before changing auth policy.

This package is security-critical. Build workspace dependencies before checking it and keep every
source file at 100% coverage. Use `/testing` only in Vitest consumers. Keep framework-free exports
in `.` and React/CSS imports in `/react`. Do not introduce `import.meta.env` here.
