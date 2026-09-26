import { asSentence } from './text.js';

/** Presentation wording for one recorded Guardian. Producer fields are glossed, never altered. */
export const describeFleetDevice = (device) => {
  const { allowed, code, reason } = device.receipt;
  const verdict = `${allowed ? 'Allowed request' : 'Protective hold'}${code === 'allowed' ? '' : ` · ${code.replaceAll('_', ' ')}`}`;
  const platform = device.platform_class?.replaceAll('_', ' ') ?? 'platform unspecified';
  // A rejected policy update is part of the recorded outcome: without it a replayed policy
  // reads as though it had been accepted.
  const update = typeof device.update_error === 'string' && device.update_error
    ? ` Rejected update: ${asSentence(device.update_error)} The previously verified policy stayed in force.`
    : '';
  return {
    verdict,
    detail: `${asSentence(`${platform} · ${device.scenario}`)} ${asSentence(reason)}${update}`,
    // Search matches what a visitor can read, not the collapsed receipt JSON.
    search: [device.device_id, platform, device.scenario, code.replaceAll('_', ' '), reason, verdict, update]
      .join(' ')
      .toLowerCase()
  };
};

/** Render only previously contract-checked Fleet records. No authentication is inferred here. */
export const renderFleetRows = (container, evidence) => {
  const fragment = document.createDocumentFragment();
  for (const device of evidence.devices) {
    const text = describeFleetDevice(device);
    const row = document.createElement('div');
    row.className = `fleet-node ${device.receipt.allowed ? 'is-allowed' : 'is-held'}`;
    row.setAttribute('role', 'listitem');
    row.dataset.deviceId = device.device_id;
    row.dataset.platform = device.platform_class ?? 'unspecified';
    row.dataset.outcome = device.receipt.allowed ? 'allowed' : 'held';
    row.dataset.search = text.search;
    row.dataset.baseLabel = `${device.device_id}: ${text.verdict}; ${device.scenario}${device.update_error ? '; update rejected' : ''}`;
    row.setAttribute('aria-label', row.dataset.baseLabel);
    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    const name = document.createElement('b');
    name.textContent = device.device_id;
    const verdict = document.createElement('small');
    verdict.textContent = text.verdict;
    summary.append(name, verdict);
    const reason = document.createElement('p');
    reason.className = 'fleet-device-reason';
    reason.textContent = text.detail;
    const evidenceText = document.createElement('pre');
    evidenceText.textContent = JSON.stringify(device.receipt, null, 2);
    detail.append(summary, reason, evidenceText);
    row.append(detail);
    fragment.append(row);
  }
  container.replaceChildren(fragment);
  // The count is written here too, so it is right even if the filter controls never load; the
  // filters rewrite it as they narrow the list.
  const count = container.closest?.('.simulator-workbench')?.querySelector('[data-fleet-count]');
  if (count) count.textContent = `${evidence.devices.length} of ${evidence.devices.length} recorded Guardians`;
};

const fleetFields = (root) => Object.fromEntries(
  [...root.querySelectorAll('[data-fleet]')].map((element) => [element.dataset.fleet, element])
);

/** Summary metrics for contract-checked Fleet evidence, shared by every view that renders it. */
export const renderFleetSummary = (root, evidence) => {
  const fields = fleetFields(root);
  if (fields.name) fields.name.textContent = evidence.fleet_id;
  if (fields.devices) fields.devices.textContent = `${evidence.summary.devices} recorded`;
  if (fields.policy) {
    fields.policy.textContent = evidence.policy_profile;
    fields.policy.title = evidence.policy_profile;
  }
  if (fields.evidence) fields.evidence.textContent = `${evidence.summary.allowed} allow · ${evidence.summary.blocked} hold`;
};

/**
 * Resolve the Fleet panel to an explicit unavailable state. Nothing is left reading
 * "Loading", and the stage records that no Fleet evidence was rendered.
 */
export const showFleetUnavailable = (root, message) => {
  const stage = root.querySelector('.simulator-stage');
  if (stage) stage.dataset.fleetReady = 'false';
  const source = root.querySelector('[data-fleet-source]');
  if (source) {
    source.textContent = message;
    source.dataset.source = 'unavailable';
  }
  for (const field of Object.values(fleetFields(root))) {
    field.textContent = 'Unavailable';
    field.removeAttribute('title');
  }
  const count = root.querySelector('[data-fleet-count]');
  if (count) count.textContent = 'Recorded Fleet evidence could not be loaded.';
};
