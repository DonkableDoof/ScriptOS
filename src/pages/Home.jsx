import { useMemo, useRef, useState } from "react";
import ScriptCard from "../components/ScriptCard";
import ScriptDetails from "../components/ScriptDetails";
import Confirm from "../components/Confirm";
import Popover from "../components/Popover";
import Modal from "../components/Modal";
import { StatTiles, GoalPanel, FunFacts } from "../components/StatsPanel";
import { useStore } from "../lib/store";
import Select from "../components/Select";
import { scriptStats, newScript, FORMATS } from "../lib/script";
import { parseFountain, toFountain, fileNameFor } from "../lib/fountain";
import { pickTextFile, pickFile, saveTextFile, fetchGoogleDoc } from "../lib/native";
import { parseDocx, googleDocId } from "../lib/docx";
import { notify } from "../lib/notice";
import { sfx } from "../lib/sound";

// A tab for each format, shown once there is a script in it.
const FILTERS = [
  { key: "all", label: "All", test: (s) => !s.archived },
  ...FORMATS.map((f) => ({ key: f.key, label: f.plural, test: (s) => !s.archived && s.format === f.key, optional: true })),
  { key: "archived", label: "Archived", test: (s) => s.archived, optional: true },
];

const SORTS = [
  { key: "edited", label: "Last Edited", fn: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) },
  { key: "created", label: "Newest", fn: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) },
  { key: "title", label: "Title", fn: (a, b) => (a.title || "").localeCompare(b.title || "") },
];


export default function Home({ navigate }) {
  const store = useStore();
  const { scripts, activity, settings } = store;
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("edited");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [menu, setMenu] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [google, setGoogle] = useState(null);
  const importRef = useRef(null);

  const statsById = useMemo(() => Object.fromEntries(scripts.map((s) => [s.id, scriptStats(s)])), [scripts]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, scripts.filter(f.test).length])),
    [scripts]
  );

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    const q = query.trim().toLowerCase();
    const sorter = SORTS.find((s) => s.key === sort)?.fn || SORTS[0].fn;
    return scripts
      .filter(f.test)
      .filter((s) => !q || [s.title, s.show, s.logline, s.author].some((v) => String(v || "").toLowerCase().includes(q)))
      .sort(sorter);
  }, [scripts, filter, query, sort]);

  const openNew = () => {
    setCreating(newScript({ author: settings.lastAuthor || "" }));
    sfx.play("open");
  };

  const finishImport = (fields) => {
    const script = store.addScript(fields);
    notify(`Imported “${script.title}”`, { detail: `${fields.blocks.length} elements` });
    sfx.play("complete");
  };
  const importFailed = (err) => {
    notify("Import failed", { detail: err?.message || String(err), tone: "bad" });
    sfx.play("error");
  };
  const stem = (name) => name.replace(/\.[^.]+$/, "");

  const importFountain = async () => {
    setImportOpen(false);
    try {
      const file = await pickTextFile(".fountain,.txt,.spmd,text/plain");
      if (!file) return;
      const { blocks, meta } = parseFountain(file.text, { titlePage: true });
      if (!blocks.length) throw new Error("There was no script in that file.");
      finishImport({
        title: meta.title?.replace(/[*_]/g, "") || stem(file.name),
        author: meta.author || meta.authors || "",
        contact: meta.contact || "",
        draft: meta["draft date"] || "",
        blocks,
      });
    } catch (err) {
      importFailed(err);
    }
  };

  const importWord = async () => {
    setImportOpen(false);
    try {
      const file = await pickFile(".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      if (!file) return;
      const { blocks, meta } = await parseDocx(file.buffer);
      finishImport({ title: meta.title || stem(file.name), author: meta.author || "", blocks });
    } catch (err) {
      importFailed(err);
    }
  };

  const importGoogle = async () => {
    const id = googleDocId(google.link);
    if (!id) {
      setGoogle({ ...google, error: "Paste the link from the address bar or the Share button." });
      return;
    }
    setGoogle({ ...google, busy: true, error: "" });
    try {
      const { blocks, meta } = await parseDocx(await fetchGoogleDoc(id));
      setGoogle(null);
      finishImport({ title: meta.title || "Google Doc", author: meta.author || "", blocks });
    } catch (err) {
      setGoogle((g) => g && { ...g, busy: false, error: err?.message || String(err) });
      sfx.play("error");
    }
  };

  const menuScript = menu ? scripts.find((s) => s.id === menu.id) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/icon.png" alt="" width="34" height="34" />
          <div className="brand-text">
            <div className="brand-name">ScriptOS</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button ref={importRef} className="btn btn-ghost" onClick={() => setImportOpen((v) => !v)}>
            Import ▾
          </button>
          <button className="btn btn-primary" onClick={openNew}>
            + New Script
          </button>
          <button className="btn btn-settings" onClick={() => navigate({ page: "settings" })} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      <div className="home">
        <StatTiles activity={activity} />

        <div className="main">
          <section>
            <div className="section-head">
              <div>
                <h1 className="h1">Your Scripts</h1>
              </div>
              <div className="toolbar">
                <input
                  className="search"
                  placeholder="Search scripts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Select
                  compact
                  label="Sort by"
                  value={sort}
                  options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
                  onChange={setSort}
                />
                <div className="tabs">
                  {FILTERS.filter((f) => !f.optional || counts[f.key] > 0 || filter === f.key).map((f) => (
                    <button key={f.key} className="tab" data-active={filter === f.key} onClick={() => setFilter(f.key)}>
                      {f.label}
                      <span className="tab-count">{counts[f.key]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="gallery">
              {filter !== "archived" && !query && (
                <button className="scard scard-new" onClick={openNew}>
                  <span className="scard-new-plus">+</span>
                  <span>New Script</span>
                </button>
              )}
              {shown.map((s) => (
                <ScriptCard
                  key={s.id}
                  script={s}
                  stats={statsById[s.id]}
                  onOpen={() => navigate({ page: "script", id: s.id })}
                  onMenu={(anchor) => setMenu({ id: s.id, anchor })}
                />
              ))}
            </div>

            {shown.length === 0 && (
              <div className="empty">
                <span className="empty-title">{query ? "No matches" : filter === "all" ? "FADE IN:" : "Nothing here"}</span>
              </div>
            )}
          </section>

          <aside className="rail">
            {Number(settings.dailyGoal) > 0 && <GoalPanel activity={activity} goal={Number(settings.dailyGoal)} />}
            <FunFacts scripts={scripts} statsById={statsById} activity={activity} />
          </aside>
        </div>
      </div>

      {menuScript && (
        <Popover anchorRef={menu.anchor} width={200} align="right" className="card-menu" onClose={() => setMenu(null)}>
          <button className="menu-item" onClick={() => navigate({ page: "script", id: menuScript.id })}>
            <span className="menu-icon">↗</span>Open
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setEditing(menuScript);
              setMenu(null);
            }}
          >
            <span className="menu-icon">✎</span>Details & Cover
          </button>
          <button
            className="menu-item"
            onClick={() => {
              store.duplicateScript(menuScript.id);
              setMenu(null);
              sfx.play("add");
            }}
          >
            <span className="menu-icon">⧉</span>Duplicate
          </button>
          <button
            className="menu-item"
            onClick={async () => {
              setMenu(null);
              await saveTextFile(fileNameFor(menuScript, "fountain"), toFountain(menuScript, { includeNotes: settings.exportNotes, includeSubtext: settings.exportSubtext }), {
                label: "Fountain screenplay",
                extensions: ["fountain"],
              });
            }}
          >
            <span className="menu-icon">⇩</span>Export Fountain
          </button>
          <button
            className="menu-item"
            onClick={() => {
              store.updateScript(menuScript.id, { archived: !menuScript.archived });
              setMenu(null);
            }}
          >
            <span className="menu-icon">{menuScript.archived ? "↺" : "▤"}</span>
            {menuScript.archived ? "Unarchive" : "Archive"}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item menu-danger"
            onClick={() => {
              setConfirmDelete(menuScript);
              setMenu(null);
            }}
          >
            <span className="menu-icon">×</span>Delete
          </button>
        </Popover>
      )}

      {importOpen && (
        <Popover anchorRef={importRef} width={250} align="right" className="card-menu" onClose={() => setImportOpen(false)}>
          <button className="menu-item" onClick={importWord}>
            <span className="menu-icon">W</span>Word Document
            <span className="menu-hint">.docx</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setImportOpen(false);
              setGoogle({ link: "", error: "", busy: false });
            }}
          >
            <span className="menu-icon">G</span>Google Docs
          </button>
          <button className="menu-item" onClick={importFountain}>
            <span className="menu-icon">F</span>Fountain or Text
            <span className="menu-hint">.fountain .txt</span>
          </button>
        </Popover>
      )}

      {google && (
        <Modal
          title="Import from Google Docs"
          submitLabel={google.busy ? "Importing…" : "Import"}
          onSubmit={() => !google.busy && importGoogle()}
          onClose={() => setGoogle(null)}
        >
          <div className="field">
            <span className="label">Document link</span>
            <input
              data-autofocus
              value={google.link}
              placeholder="https://docs.google.com/document/d/…"
              onChange={(e) => setGoogle({ ...google, link: e.target.value, error: "" })}
            />
          </div>
          <p className="modal-note">
            The document's sharing needs to be set to “Anyone with the link”. For a private document, use File → Download → Microsoft Word in Google Docs and import that file instead.
          </p>
          {google.error && <p className="modal-error">{google.error}</p>}
        </Modal>
      )}

      {creating && (
        <ScriptDetails
          script={creating}
          creating
          onClose={() => setCreating(null)}
          onSave={(fields) => {
            const script = store.addScript({ ...creating, ...fields });
            if (fields.author) store.updateSettings({ lastAuthor: fields.author });
            setCreating(null);
            sfx.play("add");
            navigate({ page: "script", id: script.id });
          }}
        />
      )}

      {editing && (
        <ScriptDetails
          script={editing}
          onClose={() => setEditing(null)}
          onSave={(fields) => {
            store.updateScript(editing.id, fields);
            setEditing(null);
          }}
        />
      )}

      {confirmDelete && (
        <Confirm
          title="Delete Script"
          body={`“${confirmDelete.title}” and everything in it will be deleted. This can't be undone — export a Fountain copy first if you might want it back.`}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            store.deleteScript(confirmDelete.id);
            setConfirmDelete(null);
            sfx.play("remove");
          }}
        />
      )}
    </div>
  );
}
