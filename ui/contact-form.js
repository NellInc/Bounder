// Progressive enhancement of the existing Formspree form. Native submission still works without JS.
const form = document.querySelector('#contact-form');
const submit = form.querySelector('button[type="submit"]');
// Only the label text changes while sending; the decorative arrow stays in place.
const submitLabel = submit.querySelector('[data-label]') ?? submit;
const idleLabel = submitLabel.textContent;
// On success the heading and required-fields note belong to a form that no longer shows.
const formIntro = [document.querySelector('#contact-form-title'), document.querySelector('.form-required-note')].filter(Boolean);
const success = document.querySelector('#form-success');
const error = document.querySelector('#form-error');
const hostedSubmit = form.querySelector('[data-hosted-submit]');
let pending = false;
form.addEventListener('submit', async (event) => {
  // Let the provider handle any human check when the visitor chooses hosted submission.
  if (event.submitter === hostedSubmit && !pending) return;
  event.preventDefault();
  if (pending || !form.reportValidity()) return;
  pending = true;
  submit.disabled = true;
  hostedSubmit.disabled = true;
  submitLabel.textContent = 'Sending enquiry…';
  error.hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error('provider_rejected');
    const result = await response.json();
    // Match the provider's @formspree/core success contract; never follow its URL here.
    if (!result || typeof result.next !== 'string' || result.error || result.errors) throw new Error('provider_unconfirmed');
    // Only an affirmative provider response can show acceptance. Query parameters cannot.
    success.hidden = false;
    success.tabIndex = -1;
    form.hidden = true;
    for (const element of formIntro) element.hidden = true;
    success.focus();
  } catch {
    error.textContent = 'We could not confirm delivery. Your message is still here: check your connection and try again, or continue on Formspree below. If the first attempt did arrive, we may receive it twice.';
    error.hidden = false;
    hostedSubmit.hidden = false;
    error.tabIndex = -1;
    error.focus();
  } finally {
    clearTimeout(timeout);
    pending = false;
    submit.disabled = false;
    hostedSubmit.disabled = false;
    submitLabel.textContent = idleLabel;
  }
});
