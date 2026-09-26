// Presentation only. These controls never parse evidence or alter a recorded decision.
import { asSentence } from './text.js';

const root = document.querySelector('.simulator-workbench');
const openEvidence = (hash) => {
  const panel = [...root.querySelectorAll('.evidence-disclosure')].find((item) => `#${item.id}` === hash);
  if (panel) panel.open = true;
};
root.querySelectorAll('.evidence-nav a').forEach((link) => {
  link.addEventListener('click', () => openEvidence(link.hash));
});
window.addEventListener('hashchange', () => openEvidence(window.location.hash));
openEvidence(window.location.hash);

const stage = root.querySelector('.simulator-stage');
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
// A toggle keeps one name; aria-pressed alone carries its state.
toggle.addEventListener('click', () => {
  const show = explanation.hidden;
  explanation.hidden = !show;
  stage.classList.toggle('is-explaining', show);
  toggle.setAttribute('aria-pressed', String(show));
  stage.dispatchEvent(new Event('viewchange'));
});

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
