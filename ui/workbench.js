// Presentation only. These controls never parse evidence or alter a recorded decision.
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
const updateExplanation = () => {
  root.querySelector('[data-scene-explanation]').textContent = `${root.querySelector('.decision-outcome').textContent}. ${root.querySelector('.decision-reason').textContent} Recorded adapter response: ${root.querySelector('.adapter-output').textContent}.`;
};
new MutationObserver(updateExplanation).observe(root.querySelector('.decision-panel'), { childList: true, subtree: true, characterData: true });
updateExplanation();
toggle.addEventListener('click', () => {
  const show = explanation.hidden;
  explanation.hidden = !show;
  stage.classList.toggle('is-explaining', show);
  toggle.setAttribute('aria-pressed', String(show));
  toggle.textContent = show ? 'Scene view' : 'Text view';
  stage.dispatchEvent(new Event('viewchange'));
});

const nodes = root.querySelector('[data-fleet-nodes]');
const search = root.querySelector('[data-fleet-search]');
const platform = root.querySelector('[data-fleet-platform]');
const outcome = root.querySelector('[data-fleet-outcome]');
const filterFleet = () => {
  const query = search.value.trim().toLowerCase();
  const rows = [...nodes.querySelectorAll('.fleet-node')];
  let visible = 0;
  for (const row of rows) {
    row.hidden = !(row.textContent.toLowerCase().includes(query) && (platform.value === 'all' || row.dataset.platform === platform.value) && (outcome.value === 'all' || row.dataset.outcome === outcome.value));
    if (!row.hidden) visible += 1;
  }
  root.querySelector('[data-fleet-count]').textContent = rows.length ? `${visible} of ${rows.length} recorded Guardians${visible ? '' : '. No matching results; clear the search or filters.'}` : 'Recorded Fleet evidence is not available in this view.';
};
const refreshFleet = () => {
  const current = platform.value;
  const classes = [...new Set([...nodes.children].map((row) => row.dataset.platform).filter(Boolean))].sort();
  platform.replaceChildren(new Option('All platforms', 'all'), ...classes.map((value) => new Option(value.replaceAll('_', ' '), value)));
  platform.value = classes.includes(current) ? current : 'all';
  filterFleet();
};
search.addEventListener('input', filterFleet);
platform.addEventListener('change', filterFleet);
outcome.addEventListener('change', filterFleet);
new MutationObserver(refreshFleet).observe(nodes, { childList: true });
refreshFleet();
