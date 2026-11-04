// DEV ONLY. An in-browser stand-in for the Supabase server, so the Share screens can be
// exercised as several different people without touching real accounts. It follows the
// same rules as supabase/schema.sql. Turned on with
// localStorage.scriptosFakeShare = "1" on the dev server; never in release builds.

import { AUTH_KEY } from "../lib/shareBackend";

const KEY = "scriptosFakeServer";
const load = () => ({ changes: [], cloud: [], devices: [], ...JSON.parse(localStorage.getItem(KEY) || '{"users":[],"shares":[],"members":[],"comments":[]}') });
const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
const newId = () => Math.random().toString(36).slice(2, 12);
const me = () => JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
const need = () => {
  const u = me();
  if (!u) throw new Error("Sign in first.");
  return u;
};
const canRead = (db, id) => {
  const u = me();
  const s = db.shares.find((x) => x.id === id);
  return Boolean(u && s && (s.owner === u.id || db.members.some((m) => m.share_id === id && m.user_id === u.id && m.status === "approved")));
};
const newCode = () => {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `${pick()}-${pick()}`;
};
const info = (s) => ({ id: s.id, code: s.code, access: s.access, updated_at: s.updated_at });

export const fakeBackend = {
  configured: true,
  currentUser: async () => me(),
  signUp: async ({ email, password, displayName }) => {
    const db = load();
    if (db.users.some((u) => u.email === email)) throw new Error("User already registered");
    if (password.length < 6) throw new Error("Password should be at least 6 characters.");
    const user = { id: newId(), email, password, display_name: displayName, avatar: null };
    db.users.push(user);
    save(db);
    const session = { id: user.id, email };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return { user: session, confirm: false };
  },
  signIn: async ({ email, password }) => {
    const user = load().users.find((u) => u.email === email && u.password === password);
    if (!user) throw new Error("Invalid login credentials");
    const session = { id: user.id, email };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return session;
  },
  signOut: async () => localStorage.removeItem(AUTH_KEY),
  getProfile: async (id) => load().users.find((u) => u.id === id) || null,
  saveProfile: async (id, fields) => {
    const db = load();
    Object.assign(db.users.find((u) => u.id === id), fields);
    save(db);
  },
  createShare: async (row) => {
    const db = load();
    const s = { ...row, id: newId(), code: newCode(), updated_at: new Date().toISOString() };
    db.shares.push(s);
    save(db);
    return info(s);
  },
  updateShare: async (id, fields) => {
    const db = load();
    const s = db.shares.find((x) => x.id === id && x.owner === me()?.id);
    if (!s) return null;
    Object.assign(s, fields, { updated_at: new Date().toISOString() });
    save(db);
    return info(s);
  },
  deleteShare: async (id) => {
    const db = load();
    if (db.shares.find((s) => s.id === id)?.owner !== me()?.id) return;
    db.shares = db.shares.filter((s) => s.id !== id);
    db.members = db.members.filter((m) => m.share_id !== id);
    db.comments = db.comments.filter((c) => c.share_id !== id);
    db.changes = db.changes.filter((c) => c.share_id !== id);
    save(db);
  },
  getShare: async (id) => {
    const db = load();
    return canRead(db, id) ? db.shares.find((s) => s.id === id) : null;
  },
  shareInfo: async (id) => {
    const db = load();
    const s = db.shares.find((x) => x.id === id);
    return s && canRead(db, id) ? info(s) : null;
  },
  people: async (id) => {
    const db = load();
    if (!canRead(db, id)) return [];
    const s = db.shares.find((x) => x.id === id);
    const owner = s.owner === me().id;
    const list = [{ id: s.owner, status: "owner" }, ...db.members.filter((m) => m.share_id === id && (owner || m.status === "approved")).map((m) => ({ id: m.user_id, status: m.status }))];
    return list.map((p) => {
      const u = db.users.find((x) => x.id === p.id);
      return { id: p.id, status: p.status, display_name: u?.display_name, avatar: u?.avatar };
    });
  },
  setMember: async (shareId, userId, status) => {
    const db = load();
    if (db.shares.find((s) => s.id === shareId)?.owner !== me()?.id) return;
    db.members.find((m) => m.share_id === shareId && m.user_id === userId).status = status;
    save(db);
  },
  join: async (code) => {
    const u = need();
    const db = load();
    const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const s = db.shares.find((x) => x.code.replace("-", "") === clean);
    if (!s) return { status: "not_found" };
    const owner_name = db.users.find((x) => x.id === s.owner)?.display_name;
    if (s.owner === u.id) return { status: "owner", share_id: s.id, title: s.title, owner_name };
    let m = db.members.find((x) => x.share_id === s.id && x.user_id === u.id);
    if (!m) {
      m = { share_id: s.id, user_id: u.id, status: s.access === "anyone" ? "approved" : "pending" };
      db.members.push(m);
    } else if (m.status === "pending" && s.access === "anyone") m.status = "approved";
    save(db);
    if (m.status === "denied") return { status: "denied" };
    return { status: m.status, share_id: s.id, title: s.title, owner_name };
  },
  sharedWithMe: async () => {
    const u = need();
    const db = load();
    return db.members
      .filter((m) => m.user_id === u.id && m.status !== "denied")
      .map((m) => {
        const s = db.shares.find((x) => x.id === m.share_id);
        return { share_id: s.id, status: m.status, title: s.title, updated_at: s.updated_at, owner_name: db.users.find((x) => x.id === s.owner)?.display_name };
      });
  },
  leave: async (shareId, userId) => {
    const db = load();
    db.members = db.members.filter((m) => !(m.share_id === shareId && m.user_id === userId));
    save(db);
  },
  changes: async (shareId) => {
    const db = load();
    return canRead(db, shareId) ? db.changes.filter((c) => c.share_id === shareId) : [];
  },
  saveChanges: async (rows) => {
    const db = load();
    for (const row of rows) {
      if (!canRead(db, row.share_id) || row.author !== me()?.id) throw new Error("new row violates row-level security policy");
      const cur = db.changes.find((c) => c.share_id === row.share_id && c.author === row.author && c.line === row.line);
      if (cur) Object.assign(cur, row, { updated_at: new Date().toISOString() });
      else db.changes.push({ ...row, id: newId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    save(db);
  },
  deleteMyChanges: async (shareId, author, lines) => {
    const db = load();
    db.changes = db.changes.filter((c) => !(c.share_id === shareId && c.author === author && lines.includes(c.line)));
    save(db);
  },
  deleteChange: async (id) => {
    const db = load();
    db.changes = db.changes.filter((c) => c.id !== id);
    save(db);
  },
  cloudList: async () => load().cloud.filter((i) => i.user_id === need().id).map(({ id, kind, rev, state }) => ({ id, kind, rev, state })),
  cloudFetch: async (ids) => load().cloud.filter((i) => i.user_id === need().id && i.state === "live" && ids.includes(i.id)).map(({ id, kind, rev, data }) => ({ id, kind, rev, data })),
  cloudPush: async (id, kind, data, baseRev) => {
    const db = load();
    const u = need().id;
    const cur = db.cloud.find((i) => i.user_id === u && i.id === id);
    if (!cur) {
      db.cloud.push({ user_id: u, id, kind, state: "live", rev: 1, data });
      save(db);
      return { rev: 1 };
    }
    if (cur.state === "live" && cur.rev !== baseRev) return { conflict: true, rev: cur.rev };
    Object.assign(cur, { data, kind, state: "live", rev: cur.rev + 1 });
    save(db);
    return { rev: cur.rev };
  },
  cloudSetState: async (id, state) => {
    const db = load();
    const cur = db.cloud.find((i) => i.user_id === need().id && i.id === id);
    if (cur) Object.assign(cur, { state, data: null, rev: cur.rev + 1 });
    save(db);
  },
  deviceCheckin: async (id, name, activity, relink) => {
    const db = load();
    const u = need().id;
    const mine = db.devices.filter((d) => d.user_id === u);
    const cur = mine.find((d) => d.id === id);
    if (cur?.removed && !relink) return { removed: true, role: cur.role };
    const role = cur && !cur.removed ? cur.role : mine.some((d) => d.role === "host" && !d.removed) ? "link" : "host";
    if (cur) Object.assign(cur, { name, role, activity, removed: false, last_seen: new Date().toISOString() });
    else db.devices.push({ user_id: u, id, name, role, activity, removed: false, last_seen: new Date().toISOString() });
    save(db);
    return { role };
  },
  devicesList: async () => load().devices.filter((d) => d.user_id === need().id),
  deviceTakeHost: async (id) => {
    const db = load();
    const u = need().id;
    for (const d of db.devices) if (d.user_id === u) d.role = d.id === id ? "host" : "link";
    save(db);
  },
  deviceRemove: async (self, target) => {
    const db = load();
    const u = need().id;
    if (db.devices.find((d) => d.user_id === u && d.id === self)?.role !== "host") throw new Error("Only the Host can remove a device.");
    Object.assign(db.devices.find((d) => d.user_id === u && d.id === target), { removed: true, role: "link" });
    save(db);
  },
  comments: async (shareId) => {
    const db = load();
    return canRead(db, shareId) ? db.comments.filter((c) => c.share_id === shareId) : [];
  },
  addComment: async (row) => {
    const db = load();
    if (!canRead(db, row.share_id)) throw new Error("new row violates row-level security policy");
    const c = { ...row, id: newId(), resolved: false, created_at: new Date().toISOString() };
    db.comments.push(c);
    save(db);
    return c;
  },
  updateComment: async (id, fields) => {
    const db = load();
    Object.assign(db.comments.find((c) => c.id === id) || {}, fields);
    save(db);
  },
  deleteComment: async (id) => {
    const db = load();
    db.comments = db.comments.filter((c) => c.id !== id);
    save(db);
  },
};
