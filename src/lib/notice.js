// Short status messages from anywhere in the app. App shows the latest one for a moment.
export const NOTICE_EVENT = "scriptos:notice";

export const notify = (text, { detail = "", tone = "" } = {}) =>
  window.dispatchEvent(
    new CustomEvent(NOTICE_EVENT, { detail: { text, detail, tone, key: `${Date.now()}-${Math.random()}` } })
  );
