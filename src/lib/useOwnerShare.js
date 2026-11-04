import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { backend, buildSnapshot, fetchOwnerData, mergeComments, reviewersFrom, sanitizeHtml, snapshotKey, startShare, uploadChanges, useAccount } from "./share";
import { TYPE_BY_KEY } from "./script";
import { applyChange, changeIsDone } from "./suggest";
import { flushAll } from "./storage";
import { notify } from "./notice";

const EVERY = 5000;
const UPLOAD_AFTER = 3000;

// The writer's side of a shared script. While it's shared, new comments and access
// requests are checked for now and then, and every comment is saved onto the script as
// it arrives, so nothing depends on the server still being there later.
export function useOwnerShare(script, store) {
  const { user } = useAccount();
  const share = script?.share || null;
  const [people, setPeople] = useState({});
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const scriptRef = useRef(script);
  scriptRef.current = script;
  // the store's functions are rebuilt with every edit, and this mustn't re-check the
  // server each time they are
  const updateRef = useRef(store.updateScript);
  updateRef.current = store.updateScript;
  const update = useCallback((...args) => updateRef.current(...args), []);
  const id = script?.id;
  const shareId = share?.id;
  const mine = Boolean(share && user && share.ownerId === user.id);

  const absorb = useCallback(
    (data) => {
      const cur = scriptRef.current;
      if (!cur?.share) return;
      const comments = mergeComments(cur.comments, cur.share.id, data.comments);
      const reviewers = reviewersFrom(cur.reviewers, data.people);
      // A suggestion the script already matches is finished with, wherever that happened:
      // accepted while offline, or the writer typing the same thing.
      const finished = data.changes.filter((c) => changeIsDone(c, cur.blocks));
      if (finished.length) {
        backend().then((api) => finished.forEach((c) => api.deleteChange(c.id).catch(() => {})));
      }
      const suggestions = mergeComments(cur.suggestions, cur.share.id, data.changes.filter((c) => !finished.includes(c)));
      const changes = {};
      if (JSON.stringify(suggestions) !== JSON.stringify(cur.suggestions || [])) changes.suggestions = suggestions;
      if (JSON.stringify(comments) !== JSON.stringify(cur.comments || [])) changes.comments = comments;
      if (JSON.stringify(reviewers) !== JSON.stringify(cur.reviewers || {})) changes.reviewers = reviewers;
      if (Object.keys(changes).length) update(id, changes);
    },
    [id, update]
  );

  const refresh = useCallback(async () => {
    const cur = scriptRef.current;
    if (!cur?.share) return;
    try {
      const data = await fetchOwnerData(cur.share);
      setOnline(true);
      if (!data.info) {
        // stopped from another device: what's here is all there is now
        update(id, { share: null });
        notify("Sharing has ended", { detail: "The comments stay on this script." });
        return;
      }
      setPeople(data.people);
      absorb(data);
    } catch {
      setOnline(false);
    }
  }, [absorb, id, update]);

  useEffect(() => {
    if (!shareId || !mine) return;
    refresh();
    const timer = setInterval(refresh, EVERY);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [shareId, mine, refresh]);

  const requests = useMemo(() => Object.values(people).filter((p) => p.status === "pending"), [people]);
  const readers = useMemo(() => Object.values(people).filter((p) => p.status === "approved"), [people]);

  const outOfDate = useMemo(() => {
    if (!share || !script) return false;
    return snapshotKey(buildSnapshot(script, share)) !== share.uploadedKey;
  }, [script, share]);

  const guarded = async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  const start = (options) =>
    guarded(async () => {
      update(id, { share: await startShare(scriptRef.current, options) });
    });

  const upload = () =>
    guarded(async () => {
      update(id, { share: await uploadChanges(scriptRef.current) });
    });

  // While it's shared, your edits go up a moment after you stop typing, as in Google Docs.
  const uploading = useRef(false);
  useEffect(() => {
    if (!shareId || !mine || !outOfDate) return;
    const t = setTimeout(async () => {
      if (uploading.current) return;
      uploading.current = true;
      try {
        const sent = await uploadChanges(scriptRef.current);
        // sharing may have stopped while that was on its way
        if (scriptRef.current?.share?.id === shareId) update(id, { share: sent });
        setOnline(true);
      } catch {
        setOnline(false);
      } finally {
        uploading.current = false;
      }
    }, UPLOAD_AFTER);
    return () => clearTimeout(t);
  }, [shareId, mine, outOfDate, script?.blocks, script?.title, script?.cover, script?.cast, id, update]);

  const dropSuggestions = (list) => {
    const gone = new Set(list.map((c) => c.id));
    update(id, { suggestions: (scriptRef.current.suggestions || []).filter((x) => !gone.has(x.id)) });
  };

  // Accepting: the other person's html is cleaned again on its way into your script, and
  // it goes in through the editor so however many there are, it's one undoable step. The
  // new text goes up before the suggestions come down, so nobody sees a line flick back.
  const acceptChanges = async (list, applyBlocks) => {
    const cur = scriptRef.current;
    const options = {
      clean: sanitizeHtml,
      validType: (t) => Boolean(TYPE_BY_KEY[t]) && t !== "pagebreak",
      inserts: (cur.suggestions || []).filter((x) => x.op === "insert"),
    };
    const next = list.reduce((blocks, c) => applyChange(blocks, c, options), cur.blocks);
    applyBlocks(next);
    dropSuggestions(list);
    const live = list.filter(onServer);
    if (!live.length) return;
    try {
      const sent = await uploadChanges({ ...scriptRef.current, blocks: next });
      if (scriptRef.current?.share?.id === shareId) update(id, { share: sent });
      const api = await backend();
      await Promise.all(live.map((c) => api.deleteChange(c.id)));
    } catch {
      setOnline(false); // the next check clears them, because the script now matches
    }
  };

  const rejectChanges = async (list) => {
    try {
      const live = list.filter(onServer);
      if (live.length) {
        const api = await backend();
        await Promise.all(live.map((c) => api.deleteChange(c.id)));
      }
    } catch {
      notify("Couldn't reach the server", { tone: "bad" });
      return;
    }
    dropSuggestions(list);
  };

  const setAccess = (access) =>
    guarded(async () => {
      const api = await backend();
      await api.updateShare(shareId, { access });
      update(id, { share: { ...scriptRef.current.share, access } });
    });

  const decide = (userId, status) =>
    guarded(async () => {
      const api = await backend();
      await api.setMember(shareId, userId, status);
      await refresh();
    });

  // Taking it offline. The comments are fetched and written to disk first: if that
  // fails nothing is deleted, and the script stays shared until it can be done safely.
  const stop = () =>
    guarded(async () => {
      if (!mine) throw new Error("Sign in with the account that shared this script first.");
      const api = await backend();
      const data = await fetchOwnerData(scriptRef.current.share);
      absorb(data);
      await new Promise((r) => setTimeout(r, 60));
      await flushAll();
      if (data.info) {
        await api.deleteShare(shareId);
        if (await api.shareInfo(shareId)) throw new Error("The server didn't remove the script. Try again.");
      }
      update(id, { share: null });
    });

  // Ticking off or deleting works offline for comments already kept here; while shared
  // the server's copy is changed too, so readers see the same list.
  const onServer = (c) => share && c.shareId === share.id && mine;

  const resolveComment = async (c) => {
    const resolved = !c.resolved;
    update(id, { comments: (scriptRef.current.comments || []).map((x) => (x.id === c.id ? { ...x, resolved } : x)) });
    if (onServer(c)) await (await backend()).updateComment(c.id, { resolved }).catch(() => notify("Couldn't reach the server", { tone: "bad" }));
  };

  const deleteComment = async (c) => {
    if (onServer(c)) {
      try {
        await (await backend()).deleteComment(c.id);
      } catch {
        notify("Couldn't reach the server", { tone: "bad" });
        return;
      }
    }
    update(id, { comments: (scriptRef.current.comments || []).filter((x) => x.id !== c.id) });
  };

  return { share, mine, online, busy, people, requests, readers, outOfDate, refresh, start, upload, setAccess, decide, stop, resolveComment, deleteComment, acceptChanges, rejectChanges };
}

// Deleting a script that's still shared takes its copy off the server first.
export async function removeFromServer(share) {
  const api = await backend();
  await api.deleteShare(share.id);
  if (await api.shareInfo(share.id)) throw new Error("The server didn't remove the script.");
}
