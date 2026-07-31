# Releasing WireVizard

Two channels, deployed by `.github/workflows/pages.yml` on every push:

| Branch | URL | Audience |
|---|---|---|
| `main` | https://fewagner.com/wirevizard/ | everyone |
| `beta` | https://fewagner.com/wirevizard/beta/ | testers |

Both paths share one origin, so `/beta/` uses the same localStorage
(projects, tokens, drafts) as production — that is a feature (testers run
beta against their real projects) and a constraint (see the compatibility
contract below).

## Release flow

1. Develop on a feature branch (or `beta` directly for small things).
2. Push to `beta` → test at `/beta/` against a real project; run the smoke
   checklist below.
3. Bump `APP_VERSION` in `js/version.js`, add a `CHANGELOG.md` section.
4. Merge/push to `main`, tag `vX.Y.Z`.
5. Sync beta: `git push origin main:beta`. Push `main` first and let its
   deploy finish — pushing `beta` immediately after cancels the main run
   (concurrency group) and, if the beta deploy then fails, nothing is
   deployed; recover with an empty commit on `main`.
6. **Quirk observed in this repo:** deploy runs triggered by a `beta` push
   succeed but the served site does not update — only main-ref runs go
   live. After any beta push, trigger a main run to publish it:
   `gh workflow run pages.yml --ref main`, or via API
   (`POST /actions/workflows/pages.yml/dispatches {"ref":"main"}`), or an
   empty commit on `main`.

## Version bumps

- `APP_VERSION` — every release. Drives the one-time "what's new" toast.
- `FORMAT_VERSION` — ONLY on a breaking change to how the data files are
  read or written. Keep it at 1 as long as humanly possible; additive
  changes (new optional columns, new files) do NOT need a bump. An app that
  sees `meta.json` with a newer `format` shows a reload banner and refuses
  to save.

## Compatibility contract

The CSV files in user data repos are the public API:

- Only add optional columns/files; never rename or reorder existing ones.
- Ignore unknown columns and files when parsing.
- `serialize(parse(file))` must stay byte-identical for files written by
  older versions — otherwise every file looks "modified" and commits get
  noisy. (Header-driven parsing + migration-on-save is the established
  pattern; see `parseDevices`.)
- Teach the three-way merge (`COLLECTIONS` in `js/store.js`) every new
  field the moment it is introduced.
- localStorage shapes are shared between `/` and `/beta/`: additive-only,
  validate on read, production must tolerate whatever beta wrote.

## Smoke checklist (run at /beta/ before releasing)

- [ ] Demo mode (`?demo=1`): every tab renders, console clean.
- [ ] Query device + setup, table and diagram sub-tabs.
- [ ] Signal paths: complete and incomplete chains render.
- [ ] Setup tables: rows trace, cell re-plug works, ＋ connect works.
- [ ] All cables: search, inline edit, delete; diagram drag + auto-arrange.
- [ ] Add cable/device/setup forms (cable form keeps values).
- [ ] Comments: edit, attach image, popup from table and diagram.
- [ ] Validate tab shows conflicts with far ends.
- [ ] Real project: edit → draft survives reload → Save commits → second
      browser/refresh sees it; concurrent edit merges.
- [ ] Project switcher: switch keeps each project's draft; add-project
      verification; share link adds (not replaces) a project.
- [ ] Version footer correct; what's-new toast after version bump.
