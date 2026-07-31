// version.js — single source of truth for the app version and the data-format
// version. See docs/RELEASING.md for when and how to bump these.

// Shown in settings; drives the one-time "what's new" notice after an update.
export const APP_VERSION = '1.0.0';

// Version of the on-disk data format (meta.json `format` key in the data
// repo). Bump ONLY on a breaking change to how data files are read/written —
// see RELEASING.md. An app seeing a data repo with a newer format shows a
// "please update" banner and refuses to save, so a stale cached client can
// never downgrade or corrupt newer data.
export const FORMAT_VERSION = 1;

export const CHANGELOG_URL = 'https://github.com/fewagner/wirevizard/blob/main/CHANGELOG.md';
