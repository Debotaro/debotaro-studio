# Design direction — 15 October 2026

Debotaro Studio uses a **modern, minimalist, professional SaaS** direction. Its premium quality should come from readable controls, clear hierarchy and predictable interaction. This is a reasoned fit for a visual application builder, not a claim of an objectively best design or a perfect product.

The editor uses light neutral surfaces, restrained violet accents, legible typography and consistent spacing. Violet identifies the current tool, selected content and primary actions. Quiet panel borders separate layers, canvas and inspector; stronger focus indicators help keyboard navigation. The application being edited has its own tokens and theme, separate from the Studio interface.

## Changes implemented in this pass

- The canvas initially fits the available width and follows resizing while automatic fit is active. A deliberate zoom remains under the user's control until **Fit canvas** is selected; switching responsive widths fits that artboard again.
- **Ctrl/Cmd+K** opens and focuses layer search, including the Layers pane on phones. Escape clears the search. The shortcut respects open dialogs and change review.
- A compact workflow guide connects design, source review and preview. The phone layout starts with a phone preview and provides focused panels instead of compressing the desktop columns into one narrow screen.
- The inspector groups related properties and uses readable visible labels such as **Accessibility label** and **Show when**, with explanatory help. Raw field names remain compatible with the documented property contract; valid edits still persist and update the preview.
- Panel typography, surface contrast, selected states and spacing have been refined. Existing reduced-motion preferences and visible keyboard focus remain supported.

Decorative glass overlays, heavy 3D scenes and constant animation would compete with the editable application and consume useful workspace. Future visual changes should improve orientation, feedback or task completion before adding visual effects.

## Evidence and remaining questions

Production browser regressions exercise actual fitting geometry, resize/manual zoom, responsive widths, layer search, dialog focus, phone panels and persisted inspector edits. Existing collaboration, source review, recovery and export tests remain enabled. See [verification](VERIFICATION.md) and [performance](PERFORMANCE.md) for executed scope and limitations.

Actual desktop and phone screenshots show the running product. These checks do not establish first-time-user success, accessibility certification or a 10/10 rating. The next research step is to observe designers and frontend developers opening the starter, changing a component, finding its source and exporting it; record navigation errors and task completion before choosing further changes. Live AI and an externally hosted backend remain unverified.
