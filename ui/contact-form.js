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

// The provider answered, but not with success. Its status says whose problem it is.
class ProviderStatusError extends Error {
  constructor(status) {
    super('provider_rejected');
    this.status = status;
  }
}

const KEPT = 'Your message is still here';
const failureMessage = (failure) => {
  if (failure instanceof ProviderStatusError && failure.status === 429) {
    return `The form is busy just now. ${KEPT}: please try again in a minute, or continue on Formspree below.`;
  }
  if (failure instanceof ProviderStatusError || failure?.message === 'provider_unconfirmed') {
    return `Our form provider could not accept this message. ${KEPT}: try again shortly, or continue on Formspree below.`;
  }
  // No usable response at all: a dropped connection, a timeout, or an unreadable reply.
  return `We could not confirm delivery. ${KEPT}: check your connection and try again, or continue on Formspree below. If the first attempt did arrive, we may receive it twice.`;
};

// A page on another origin that frames this form could overlay it to trick a visitor into
// sending. Same-origin framing is allowed. Meta-tag CSP cannot set frame-ancestors and GitHub
// Pages sends no framing headers, so this is a best-effort guard, not a guarantee.
const framedByOtherOrigin = () => {
  if (typeof window === 'undefined' || window.top === window.self) return false;
  try {
    return window.top.location.origin !== window.location.origin;
  } catch {
    return true;
  }
};

if (framedByOtherOrigin()) {
  const notice = document.createElement('p');
  notice.className = 'form-notice form-notice-error';
  const link = document.createElement('a');
  link.href = window.location.href;
  link.target = '_top';
  link.rel = 'noopener';
  link.textContent = 'Open the contact page in its own window';
  notice.append('This form does not work inside another site. ', link, '.');
  form.hidden = true;
  form.before(notice);
}

form.addEventListener('submit', async (event) => {
  if (framedByOtherOrigin()) {
    event.preventDefault();
    return;
  }
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
    if (!response.ok) throw new ProviderStatusError(response.status);
    const result = await response.json();
    // Match the provider's @formspree/core success contract; never follow its URL here.
    if (!result || typeof result.next !== 'string' || result.error || result.errors) throw new Error('provider_unconfirmed');
    // Only an affirmative provider response can show acceptance. Query parameters cannot.
    success.hidden = false;
    success.tabIndex = -1;
    form.hidden = true;
    for (const element of formIntro) element.hidden = true;
    success.focus();
  } catch (failure) {
    error.textContent = failureMessage(failure);
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
