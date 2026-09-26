// Presentation only. Recorded reasons are lowercase fragments without a final full stop;
// this shapes them into a sentence for display. It never alters evidence, codes or the
// strings used for filtering and data attributes. Idempotent: an already-formed sentence
// is returned unchanged, so re-reading displayed text cannot compound punctuation.
export const asSentence = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `${text[0].toUpperCase()}${text.slice(1)}${/[.!?…]$/.test(text) ? "" : "."}`;
};
