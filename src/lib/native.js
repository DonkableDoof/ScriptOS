export const isNative = () =>
  typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);

export async function invoke(command, args) {
  const { invoke: call } = await import("@tauri-apps/api/core");
  return call(command, args);
}

let warned = false;
function warnOnce(message) {
  if (warned) return;
  warned = true;
  console.warn(message);
}

// Closing a Tauri window tears the webview down immediately, which abandons any
// save still in flight. Hold the close until the queue has drained, then let go.
// destroy() rather than close(), because close() would come back through here.
export async function holdCloseUntilSaved(drain) {
  if (!isNative()) return () => {};

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    let closing = false;

    return await win.onCloseRequested(async (event) => {
      // Asking twice always gets you out.
      if (closing) return;
      closing = true;
      event.preventDefault();

      try {
        await Promise.race([drain(), new Promise((done) => setTimeout(done, 3000))]);
      } catch (err) {
        warnOnce("[ScriptOS] Could not finish saving before closing: " + String(err));
      }

      try {
        await win.destroy();
      } catch (err) {
        warnOnce("[ScriptOS] destroy() unavailable, falling back to close(): " + String(err));
        try {
          await win.close();
        } catch (err2) {
          warnOnce("[ScriptOS] Could not close the window: " + String(err2));
          closing = false;
        }
      }
    });
  } catch (err) {
    warnOnce("[ScriptOS] Close guard unavailable: " + String(err));
    return () => {};
  }
}

export async function openExternal(url) {
  if (!url) return;
  if (!isNative()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await invoke("open_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// The window is created hidden so its saved position can be restored first. The
// frontend puts it up once it has something to draw.
export async function revealWindow() {
  if (!isNative()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.show();
    try {
      await win.setFocus();
    } catch {
      /* focus is a nicety */
    }
  } catch (err) {
    warnOnce("[ScriptOS] could not show the window: " + String(err));
  }
}

// Exports go through the native save dialog in the app, and a plain download in a
// browser. Returns false when the dialog was cancelled.
export async function saveTextFile(defaultName, contents, { label = "File", extensions = ["txt"] } = {}) {
  if (isNative()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: label, extensions }] });
    if (!path) return false;
    await invoke("write_text_file", { path, contents });
    return true;
  }
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// Reads a text file the user picks. Resolves null when nothing was chosen.
export function pickTextFile(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result || "") });
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsText(file);
    };
    input.click();
  });
}

// Like pickTextFile, but hands back the raw bytes as well, for Word documents.
export function pickFile(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.arrayBuffer().then((buffer) => resolve({ name: file.name, buffer }), () => reject(new Error("Could not read that file.")));
    };
    input.click();
  });
}

// Downloads a Google Doc as .docx through the app (see fetch_google_doc in main.rs).
export async function fetchGoogleDoc(id) {
  if (!isNative()) throw new Error("Google Docs import works in the ScriptOS app, not the browser preview.");
  const data = await invoke("fetch_google_doc", { id });
  return data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
}
