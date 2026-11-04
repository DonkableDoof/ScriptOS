import { useEffect, useState } from "react";
import { realBackend, AUTH_KEY } from "./shareBackend";
import { safeColor, safeImage, sanitizeHtml } from "./sanitize";
import { PRIVATE_TYPES, TYPE_BY_KEY, withoutParenthetical } from "./script";
import { shrinkCast, shrinkIcon } from "./image";

// ---------------------------------------------------------------------------
// Share. Sharing uploads a copy of a script; other people read it, comment on it and
// suggest edits to it. Comments and suggestions are also kept on the script itself as
// they arrive, so when sharing stops they stay here while the server forgets the copy.
// ---------------------------------------------------------------------------

const fakeOn = () => import.meta.env.DEV && localStorage.getItem("scriptosFakeShare") === "1";
let fake = null;
export const backend = async () => {
  if (fakeOn()) {
    if (!fake) fake = (await import("../dev/fakeShare")).fakeBackend;
    return fake;
  }
  return realBackend;
};

export const shareAvailable = () => realBackend.configured || fakeOn();
const hasSavedSession = () => {
  try {
    return localStorage.getItem(AUTH_KEY) !== null;
  } catch {
    return false;
  }
};

export const COMMENT_KINDS = [
  { key: "comment", label: "Comment" },
  { key: "remove", label: "Remove" },
  { key: "add", label: "Add" },
  { key: "edit", label: "Edit" },
];
export const KIND_LABEL = Object.fromEntries(COMMENT_KINDS.map((k) => [k.key, k.label]));

export const ACCESS = [
  { value: "anyone", label: "Anyone with the code" },
  { value: "request", label: "Ask me first" },
];

// ---------------------------------------------------------------------------
// The signed-in account
// ---------------------------------------------------------------------------
let account = { ready: false, user: null, profile: null };
let started = false;
const listeners = new Set();
const publish = (next) => {
  account = { ...account, ...next };
  listeners.forEach((fn) => fn(account));
};

const cleanProfile = (p) => (p ? { id: p.id, name: String(p.display_name || "Unnamed"), avatar: safeImage(p.avatar) } : null);

export async function refreshAccount() {
  const api = await backend();
  let user = null;
  try {
    user = await api.currentUser();
  } catch {
    user = null;
  }
  let profile = null;
  if (user) {
    try {
      const row = await api.getProfile(user.id);
      // a picture saved before pictures were limited to icon size
      const small = row?.avatar ? await shrinkIcon(row.avatar) : null;
      if (small && small !== row.avatar) {
        await api.saveProfile(user.id, { avatar: small });
        row.avatar = small;
      }
      profile = cleanProfile(row);
    } catch {
      profile = account.profile; // offline: keep showing what we knew
    }
  }
  publish({ ready: true, user, profile });
  return user;
}

export function useAccount() {
  const [state, setState] = useState(account);
  useEffect(() => {
    listeners.add(setState);
    setState(account);
    if (!started) {
      started = true;
      // with no saved sign-in there's nothing to ask a server about
      if (shareAvailable() && hasSavedSession()) refreshAccount();
      else publish({ ready: true });
    }
    return () => listeners.delete(setState);
  }, []);
  return state;
}

const PENDING_AVATAR = "scriptos-share-pending-avatar";

export async function signUp({ email, password, displayName, avatar }) {
  const api = await backend();
  const { user, confirm } = await api.signUp({ email, password, displayName });
  if (user) {
    if (avatar) await api.saveProfile(user.id, { avatar });
    await refreshAccount();
    return { signedIn: true };
  }
  // the picture has to wait until they can sign in
  if (avatar) localStorage.setItem(PENDING_AVATAR, avatar);
  return { confirm };
}

export async function signIn({ email, password }) {
  const api = await backend();
  const user = await api.signIn({ email, password });
  const avatar = localStorage.getItem(PENDING_AVATAR);
  if (avatar) {
    await api.saveProfile(user.id, { avatar }).catch(() => {});
    localStorage.removeItem(PENDING_AVATAR);
  }
  await refreshAccount();
}

export async function signOut() {
  const api = await backend();
  await api.signOut();
  publish({ user: null, profile: null, ready: true });
}

export async function saveProfile(fields) {
  const api = await backend();
  await api.saveProfile(account.user.id, fields);
  await refreshAccount();
}

// ---------------------------------------------------------------------------
// Sharing your own script
// ---------------------------------------------------------------------------

// What goes up: a copy of the script, its cover and its characters' colours and icons.
// Notes and subtext are private unless you say otherwise. Local comments never go.
export const buildSnapshot = (script, { includeNotes = false, includeSubtext = false } = {}) => {
  const blocks = script.blocks
    .filter((b) => !PRIVATE_TYPES.has(b.type) || (b.type === "note" ? includeNotes : includeSubtext))
    .map(({ id, type, html, color, indent, checked }) => ({ id, type, html, color: color || null, indent: indent || 0, checked: Boolean(checked) }));
  const names = new Set(blocks.filter((b) => b.type === "character").map((b) => b.html.replace(/<[^>]+>/g, "").replace(/\(.*?\)/g, "").trim().toUpperCase()));
  const characters = Object.fromEntries(Object.entries(script.cast || {}).filter(([name, c]) => names.has(name) && (c?.color || c?.icon)));
  return {
    title: script.title || "Untitled Script",
    cover: script.cover || null,
    characters,
    script: {
      format: script.format,
      author: script.author || "",
      draft: script.draft || "",
      logline: script.logline || "",
      show: script.show || "",
      season: script.season || "",
      episode: script.episode || "",
      blocks,
    },
  };
};

const parts = (snapshot) => ({
  title: snapshotKey({ t: snapshot.title }),
  cover: snapshotKey({ c: snapshot.cover }),
  characters: snapshotKey(snapshot.characters),
  script: snapshotKey(snapshot.script),
});

// A fingerprint of a snapshot, to tell whether the server's copy is out of date.
export const snapshotKey = (snapshot) => {
  const text = JSON.stringify(snapshot);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}:${h}`;
};

export async function startShare(script, { access, includeNotes, includeSubtext }) {
  const api = await backend();
  const snapshot = buildSnapshot(script, { includeNotes, includeSubtext });
  const row = await api.createShare({ ...snapshot, characters: await shrinkCast(snapshot.characters), owner: account.user.id, access });
  return {
    id: row.id,
    code: row.code,
    access: row.access,
    ownerId: account.user.id,
    includeNotes: Boolean(includeNotes),
    includeSubtext: Boolean(includeSubtext),
    since: Date.now(),
    uploadedKey: snapshotKey(snapshot),
    uploadedParts: parts(snapshot),
    uploadedAt: Date.now(),
  };
}

// Sends what's changed since the last upload. A cover or an icon only goes up when it
// has actually changed, because they're far bigger than the words.
export async function uploadChanges(script) {
  const api = await backend();
  const snapshot = buildSnapshot(script, script.share);
  const now = parts(snapshot);
  const was = script.share.uploadedParts || {};
  const fields = {};
  for (const key of Object.keys(now)) if (now[key] !== was[key]) fields[key] = key === "characters" ? await shrinkCast(snapshot.characters) : snapshot[key];
  if (Object.keys(fields).length) {
    const row = await api.updateShare(script.share.id, fields);
    if (!row) throw new Error("This script is no longer on the server.");
  }
  return { ...script.share, uploadedKey: snapshotKey(snapshot), uploadedParts: now, uploadedAt: Date.now() };
}

const mapComment = (c, shareId) => ({
  id: String(c.id),
  shareId,
  blockId: c.block_id ? String(c.block_id) : null,
  quote: String(c.quote || ""),
  kind: KIND_LABEL[c.kind] ? c.kind : "comment",
  body: String(c.body || ""),
  authorId: c.author || null,
  createdAt: Date.parse(c.created_at) || Date.now(),
  resolved: Boolean(c.resolved),
});

// A suggested change: someone else's words, so the html is cleaned before anything can use it.
const mapChange = (c, shareId) => ({
  id: String(c.id),
  shareId,
  authorId: c.author || null,
  line: String(c.line),
  op: ["edit", "insert", "delete"].includes(c.op) ? c.op : "edit",
  after_line: String(c.after_line || ""),
  line_type: TYPE_BY_KEY[c.line_type] ? c.line_type : "",
  html: sanitizeHtml(c.html),
  baseHtml: sanitizeHtml(c.base_html),
  updatedAt: Date.parse(c.updated_at) || Date.now(),
});

const mapPeople = (list) =>
  Object.fromEntries(
    (list || []).map((p) => [String(p.id), { id: String(p.id), name: String(p.display_name || "Unnamed"), avatar: safeImage(p.avatar), status: String(p.status || "") }])
  );

// Comments from this sharing, with anything kept from earlier ones left alone.
export const mergeComments = (local, shareId, remote) => [...(local || []).filter((c) => c.shareId !== shareId), ...remote];

// Who wrote what, kept beside the comments so they still have names once offline.
export const reviewersFrom = (old, people) => {
  const out = { ...(old || {}) };
  for (const p of Object.values(people)) out[p.id] = { name: p.name, avatar: p.avatar };
  return out;
};

export async function fetchOwnerData(share) {
  const api = await backend();
  const [info, comments, changes, people] = await Promise.all([api.shareInfo(share.id), api.comments(share.id), api.changes(share.id), api.people(share.id)]);
  return { info, comments: comments.map((c) => mapComment(c, share.id)), changes: changes.map((c) => mapChange(c, share.id)), people: mapPeople(people) };
}

// ---------------------------------------------------------------------------
// Reading someone else's. Everything here is theirs, so it's all cleaned first, and
// none of it is ever saved on this device.
// ---------------------------------------------------------------------------
const text = (v) => (typeof v === "string" ? v : "");

const cleanShare = (row) => {
  const blocks = Array.isArray(row.script?.blocks) ? row.script.blocks : [];
  const characters = {};
  for (const [name, c] of Object.entries(row.characters || {})) {
    characters[String(name)] = { color: safeColor(c?.color), icon: safeImage(c?.icon) };
  }
  return {
    id: row.id,
    ownerId: row.owner,
    title: text(row.title) || "Untitled Script",
    updatedAt: Date.parse(row.updated_at) || null,
    cover: safeImage(row.cover),
    characters,
    format: text(row.script?.format),
    author: text(row.script?.author),
    draft: text(row.script?.draft),
    logline: text(row.script?.logline),
    blocks: blocks
      .filter(Boolean)
      .map(withoutParenthetical)
      .filter((b) => TYPE_BY_KEY[b.type])
      .map((b) => ({
        id: String(b.id),
        type: b.type,
        html: sanitizeHtml(b.html),
        color: safeColor(b.color),
        indent: Math.max(0, Math.min(4, Number(b.indent) || 0)),
        checked: Boolean(b.checked),
      })),
  };
};

export async function loadShareFull(id) {
  const api = await backend();
  const [row, comments, changes, people] = await Promise.all([api.getShare(id), api.comments(id), api.changes(id), api.people(id)]);
  if (!row) return null;
  return { share: cleanShare(row), comments: comments.map((c) => mapComment(c, id)), changes: changes.map((c) => mapChange(c, id)), people: mapPeople(people) };
}

// The regular check while reading: small, unless the writer has changed the script.
export async function loadShareUpdates(id, knownUpdatedAt, withPeople) {
  const api = await backend();
  const info = await api.shareInfo(id);
  if (!info) return { gone: true };
  const [comments, changes, people] = await Promise.all([api.comments(id), api.changes(id), withPeople ? api.people(id) : null]);
  const update = { comments: comments.map((c) => mapComment(c, id)), changes: changes.map((c) => mapChange(c, id)) };
  if (people) update.people = mapPeople(people);
  if ((Date.parse(info.updated_at) || null) !== knownUpdatedAt) {
    const row = await api.getShare(id);
    if (row) update.share = cleanShare(row);
  }
  return update;
}

// Sends the difference between what I've changed now and what the server has from me.
export async function saveMyChanges(shareId, me, wanted, synced) {
  const api = await backend();
  const now = new Map(wanted.map((c) => [c.line, c]));
  const stale = [...synced.keys()].filter((line) => !now.has(line));
  const send = wanted.filter((c) => {
    const had = synced.get(c.line);
    return !had || had.html !== sanitizeHtml(c.html) || had.op !== c.op || had.after_line !== c.after_line || (had.line_type || "") !== (c.line_type || "");
  });
  if (send.length) {
    await api.saveChanges(
      send.map((c) => ({ share_id: shareId, author: me, line: c.line, op: c.op, after_line: c.after_line || "", line_type: c.line_type || "", html: c.html || "", base_html: c.base_html || "" }))
    );
  }
  if (stale.length) await api.deleteMyChanges(shareId, me, stale);
  return new Map(wanted.map((c) => [c.line, { ...c, html: sanitizeHtml(c.html) }]));
}

export { sanitizeHtml };

export async function joinWithCode(code) {
  const api = await backend();
  return api.join(code);
}

export async function sharedWithMe() {
  const api = await backend();
  const list = await api.sharedWithMe();
  return (list || []).map((s) => ({
    id: String(s.share_id),
    status: String(s.status),
    title: text(s.title) || "Untitled Script",
    ownerName: text(s.owner_name) || "Someone",
    updatedAt: Date.parse(s.updated_at) || null,
  }));
}

export async function leaveShared(id) {
  const api = await backend();
  await api.leave(id, account.user.id);
}

export async function postComment(shareId, { blockId, quote, kind, body }) {
  const api = await backend();
  const row = await api.addComment({ share_id: shareId, author: account.user.id, block_id: blockId || null, quote: quote || null, kind, body });
  return mapComment(row, shareId);
}
