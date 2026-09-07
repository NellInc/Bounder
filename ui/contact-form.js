// Progressive enhancement of the existing Formspree form. Native submission still works without JS.
const form = document.querySelector('#contact-form');
const submit = form.querySelector('button[type="submit"]');
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
  submit.textContent = 'Sending enquiry…';
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
    success.focus();
  } catch {
    error.textContent = 'We could not confirm that your enquiry was accepted. Your message is still here. Please check your connection and try again; if the provider already accepted it, retrying could send a duplicate.';
    error.hidden = false;
    hostedSubmit.hidden = false;
    error.tabIndex = -1;
    error.focus();
  } finally {
    clearTimeout(timeout);
    pending = false;
    submit.disabled = false;
    hostedSubmit.disabled = false;
    submit.textContent = 'Send enquiry';
  }
});
