import { SHARE_URL, SHARE_KEY } from "./shareConfig";

// The only code in ScriptOS that talks to the internet for sharing. The Supabase client
// isn't even loaded until someone uses Share or has already signed in, so anyone who
// never touches the feature makes no connection at all.
export const AUTH_KEY = "scriptos-share-auth";

let clientPromise = null;
const client = () => {
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(SHARE_URL, SHARE_KEY, {
        auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    );
  }
  return clientPromise;
};

const friendly = (error) => {
  const msg = error?.message || String(error);
  if (/fetch|network|load failed/i.test(msg)) return "Can't reach the server. Check your internet connection and try again.";
  return msg;
};

const run = async (query) => {
  let result;
  try {
    result = await query;
  } catch (err) {
    throw new Error(friendly(err));
  }
  if (result.error) throw new Error(friendly(result.error));
  return result.data;
};

export const realBackend = {
  configured: Boolean(SHARE_URL && SHARE_KEY),

  // accounts
  currentUser: async () => {
    const db = await client();
    const { data } = await db.auth.getSession();
    return data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null;
  },
  signUp: async ({ email, password, displayName }) => {
    const db = await client();
    const data = await run(db.auth.signUp({ email, password, options: { data: { display_name: displayName } } }));
    // no session means the project wants the email address confirmed first
    return { user: data.session ? { id: data.user.id, email: data.user.email } : null, confirm: !data.session };
  },
  signIn: async ({ email, password }) => {
    const db = await client();
    const data = await run(db.auth.signInWithPassword({ email, password }));
    return { id: data.user.id, email: data.user.email };
  },
  signOut: async () => {
    const db = await client();
    await run(db.auth.signOut());
  },
  getProfile: async (id) => {
    const db = await client();
    return run(db.from("profiles").select("id, display_name, avatar").eq("id", id).maybeSingle());
  },
  saveProfile: async (id, fields) => {
    const db = await client();
    await run(db.from("profiles").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id));
  },

  // sharing a script
  createShare: async (row) => {
    const db = await client();
    return run(db.from("shares").insert(row).select("id, code, access, updated_at").single());
  },
  updateShare: async (id, fields) => {
    const db = await client();
    return run(db.from("shares").update(fields).eq("id", id).select("id, code, access, updated_at").maybeSingle());
  },
  deleteShare: async (id) => {
    const db = await client();
    await run(db.from("shares").delete().eq("id", id));
  },
  getShare: async (id) => {
    const db = await client();
    return run(db.from("shares").select("*").eq("id", id).maybeSingle());
  },
  shareInfo: async (id) => {
    const db = await client();
    return run(db.from("shares").select("id, code, access, updated_at").eq("id", id).maybeSingle());
  },
  people: async (id) => {
    const db = await client();
    return run(db.rpc("share_people", { p_share: id }));
  },
  setMember: async (shareId, userId, status) => {
    const db = await client();
    await run(db.from("share_members").update({ status }).eq("share_id", shareId).eq("user_id", userId));
  },

  // reading someone else's
  join: async (code) => {
    const db = await client();
    return run(db.rpc("join_share", { p_code: code }));
  },
  sharedWithMe: async () => {
    const db = await client();
    return run(db.rpc("shared_with_me"));
  },
  leave: async (shareId, userId) => {
    const db = await client();
    await run(db.from("share_members").delete().eq("share_id", shareId).eq("user_id", userId));
  },

  // suggested edits
  changes: async (shareId) => {
    const db = await client();
    return run(db.from("share_changes").select("*").eq("share_id", shareId).order("created_at"));
  },
  saveChanges: async (rows) => {
    const db = await client();
    await run(db.from("share_changes").upsert(rows, { onConflict: "share_id,author,line" }));
  },
  deleteMyChanges: async (shareId, author, lines) => {
    const db = await client();
    await run(db.from("share_changes").delete().eq("share_id", shareId).eq("author", author).in("line", lines));
  },
  deleteChange: async (id) => {
    const db = await client();
    await run(db.from("share_changes").delete().eq("id", id));
  },

  // your uploaded scripts and scrambles, and your devices
  cloudList: async () => {
    const db = await client();
    return run(db.from("cloud_items").select("id, kind, rev, state"));
  },
  cloudFetch: async (ids) => {
    const db = await client();
    const out = [];
    // covers are big, so a few at a time
    for (let i = 0; i < ids.length; i += 15) {
      out.push(...(await run(db.from("cloud_items").select("id, kind, rev, data").eq("state", "live").in("id", ids.slice(i, i + 15)))));
    }
    return out;
  },
  cloudPush: async (id, kind, data, baseRev) => {
    const db = await client();
    return run(db.rpc("push_cloud_item", { p_id: id, p_kind: kind, p_data: data, p_base_rev: baseRev }));
  },
  cloudSetState: async (id, state) => {
    const db = await client();
    await run(db.rpc("set_cloud_state", { p_id: id, p_state: state }));
  },
  deviceCheckin: async (id, name, activity, relink) => {
    const db = await client();
    return run(db.rpc("device_checkin", { p_id: id, p_name: name, p_activity: activity || {}, p_relink: Boolean(relink) }));
  },
  devicesList: async () => {
    const db = await client();
    return run(db.from("sync_devices").select("id, name, role, removed, activity, last_seen"));
  },
  deviceTakeHost: async (id) => {
    const db = await client();
    await run(db.rpc("device_take_host", { p_id: id }));
  },
  deviceRemove: async (self, target) => {
    const db = await client();
    await run(db.rpc("device_remove", { p_self: self, p_target: target }));
  },

  // comments
  comments: async (shareId) => {
    const db = await client();
    return run(db.from("share_comments").select("*").eq("share_id", shareId).order("created_at"));
  },
  addComment: async (row) => {
    const db = await client();
    return run(db.from("share_comments").insert(row).select("*").single());
  },
  updateComment: async (id, fields) => {
    const db = await client();
    await run(db.from("share_comments").update(fields).eq("id", id));
  },
  deleteComment: async (id) => {
    const db = await client();
    await run(db.from("share_comments").delete().eq("id", id));
  },
};
