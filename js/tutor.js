/* Talks to the home server (server/server.py): sentence marking for the
 * "Use It" quiz and shared progress storage. When the app is opened as a
 * plain file there is no server, and everything else still works locally.
 * Exposes window.ClozeTutor. */
(function () {
  "use strict";

  let statusPromise = null;

  /* Resolves to { online, marking, model }. Never rejects. */
  function status() {
    if (!statusPromise) {
      statusPromise = location.protocol.startsWith("http")
        ? fetch("api/health", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then((d) => ({ online: true, marking: !!d.marking, model: d.model }))
            .catch(() => ({ online: false, marking: false, model: "" }))
        : Promise.resolve({ online: false, marking: false, model: "" });
    }
    return statusPromise;
  }

  async function loadState() {
    const r = await fetch("api/state", { cache: "no-store" });
    if (!r.ok) throw new Error("load failed");
    return r.json();
  }

  async function saveState(state) {
    const r = await fetch("api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!r.ok) throw new Error("save failed");
  }

  /* w: a word object from app.js. Resolves to the marking result, or throws Error with a friendly message. */
  async function grade(w, sentence, showedMeaning) {
    let r;
    try {
      r = await fetch("api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: w.word,
          meaning: w.meaning,
          category: window.CATEGORIES[w.cat] || w.cat,
          example: w.example.replace(/\[\[(.+?)\]\]/, "$1"),
          sentence,
          showed_meaning: showedMeaning,
        }),
      });
    } catch (e) {
      throw new Error("Could not reach the home server. Is it switched on?");
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Something went wrong while marking.");
    return data;
  }

  window.ClozeTutor = { status, grade, loadState, saveState };
})();
