# WireVizard

A lightweight browser tool for documenting physical cabling in a lab setup.

**Live app:** <https://fewagner.com/wirevizard/> · **Demo (no setup needed):** <https://fewagner.com/wirevizard/?demo=1>

This repository contains only the app — generic static HTML/CSS/JS with no build step and **no data**. The cabling data lives in a separate, private GitHub repository ([`wirevizard-data`](https://github.com/fewagner/wirevizard-data)) holding three plain CSV files. The app talks directly to the GitHub API from the browser; there is no backend.

## How it works

- **Public app repo (this one)** — served by GitHub Pages.
- **Private data repo** — `cables.csv`, `devices.csv`, `setups.csv`. GitHub itself enforces access: without a token the app is an empty shell.
- **A fine-grained personal access token (PAT) is the login.** Scoped to only the data repo with *Contents: Read and write*, entered once in the app's Settings, stored in the browser's `localStorage`.
- **Every Save is one git commit** in the data repo — full history, diffs and blame for free.
- Edits accumulate locally (they survive reloads) until you press **Save**. Before committing, the app pulls and three-way-merges any remote commits made in the meantime, so concurrent editing is safe; conflicting field edits are reported (local wins, the other value stays in git history).

## Getting started

1. Create a **private** data repository (e.g. `wirevizard-data`) containing `cables.csv`, `devices.csv`, `setups.csv` (the app can also bootstrap an empty repo — just add records and Save).
2. Create a **fine-grained PAT**: github.com → Settings → Developer settings → Fine-grained tokens → *Repository access: only the data repo*, *Permissions → Contents: Read and write*.
3. Open the app → **⚙ Settings** → enter owner, repository, branch and the token → *Test connection*.
4. To onboard a colleague, use **Copy link with token** in Settings — the link embeds the connection settings (including the token!) in the URL fragment, which never reaches any server. Treat such links like the token itself.

## Data model

| File | Purpose |
|---|---|
| `cables.csv` | One row per physical cable: `cable_id, from_device, from_port, to_device, to_port, setup, comment` — cables are bidirectional; `from`/`to` is storage order only, signal direction follows from the connected ports |
| `devices.csv` | Registry of devices; fixed columns `name, description, role, x, y, comment`, every further column one port |
| `setups.csv` | Registry of measurement setups: `name, description` |
| `images/` | Images attached to comments, uploaded through the app |

A port column contains a name, optionally a parenthesised list of internally-connected ports (`A2 (A1)`, bidirectional), and optionally a bracketed category (`qb1 drive [Charge line]`). The Signal-paths tab traces end-to-end signal chains through cables and internal connections. `role` groups devices in the setup tables (use `Chip` for the sample itself); `x`/`y` are the device's position on the cabling diagram; `comment` is free-text Markdown that may link images (`![label](images/…)`). Files written before these columns existed parse fine and are migrated on the next save.

## Setup tables

The Setup-tables tab reproduces classic per-setup wiring spreadsheets — one table per port category (Charge line, Flux line, …), one row per categorized chip port, one column per device role — but every row is traced live from `cables.csv`, so the table can never disagree with the cabling. Cells edit in place (each edit is a validated re-plug of the adjacent cable endpoint) and `＋ connect` extends a line hop by hop.

## Features

Query by device or setup, as a table or as a **diagram** (the queried device with all ports and labeled far ends, plus inline add-cable/add-port forms) · signal-path tracing rendered as horizontal device chains (incomplete chains are shown too, marked with the exact dead-end port) · per-setup **wiring tables** compiled from chip-port categories, editable in place · full cable table with live search and inline editing, or a **cabling diagram** with draggable device boxes (positions persist in `devices.csv`), collision-free auto-placement, and one-click auto-arrange by signal flow · free-text comments with attached images on every device and cable (💬 in the tables, click any box/line in the diagrams) · editable device/port and setup registries with cascading renames and deletes · validation · demo mode (`?demo=1`).

## Local development

No build step — plain ES modules. Serve the directory with any static server:

```bash
python3 -m http.server 8742
# open http://localhost:8742?demo=1
```

Note that `localStorage` is per-origin: settings entered on `localhost` don't exist on the deployed site (and vice versa).

## Repository layout

```
index.html        app shell (tabs + forms)
css/style.css     styles
js/app.js         boot, tab rendering, event wiring
js/data.js        domain model: CSV (de)serialization, validation, signal paths, mutations
js/store.js       settings, base cache, draft, three-way merge, save (one commit)
js/github.js      minimal GitHub REST client (trees/blobs read, git data API write)
js/settings.js    settings modal with real read/write permission probes
js/demo.js        embedded fictional sample data
```
