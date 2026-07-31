// help.js — the "How to use" modal behind the ? button in the top bar.
// Static usage instructions; keep in sync with README.md when features move.

import { APP_VERSION, CHANGELOG_URL } from './version.js';

let scrim, modal;

const HELP_HTML = `
  <section>
    <h3>What is this?</h3>
    <p>WireVizard documents the physical cabling of your lab — which cable connects which
    port of which device, organized into setups. Everything you see is read from three CSV
    files in a GitHub repository and can be edited right here.</p>
  </section>

  <section>
    <h3>The tabs at a glance</h3>
    <ul class="help-list">
      <li><b>Query device / Query setup</b> — pick a device or setup and see all its cables,
        as a table or as a diagram.</li>
      <li><b>Signal paths</b> — end-to-end chains traced through cables and the internal
        connections of devices; incomplete chains are shown with the exact dead-end port.</li>
      <li><b>Setup tables</b> — the classic wiring spreadsheet per setup: one row per chip
        line (Charge, Flux, …), one column per device role, editable in place.</li>
      <li><b>All cables / devices / setups</b> — full registries with search and inline
        editing (double-click a cell); the cables view has a draggable wiring diagram.</li>
      <li><b>Validate</b> — missing fields, unknown references, undefined ports, and port
        conflicts with a hint when two cables look like duplicate entries.</li>
    </ul>
  </section>

  <section>
    <h3>Adding cables — three ways</h3>
    <ul class="help-list">
      <li><b>＋ Add cable tab</b> — the full form. Ports become dropdowns when the device has
        defined ports. The form keeps its values after adding, so a series of similar cables
        is quick to enter.</li>
      <li><b>Query device → Diagram</b> — open “＋ Add cable from &lt;device&gt;” below the
        diagram; one end is already fixed to the device you are looking at.</li>
      <li><b>Setup tables → ＋ connect</b> — extends a chip line hop by hop; the from-side and
        the setup are filled in for you. Clicking a filled cell re-plugs that hop instead.</li>
    </ul>
    <p class="hint">In “All cables”, double-click any cell to edit an existing cable, and use
    the × button to delete one.</p>
  </section>

  <section>
    <h3>Adding devices and ports</h3>
    <ul class="help-list">
      <li><b>＋ Add device tab</b> — name, optional description, a <i>role</i> (AWG, switch,
        breakout, … — use <code>Chip</code> for the sample itself), and the ports.</li>
      <li><b>Ports</b> can be added later too: in “All devices” with the ＋&nbsp;port button, or
        in the query diagram's “＋ Add port” form.</li>
      <li><b>Port syntax</b>: a plain name (<code>RF out</code>), internal connections in
        parentheses (<code>A2 (A1)</code> — the signal passes through the device), and for chip
        ports a category in brackets (<code>qb1 drive [Charge line]</code>) which creates a row
        in the setup tables.</li>
      <li><b>Comments &amp; photos</b>: every device and cable has a 💬 button (also: click any
        box or line in a diagram) for free-text notes with attached images.</li>
    </ul>
  </section>

  <section>
    <h3>Saving — important!</h3>
    <p>Edits are <b>not saved automatically</b>. They collect as a local draft in your browser
    (they survive reloads and tab switches) until you press <b>Save</b> in the top bar — the
    button shows a count and lights up when there is something to commit. One Save = one git
    commit in the data repository, so there is a full history of every change. If someone else
    saved in the meantime, your Save merges their changes in first; if you both edited the very
    same field, yours wins and a notice tells you what happened.</p>
  </section>

  <section>
    <h3>How your data is stored</h3>
    <p>This app is public and <a href="https://github.com/fewagner/wirevizard" target="_blank"
    rel="noopener">open source</a> — it is a static page with no server and no accounts. Your
    cabling data never touches it: the data lives in a <b>private GitHub repository</b> that
    only people with the correct access token can read or write. The token is entered once
    (or received via a share link) and stays in your browser. A browser can hold several such
    projects — e.g. one per cryostat — switchable via the project button in the top bar.</p>
  </section>

  <section>
    <p class="hint">WireVizard v${APP_VERSION} ·
      <a href="${CHANGELOG_URL}" target="_blank" rel="noopener">changelog</a> ·
      try everything risk-free in the <a href="?demo=1">demo</a></p>
  </section>`;

export function initHelp() {
  scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.hidden = true;

  modal = document.createElement('div');
  modal.className = 'modal help-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <header class="modal-head">
      <h2>How to use WireVizard</h2>
      <button class="icon-btn h-close" title="Close">✕</button>
    </header>
    <div class="modal-body">${HELP_HTML}</div>`;

  document.body.appendChild(scrim);
  document.body.appendChild(modal);

  scrim.addEventListener('pointerdown', closeHelp);
  modal.querySelector('.h-close').addEventListener('click', closeHelp);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) closeHelp();
  });

  document.getElementById('help-btn').addEventListener('click', openHelp);
}

export function openHelp() {
  scrim.hidden = false;
  modal.hidden = false;
  modal.querySelector('.modal-body').scrollTop = 0;
}

export function closeHelp() {
  scrim.hidden = true;
  modal.hidden = true;
}
