// Presentation only. These controls never parse evidence or alter a recorded decision.
import { asSentence } from './text.js';

const root = document.querySelector('.simulator-workbench');
const openEvidence = (hash) => {
  const panel = [...root.querySelectorAll('.evidence-disclosure')].find((item) => `#${item.id}` === hash);
  if (panel) panel.open = true;
};
window.addEventListener('hashchange', () => openEvidence(window.location.hash));
openEvidence(window.location.hash);

const stage = root.querySelector('.simulator-stage');

// If the simulator entry itself never ran (its file failed to load), nothing else will leave
// "Evidence loading". Once the page has loaded, fail closed with the bootstrap's own wording:
// no command authority, every scene control disabled, and a reload as the only recovery.
const failClosedWithoutBootstrap = () => {
  if (stage.dataset.bootstrap === 'started' || stage.dataset.webgl) return;
  const setText = (selector, text) => { for (const element of root.querySelectorAll(selector)) element.textContent = text; };
  stage.classList.add('is-unavailable');
  stage.dataset.webgl = 'fallback-error';
  stage.dataset.receiptsReady = 'false';
  stage.dataset.fleetReady = 'false';
  stage.dataset.failClosed = 'true';
  setText('.status-phase', 'Evidence unavailable');
  setText('.status-code, .decision-code', 'bootstrap_unavailable');
  setText('.decision-outcome', 'Unavailable');
  setText('.receipt-source', 'Simulator files unavailable');
  setText('.decision-reason', 'The simulator files could not be loaded. Reload the page to try again. Bounder retained no command authority.');
  setText('.adapter-output', 'No command authority');
  setText('.rule-stack strong', 'UNAVAILABLE');
  setText('[data-receipt], [data-fleet]', 'Unavailable');
  setText('[data-fleet-source]', 'Fleet evidence unavailable · the simulator files could not be loaded');
  for (const control of root.querySelectorAll('[data-scenario], [data-action], [data-camera], [data-explanation], [data-render-quality], [data-resilience-action], [data-resilience-scrubber]')) control.disabled = true;
  const notice = stage.querySelector('.webgl-fallback:not(.noscript-fallback)');
  if (notice) {
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload the simulator';
    reload.addEventListener('click', () => window.location.reload());
    notice.replaceChildren('The simulator could not load. Reload the page to try again.', reload);
  }
};
if (document.readyState === 'complete') failClosedWithoutBootstrap();
else window.addEventListener('load', failClosedWithoutBootstrap, { once: true });
const explanation = root.querySelector('.scene-explanation');
const toggle = root.querySelector('[data-explanation]');
const announcer = root.querySelector('[data-scene-announcer]');
const describeDecision = () => [
  asSentence(root.querySelector('.decision-outcome').textContent),
  asSentence(root.querySelector('.decision-reason').textContent),
  asSentence(`Recorded adapter response: ${root.querySelector('.adapter-output').textContent}`)
].filter(Boolean).join(' ');
// One polite announcement per settled decision: the panel updates several nodes in one
// task, so the text is read once after the frame rather than once per node.
let announceFrame;
let announced = '';
const announceDecision = (text) => {
  if (!announcer) return;
  if (announceFrame !== undefined) cancelAnimationFrame(announceFrame);
  announceFrame = requestAnimationFrame(() => {
    announceFrame = undefined;
    if (text === announced) return;
    announced = text;
    announcer.textContent = text;
  });
};
const updateExplanation = () => {
  const text = describeDecision();
  root.querySelector('[data-scene-explanation]').textContent = text;
  announceDecision(text);
};
new MutationObserver(updateExplanation).observe(root.querySelector('.decision-panel'), { childList: true, subtree: true, characterData: true });
// The initial state is described but not announced: nothing has changed yet.
announced = describeDecision();
root.querySelector('[data-scene-explanation]').textContent = announced;
// A toggle keeps one name; aria-pressed alone carries its state. While the text view is shown
// no camera view is on screen, so no camera button reads as pressed; the scene's own view
// (recorded on the stage by the controller) is pressed again when the text view closes.
const cameraButtons = [...root.querySelectorAll('[data-camera]')];
const syncCameraPressed = (explaining) => {
  const view = stage.dataset.cameraView ?? 'overview';
  for (const button of cameraButtons) button.setAttribute('aria-pressed', String(!explaining && button.dataset.camera === view));
};
toggle.addEventListener('click', () => {
  const show = explanation.hidden;
  explanation.hidden = !show;
  stage.classList.toggle('is-explaining', show);
  toggle.setAttribute('aria-pressed', String(show));
  syncCameraPressed(show);
  stage.dispatchEvent(new Event('viewchange'));
});
// Choosing a camera view means looking at the scene, so it closes the text view.
for (const button of cameraButtons) {
  button.addEventListener('click', () => { if (!explanation.hidden) toggle.click(); });
}

// Without a working 3D view the text view is the view: switch to it once and say why, instead of
// leaving an empty stage. The visitor can still toggle it. A lost context that the browser may
// restore does not switch; an unavailable renderer or a terminal failure does. A failure to load
// any evidence view keeps its own stage notice and reload button.
const rendererNote = document.createElement('p');
rendererNote.className = 'scene-renderer-note';
rendererNote.hidden = true;
explanation.querySelector('h3')?.after(rendererNote);
let textViewChosenForRenderer = false;
const showTextViewWithoutRenderer = () => {
  const state = stage.dataset.webgl;
  if (textViewChosenForRenderer || (state !== 'unavailable' && state !== 'runtime-error')) return;
  textViewChosenForRenderer = true;
  rendererNote.textContent = state === 'runtime-error'
    ? 'The 3D view stopped, so the text view is shown. Reload the page to restart the scene.'
    : stage.dataset.webglReason === 'browser'
      ? 'This browser cannot run the 3D scene (it needs Safari 16.4, Firefox 108, Chrome 89 or later), so the text view is shown. Every recorded decision remains available.'
      : 'The 3D view is unavailable in this browser, so the text view is shown.';
  rendererNote.hidden = false;
  if (explanation.hidden) toggle.click();
};
new MutationObserver(showTextViewWithoutRenderer).observe(stage, { attributes: true, attributeFilter: ['data-webgl'] });
showTextViewWithoutRenderer();

// The visual step counter is decorative (aria-hidden); mirror it into the tour's live
// region so screen-reader users hear where they are as the tour advances.
const tourPosition = root.querySelector('[data-tour="position"]');
const tourPositionAnnouncement = root.querySelector('[data-tour-position-announcement]');
if (tourPosition && tourPositionAnnouncement) {
  const mirrorTourPosition = () => { tourPositionAnnouncement.textContent = asSentence(tourPosition.textContent); };
  new MutationObserver(mirrorTourPosition).observe(tourPosition, { childList: true, characterData: true, subtree: true });
  mirrorTourPosition();
}

const nodes = root.querySelector('[data-fleet-nodes]');
const search = root.querySelector('[data-fleet-search]');
const platform = root.querySelector('[data-fleet-platform]');
const outcome = root.querySelector('[data-fleet-outcome]');
const reset = root.querySelector('[data-fleet-reset]');
// With no rows, the source line says whether evidence is still loading or failed to load.
const fleetSource = root.querySelector('[data-fleet-source]');
const fleetUnavailable = () => fleetSource?.dataset.source === 'unavailable' || /\bunavailable\b/i.test(fleetSource?.textContent ?? '');
const filterFleet = () => {
  const query = search.value.trim().toLowerCase();
  reset.disabled = !search.value && platform.value === 'all' && outcome.value === 'all';
  const rows = [...nodes.querySelectorAll('.fleet-node')];
  let visible = 0;
  for (const row of rows) {
    // Match the row's readable summary, never the collapsed receipt JSON beneath it.
    const text = row.dataset.search ?? row.querySelector('summary')?.textContent.toLowerCase() ?? '';
    row.hidden = !(text.includes(query) && (platform.value === 'all' || row.dataset.platform === platform.value) && (outcome.value === 'all' || row.dataset.outcome === outcome.value));
    if (!row.hidden) visible += 1;
  }
  root.querySelector('[data-fleet-count]').textContent = rows.length
    ? `${visible} of ${rows.length} recorded Guardians${visible ? '' : '. No matching results; clear the search or filters.'}`
    : (fleetUnavailable() ? 'Recorded Fleet evidence could not be loaded.' : 'Waiting for recorded evidence.');
};
const refreshFleet = () => {
  const current = platform.value;
  const classes = [...new Set([...nodes.children].map((row) => row.dataset.platform).filter(Boolean))].sort();
  platform.replaceChildren(new Option('All platforms', 'all'), ...classes.map((value) => new Option(value.replaceAll('_', ' '), value)));
  platform.value = classes.includes(current) ? current : 'all';
  filterFleet();
};
reset.addEventListener('click', () => {
  search.value = '';
  platform.value = 'all';
  outcome.value = 'all';
  filterFleet();
  search.focus();
});
search.addEventListener('input', filterFleet);
platform.addEventListener('change', filterFleet);
outcome.addEventListener('change', filterFleet);
new MutationObserver(refreshFleet).observe(nodes, { childList: true });
if (fleetSource) new MutationObserver(filterFleet).observe(fleetSource, { childList: true, characterData: true, subtree: true });
refreshFleet();
