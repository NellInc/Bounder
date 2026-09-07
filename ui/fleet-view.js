/** Render only previously contract-checked Fleet records. No authentication is inferred here. */
export const renderFleetRows = (container, evidence) => {
  const fragment = document.createDocumentFragment();
  for (const device of evidence.devices) {
    const row = document.createElement('div');
    row.className = `fleet-node ${device.receipt.allowed ? 'is-allowed' : 'is-held'}`;
    row.setAttribute('role', 'listitem');
    row.dataset.deviceId = device.device_id;
    row.dataset.platform = device.platform_class ?? 'unspecified';
    row.dataset.outcome = device.receipt.allowed ? 'allowed' : 'held';
    row.dataset.baseLabel = `${device.device_id}: ${device.scenario}; ${device.receipt.code}`;
    row.setAttribute('aria-label', row.dataset.baseLabel);
    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    const name = document.createElement('b');
    name.textContent = device.device_id;
    const verdict = document.createElement('small');
    verdict.textContent = `${device.receipt.allowed ? 'Allowed request' : 'Protective hold'} · ${device.receipt.code.replaceAll('_', ' ')}`;
    summary.append(name, verdict);
    const reason = document.createElement('p');
    reason.className = 'fleet-device-reason';
    reason.textContent = `${device.platform_class?.replaceAll('_', ' ') ?? 'Platform unspecified'} · ${device.scenario}. ${device.receipt.reason}`;
    const evidenceText = document.createElement('pre');
    evidenceText.textContent = JSON.stringify(device.receipt, null, 2);
    detail.append(summary, reason, evidenceText);
    row.append(detail);
    fragment.append(row);
  }
  container.replaceChildren(fragment);
};
