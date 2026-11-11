---
name: excalidraw-scene
description: Use when importing or editing Excalidraw v2 scenes, computing drawing geometry, or embedding drawings through the safe SVG renderer in @jeswr/excalidraw-scene.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

Keep this package pure: no RDF, React, pod I/O or third-party runtime dependencies.
Descriptor operations belong behind solid-drawing's public API in the consumer.

Parse untrusted text with `parseScene` or bounded `parseSceneStream`; persist with
`serializeScene`. Unedited imports retain original bytes, unknown fields and opaque types.
Missing legacy `updated` values default to zero. Unsupported colour strings stay in the
scene but are excluded from rendering; never widen the paint allowlist to admit URLs or variables.

Use `sceneToSvg` or `sceneToSvgContent` for HTML/SVG embeds. These sanitise their inputs;
never bypass them with imported markup. The package is security-critical: preserve escaping,
complexity caps and 100% branch coverage, including adversarial input.

Linear rotation and resizing use point bounds (which may be negative), through
`elementCentre`, `resizeHandle` and `resizeFromHandle`.

Operations are immutable. `Revision.preview` skips full-scene validation for transient,
app-owned pointer previews only. Validate the combined scene once at commit using
`serializeScene`, before saving or placing it in history. SVG sanitisation still applies
to every changed element. `duplicateElements` can receive a separate destination scene
for paste; enforce the destination element cap before editing React state.

Build with the package build script; typecheck includes tests. Run the package lint,
typecheck and coverage-enabled test scripts after changes. See [README](./README.md) for
format limits and rendering omissions.
