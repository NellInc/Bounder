import assert from "node:assert/strict";
import test from "node:test";

/* A minimal stand-in for the contact page's DOM: only what ui/contact-form.js touches. */
class FakeElement {
  constructor(text = "") {
    this.hidden = false;
    this.disabled = false;
    this.textContent = text;
    this.children = {};
    this.listeners = {};
    this.focused = false;
  }
  querySelector(selector) { return this.children[selector] ?? null; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() { this.focused = true; }
}

function makePage() {
  const label = new FakeElement("Send enquiry");
  const arrow = new FakeElement("→");
  const submit = new FakeElement();
  submit.children["[data-label]"] = label;
  const hosted = new FakeElement("Continue on Formspree");
  hosted.hidden = true;
  const form = new FakeElement();
  form.action = "https://formspree.io/f/xqalyykn";
  form.reportValidity = () => true;
  form.children['button[type="submit"]'] = submit;
  form.children["[data-hosted-submit]"] = hosted;
  const nodes = {
    "#contact-form": form,
    "#form-success": Object.assign(new FakeElement(), { hidden: true }),
    "#form-error": Object.assign(new FakeElement(), { hidden: true }),
    "#contact-form-title": new FakeElement("Start a conversation"),
    ".form-required-note": new FakeElement("All fields are required.")
  };
  return { nodes, form, submit, label, arrow, hosted };
}

let generation = 0;
async function loadWith(page, fetchImpl) {
  globalThis.document = { querySelector: (selector) => page.nodes[selector] ?? null };
  globalThis.fetch = fetchImpl;
  globalThis.FormData = class { constructor(form) { this.form = form; } };
  generation += 1;
  await import(`../ui/contact-form.js?case=${generation}`);
  return (submitter = page.submit) => page.form.listeners.submit({ submitter, preventDefault() {} });
}

test("a failed send restores only the label text, keeping the arrow, and focuses the error", async () => {
  const page = makePage();
  let labelWhileSending;
  const submit = await loadWith(page, async () => {
    labelWhileSending = page.label.textContent;
    return { ok: false };
  });
  await submit();
  assert.equal(labelWhileSending, "Sending enquiry…");
  assert.equal(page.label.textContent, "Send enquiry");
  assert.equal(page.submit.textContent, "", "the button's own text must not be overwritten");
  assert.equal(page.arrow.textContent, "→");
  const error = page.nodes["#form-error"];
  assert.equal(error.hidden, false);
  assert.equal(error.focused, true);
  assert.match(error.textContent, /^Our form provider could not accept this message\./, "a non-OK reply without a status is still the provider's rejection");
  assert.equal(page.hosted.hidden, false);
  assert.equal(page.nodes["#contact-form-title"].hidden, false, "the heading stays while the form is still shown");
  assert.equal(page.form.hidden, false);
});

test("a busy provider (429) says so instead of blaming the visitor's connection", async () => {
  const page = makePage();
  const submit = await loadWith(page, async () => ({ ok: false, status: 429 }));
  await submit();
  const error = page.nodes["#form-error"];
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /^The form is busy just now\. Your message is still here: please try again in a minute/);
  assert.doesNotMatch(error.textContent, /connection/);
  assert.equal(page.hosted.hidden, false, "the hosted route is still offered");
});

test("any other provider rejection is the provider's, not the connection's", async () => {
  for (const status of [400, 403, 422, 500, 503]) {
    const page = makePage();
    const submit = await loadWith(page, async () => ({ ok: false, status }));
    await submit();
    const error = page.nodes["#form-error"];
    assert.match(error.textContent, /^Our form provider could not accept this message\./, String(status));
    assert.doesNotMatch(error.textContent, /connection/, String(status));
  }
});

test("a network failure keeps the connection advice and the duplicate warning", async () => {
  const page = makePage();
  const submit = await loadWith(page, async () => { throw new TypeError("Failed to fetch"); });
  await submit();
  const error = page.nodes["#form-error"];
  assert.match(error.textContent, /^We could not confirm delivery\. Your message is still here: check your connection/);
  assert.match(error.textContent, /we may receive it twice\.$/);
  assert.equal(page.form.hidden, false);
});

test("provider-confirmed success hides the form together with its heading and note", async () => {
  const page = makePage();
  const submit = await loadWith(page, async () => ({ ok: true, json: async () => ({ next: "https://formspree.io/thanks" }) }));
  await submit();
  assert.equal(page.form.hidden, true);
  assert.equal(page.nodes["#contact-form-title"].hidden, true);
  assert.equal(page.nodes[".form-required-note"].hidden, true);
  assert.equal(page.nodes["#form-success"].hidden, false);
  assert.equal(page.nodes["#form-success"].focused, true);
});

test("an unconfirmed provider response is treated as a failure, not success", async () => {
  const page = makePage();
  const submit = await loadWith(page, async () => ({ ok: true, json: async () => ({ errors: [{ message: "Unavailable" }] }) }));
  await submit();
  assert.equal(page.nodes["#form-success"].hidden, true);
  assert.equal(page.nodes["#form-error"].hidden, false);
  assert.match(page.nodes["#form-error"].textContent, /^Our form provider could not accept this message\./);
  assert.equal(page.form.hidden, false);
});

test.after(() => {
  delete globalThis.document;
  delete globalThis.FormData;
});
