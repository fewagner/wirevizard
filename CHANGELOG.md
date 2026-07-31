# Changelog

User-facing changes, newest first. The app shows a one-time notice after it
updates; this file is what that notice links to.

## v1.0.0 — 2026-07-31

First numbered release. New in this version:

- **Multiple projects in one browser.** Each project is one data repository —
  for example one per cryostat or experimental area. Switch via the project
  button in the top bar; add projects with a guided dialog that verifies the
  connection before adding. Unsaved drafts are kept per project, so switching
  never loses work. Share links now *add* a project instead of replacing your
  connection.
- **Welcome screen** with step-by-step onboarding when no project is
  configured yet.
- **Beta channel.** Upcoming versions can be tried at
  [/wirevizard/beta/](https://fewagner.com/wirevizard/beta/) against your real
  projects before they reach everyone.
- **Versioning.** Settings shows the app version; after an update a one-time
  notice links here. A format marker in the data repo (`meta.json`) prevents
  an outdated cached app from ever writing to data saved by a newer version.

Everything below shipped before versioning existed (mid-2026), newest first:

- Validate tab shows where conflicting cables lead and flags likely duplicates.
- Cables are treated as bidirectional everywhere.
- Per-setup wiring tables compiled from chip-port categories (device roles,
  in-place re-plugging, ＋ connect). The free-text tag field was removed.
- Signal paths as horizontal device chains; incomplete chains shown with the
  exact dead-end port.
- Cabling diagram with draggable device boxes, auto-placement, auto-arrange;
  per-device query diagram with inline add-cable/add-port forms.
- Free-text comments with attached images on every device and cable.
- Original port: query/edit tables, signal-path tracing, validation, GitHub
  API persistence with three-way merge, demo mode.
