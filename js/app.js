/* Cloze Word Coach: word list, pop quiz and level measurement for one learner.
 * Plain JavaScript, no build step. All learner data lives in localStorage. */
(function () {
  "use strict";

  const STORE_KEY = "clozeCoach.v1";
  const BOX_DAYS = [0, 1, 2, 4, 8, 16];   // Leitner review interval for boxes 0..5
  const MASTERED_BOX = 4;
  const TEST_LENGTH = 20;
  const DAY = 86400000;
  const DEFAULT_SOURCES = [
    "PSLE 2021", "PSLE 2022", "PSLE 2023", "PSLE 2024", "PSLE 2025",
    "Prelim 2024", "Prelim 2025",
  ];
  const BANDS = [
    [85, "Exam-ready", "Handles even the trickiest connectors, idioms and fixed expressions."],
    [70, "Strong", "Secure on most items; polish the challenging (level 3) words."],
    [50, "Competent", "Good grasp of common items; widen your range of expressions."],
    [30, "Developing", "Knows the basics; keep building up everyday connectors and phrases."],
    [0, "Foundation", "Start with level 1 words and short daily pop quizzes."],
  ];

  // ---------- state ----------
  function blankState() {
    return { progress: {}, sources: {}, custom: [], tests: [], quizzes: [], sentences: [] };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      return Object.assign(blankState(), s || {});
    } catch (e) {
      return blankState();
    }
  }
  let state = load();
  // home server connection, filled in at startup (see bottom of file)
  let server = { online: false, marking: false, model: "" };
  let pushTimer = null;
  let syncFailed = false;

  function save() {
    state.savedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
    if (server.online) {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushState, 400);
    }
  }
  function pushState() {
    window.ClozeTutor.saveState(state)
      .then(() => { syncFailed = false; })
      .catch(() => { syncFailed = true; });
  }
  function hasData(s) {
    return !!s && (Object.keys(s.progress || {}).length > 0 || (s.tests || []).length > 0 || (s.custom || []).length > 0);
  }
  /* Take the server's copy if it is newer than ours. Returns true if state changed. */
  async function pullState() {
    try {
      const remote = await window.ClozeTutor.loadState();
      if (hasData(remote) && (remote.savedAt || 0) > (state.savedAt || 0)) {
        state = Object.assign(blankState(), remote);
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
        buildWords();
        return true;
      }
      if (hasData(state) && !hasData(remote)) pushState();   // first run: move this browser's progress to the server
    } catch (e) { syncFailed = true; }
    return false;
  }

  // ---------- words ----------
  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function makeWord(row, id, custom) {
    const [word, cat, level, meaning, example, alts] = row;
    const m = example.match(/\[\[(.+?)\]\]/);
    return {
      id, word, cat, level: Number(level), meaning, example,
      answer: m ? m[1] : word,
      alts: alts || [],
      custom: !!custom,
    };
  }
  let WORDS = [];
  function buildWords() {
    const seen = {};
    WORDS = window.WORD_ROWS.map((r) => {
      let id = slug(r[0]);
      while (seen[id]) id += "-x";
      seen[id] = true;
      return makeWord(r, id, false);
    });
    state.custom.forEach((c) => WORDS.push(makeWord(c.row, c.id, true)));
  }
  buildWords();
  const byId = (id) => WORDS.find((w) => w.id === id);

  // ---------- helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function norm(s) {
    return String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[.,!?;:"]/g, "").replace(/\s+/g, " ").trim();
  }
  function isCorrect(w, given) {
    const g = norm(given);
    return g !== "" && [w.answer].concat(w.alts).some((a) => norm(a) === g);
  }
  function sentenceParts(w) {
    const i = w.example.indexOf("[["), j = w.example.indexOf("]]");
    return [w.example.slice(0, i), w.example.slice(j + 2)];
  }
  function filledSentence(w) {
    return w.example.replace(/\[\[(.+?)\]\]/, "$1");
  }
  function fmtDate(t) {
    return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  // ---------- progress (Leitner boxes) ----------
  function prog(id) {
    return state.progress[id] || { box: 0, seen: 0, correct: 0, last: 0 };
  }
  function record(w, ok, hinted) {
    const p = Object.assign({}, prog(w.id));
    p.seen += 1;
    if (ok) {
      p.correct += 1;
      if (!hinted) p.box = Math.min(5, p.box + 1);
    } else {
      p.box = Math.max(0, p.box - 2);
    }
    p.last = Date.now();
    state.progress[w.id] = p;
  }
  function status(id) {
    const p = state.progress[id];
    if (!p || !p.seen) return "new";
    if (p.box >= MASTERED_BOX) return "mastered";
    if (p.box === 0) return "weak";
    return "learning";
  }
  function isDue(id) {
    const p = state.progress[id];
    return !!p && p.seen > 0 && Date.now() - p.last >= BOX_DAYS[p.box] * DAY;
  }
  function masteryIndex(list) {
    list = list || WORDS;
    if (!list.length) return 0;
    const sum = list.reduce((s, w) => s + prog(w.id).box / 5, 0);
    return Math.round((sum / list.length) * 100);
  }
  function bandFor(score) {
    return BANDS.find((b) => score >= b[0]);
  }

  // ---------- router ----------
  const views = { dashboard: renderDashboard, words: renderWords, quiz: renderQuizSetup, write: renderWriteSetup, test: renderTestIntro, settings: renderSettings };
  function route() {
    const tab = (location.hash || "#dashboard").slice(1);
    const fn = views[tab] || renderDashboard;
    $$("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    fn($("#view"));
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  // tapping the tab you are already on (e.g. mid-quiz) goes back to that tab's start screen
  $$("#tabs a").forEach((a) => a.addEventListener("click", () => { if (a.getAttribute("href") === location.hash) route(); }));

  // ---------- dashboard ----------
  function renderDashboard(el) {
    const counts = { new: 0, weak: 0, learning: 0, mastered: 0 };
    WORDS.forEach((w) => counts[status(w.id)]++);
    const due = WORDS.filter((w) => isDue(w.id)).length;
    const lastTest = state.tests[state.tests.length - 1];
    const mi = masteryIndex();
    const band = lastTest ? bandFor(lastTest.score) : null;

    const catRows = Object.keys(window.CATEGORIES).map((c) => {
      const list = WORDS.filter((w) => w.cat === c);
      let seen = 0, correct = 0;
      list.forEach((w) => { const p = prog(w.id); seen += p.seen; correct += p.correct; });
      const acc = seen ? Math.round((correct / seen) * 100) : null;
      return { name: window.CATEGORIES[c], mastery: masteryIndex(list), acc, n: list.length };
    });

    const totalSeen = WORDS.reduce((s, w) => s + prog(w.id).seen, 0);
    const tried = catRows.filter((r) => r.acc !== null);
    const weakest = tried.length >= 3 ? tried.slice().sort((a, b) => a.acc - b.acc || a.mastery - b.mastery)[0] : null;

    el.innerHTML = `
      <h1>My Level</h1>
      <p class="lead">${WORDS.length} words in your list. Take the Level Test to measure where you stand, then use Pop Quizzes to improve.</p>

      <div class="grid">
        <div class="card stat">
          <div class="label">Current level (latest Level Test)</div>
          ${lastTest
            ? `<div class="num">${lastTest.score}<span style="font-size:1rem;color:var(--muted)">/100</span></div>
               <div class="band">${esc(band[1])}</div>
               <div class="label">${esc(band[2])}${weakest ? `<br>Focus next on: <strong>${esc(weakest.name)}</strong> (${weakest.acc}% accuracy)` : ""}<br>Tested ${fmtDate(lastTest.date)}</div>`
            : `<div class="num">&ndash;</div><div class="label">No test yet.</div>
               <p><a class="btn primary" href="#test">Take the Level Test</a></p>`}
        </div>
        <div class="card stat">
          <div class="label">Word-list mastery</div>
          <div class="num">${mi}%</div>
          <div class="label">${counts.mastered} mastered &middot; ${counts.learning} learning &middot; ${counts.weak} weak &middot; ${counts.new} not tried</div>
        </div>
        <div class="card stat">
          <div class="label">Due for review today</div>
          <div class="num">${due}</div>
          <div class="label">${totalSeen} answers so far</div>
          <p><a class="btn primary" href="#quiz">Start a Pop Quiz</a></p>
        </div>
      </div>

      <div class="card">
        <h2>Word status</h2>
        ${stackBar(counts)}
      </div>

      <div class="card">
        <h2>By category</h2>
        <div class="legend"><span><i style="background:var(--accent)"></i>Mastery</span><span>Accuracy shown on the right</span></div>
        ${catRows.map((r) => `
          <div class="bar-row">
            <div>${esc(r.name)} <span style="color:var(--muted)">(${r.n})</span></div>
            <div class="bar"><div style="width:${r.mastery}%"></div></div>
            <div class="pct">${r.acc === null ? "&ndash;" : r.acc + "%"}</div>
          </div>`).join("")}
      </div>

      ${sentenceCard()}

      <div class="card">
        <h2>Level Test history</h2>
        ${state.tests.length ? lineChart(state.tests) + historyTable() : `<p class="lead">Your scores will appear here after your first Level Test.</p>`}
      </div>
    `;
  }

  function stackBar(c) {
    const total = WORDS.length || 1;
    const seg = (n, color) => n ? `<div style="width:${(n / total) * 100}%;background:${color}" title="${n}"></div>` : "";
    return `
      <div class="legend">
        <span><i style="background:var(--good)"></i>Mastered ${c.mastered}</span>
        <span><i style="background:var(--warn)"></i>Learning ${c.learning}</span>
        <span><i style="background:var(--bad)"></i>Weak ${c.weak}</span>
        <span><i style="background:var(--line)"></i>Not tried ${c.new}</span>
      </div>
      <div class="stack">${seg(c.mastered, "var(--good)")}${seg(c.learning, "var(--warn)")}${seg(c.weak, "var(--bad)")}</div>`;
  }

  function lineChart(tests) {
    const W = 600, H = 180, L = 32, R = 12, T = 12, B = 24;
    const n = tests.length;
    const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
    const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
    const grid = [0, 25, 50, 75, 100].map((v) =>
      `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>
       <text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");
    const pts = tests.map((t, i) => `${x(i)},${y(t.score)}`).join(" ");
    const dots = tests.map((t, i) =>
      `<circle cx="${x(i)}" cy="${y(t.score)}" r="4" fill="var(--accent)"><title>${fmtDate(t.date)}: ${t.score}</title></circle>`).join("");
    const first = `<text x="${x(0)}" y="${H - 6}" text-anchor="middle">${fmtDate(tests[0].date)}</text>`;
    const last = n > 1 ? `<text x="${x(n - 1)}" y="${H - 6}" text-anchor="end">${fmtDate(tests[n - 1].date)}</text>` : "";
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Level test scores over time">
      ${grid}<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}${first}${last}</svg></div>`;
  }

  function historyTable() {
    const rows = state.tests.slice(-8).reverse().map((t) =>
      `<tr><td>${fmtDate(t.date)}</td><td>${t.score}</td><td>${esc(bandFor(t.score)[1])}</td><td>${t.correct}/${t.total}</td></tr>`).join("");
    return `<table class="hist"><tr><th>Date</th><th>Score</th><th>Level</th><th>Correct</th></tr>${rows}</table>`;
  }

  // ---------- word list ----------
  const wlFilter = { q: "", cat: "", level: "", status: "" };

  function renderWords(el) {
    const catOpts = Object.entries(window.CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    el.innerHTML = `
      <h1>Word List</h1>
      <p class="lead">Every word with its meaning and an example sentence. The highlighted word is what goes in the blank. Tag words with the paper you saw them in.</p>
      <div class="filters">
        <input type="text" id="f-q" placeholder="Search word, meaning, example or source tag" value="${esc(wlFilter.q)}">
        <select id="f-cat"><option value="">All categories</option>${catOpts}</select>
        <select id="f-level"><option value="">All levels</option><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option></select>
        <select id="f-status"><option value="">Any status</option><option value="new">Not tried</option><option value="weak">Weak</option><option value="learning">Learning</option><option value="mastered">Mastered</option></select>
      </div>
      <details class="card" id="add-box">
        <summary><strong>Add a word from a paper</strong></summary>
        <div style="display:grid;gap:8px;margin-top:10px">
          <div class="row">
            <label class="field" style="flex:2">Word or phrase<input type="text" id="a-word" placeholder="e.g. in the wake of"></label>
            <label class="field" style="flex:1">Category<select id="a-cat">${catOpts}</select></label>
            <label class="field">Level<select id="a-level"><option>1</option><option selected>2</option><option>3</option></select></label>
          </div>
          <label class="field">Meaning<input type="text" id="a-meaning"></label>
          <label class="field">Example sentence &mdash; put the blank in double square brackets, e.g. <code>The town was rebuilt in the [[wake]] of the flood.</code><input type="text" id="a-example"></label>
          <div class="row">
            <label class="field" style="flex:1">Other accepted answers (comma separated, optional)<input type="text" id="a-alts"></label>
            <label class="field" style="flex:1">Source (optional)<input type="text" id="a-src" list="src-list" placeholder="e.g. PSLE 2023"></label>
          </div>
          <div class="row"><button class="btn primary" id="a-save">Add word</button><span id="a-msg" class="hint"></span></div>
        </div>
      </details>
      <datalist id="src-list">${allSourceTags().map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      <div class="count" id="wl-count"></div>
      <div id="wl"></div>`;

    $("#f-cat").value = wlFilter.cat;
    $("#f-level").value = wlFilter.level;
    $("#f-status").value = wlFilter.status;
    $("#f-q").addEventListener("input", (e) => { wlFilter.q = e.target.value; drawList(); });
    ["cat", "level", "status"].forEach((k) =>
      $("#f-" + k).addEventListener("change", (e) => { wlFilter[k] = e.target.value; drawList(); }));
    $("#a-save").addEventListener("click", addCustomWord);
    drawList();
  }

  function allSourceTags() {
    const set = new Set(DEFAULT_SOURCES);
    Object.values(state.sources).forEach((arr) => arr.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }

  function drawList() {
    const q = norm(wlFilter.q);
    const list = WORDS.filter((w) => {
      if (wlFilter.cat && w.cat !== wlFilter.cat) return false;
      if (wlFilter.level && String(w.level) !== wlFilter.level) return false;
      if (wlFilter.status && status(w.id) !== wlFilter.status) return false;
      if (q) {
        const hay = norm([w.word, w.meaning, filledSentence(w), (state.sources[w.id] || []).join(" ")].join(" "));
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    $("#wl-count").textContent = `Showing ${list.length} of ${WORDS.length} words`;
    $("#wl").innerHTML = list.map(wordCard).join("");
    bindCards($("#wl"));
  }

  const STATUS_LABEL = { new: "Not tried", weak: "Weak", learning: "Learning", mastered: "Mastered" };

  function wordCard(w) {
    const st = status(w.id);
    const [pre, post] = sentenceParts(w);
    const srcs = state.sources[w.id] || [];
    return `
      <div class="card word" data-id="${esc(w.id)}">
        <div class="head">
          <span class="hw">${esc(w.word)}</span>
          <span class="chip">${esc(window.CATEGORIES[w.cat] || w.cat)}</span>
          <span class="dots" title="Level ${w.level}">${"●".repeat(w.level)}${"○".repeat(3 - w.level)}</span>
          <span class="badge ${st}">${STATUS_LABEL[st]}</span>
          <span style="flex:1"></span>
          <button class="btn small" data-act="speak" title="Read aloud">🔊</button>
          ${w.custom ? `<button class="btn small danger" data-act="del">Delete</button>` : ""}
        </div>
        <div class="meaning">${esc(w.meaning)}</div>
        <p class="ex">${esc(pre)}<b>${esc(w.answer)}</b>${esc(post)}</p>
        ${w.alts.length ? `<div class="alts">Also accepted in the blank: ${w.alts.map(esc).join(", ")}</div>` : ""}
        <div class="srcs">
          ${srcs.map((s, i) => `<span class="chip src">${esc(s)}<button data-act="unsrc" data-i="${i}" title="Remove">×</button></span>`).join("")}
          <input type="text" list="src-list" placeholder="+ source (Enter)" data-act="src">
        </div>
      </div>`;
  }

  function bindCards(root) {
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const card = btn.closest(".word");
      const w = byId(card.dataset.id);
      const act = btn.dataset.act;
      if (act === "speak") speak(filledSentence(w));
      if (act === "unsrc") {
        state.sources[w.id].splice(Number(btn.dataset.i), 1);
        if (!state.sources[w.id].length) delete state.sources[w.id];
        save(); card.outerHTML = wordCard(w);
      }
      if (act === "del" && confirm(`Delete "${w.word}" and its progress?`)) {
        state.custom = state.custom.filter((c) => c.id !== w.id);
        delete state.progress[w.id];
        delete state.sources[w.id];
        save(); buildWords(); drawList();
      }
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.target.dataset.act !== "src") return;
      const val = e.target.value.trim();
      if (!val) return;
      const card = e.target.closest(".word");
      const id = card.dataset.id;
      state.sources[id] = state.sources[id] || [];
      if (!state.sources[id].includes(val)) state.sources[id].push(val);
      save();
      card.outerHTML = wordCard(byId(id));
      const fresh = $(`.word[data-id="${CSS.escape(id)}"] input[data-act=src]`, root);
      if (fresh) fresh.focus();
    });
  }

  function addCustomWord() {
    const word = $("#a-word").value.trim();
    const meaning = $("#a-meaning").value.trim();
    const example = $("#a-example").value.trim();
    const msg = $("#a-msg");
    const blanks = (example.match(/\[\[.+?\]\]/g) || []).length;
    if (!word || !meaning || !example) { msg.textContent = "Please fill in word, meaning and example."; return; }
    if (blanks !== 1) { msg.textContent = "The example needs exactly one blank written like [[word]]."; return; }
    const alts = $("#a-alts").value.split(",").map((s) => s.trim()).filter(Boolean);
    const row = [word, $("#a-cat").value, Number($("#a-level").value), meaning, example, alts];
    let id = "u-" + slug(word);
    while (byId(id)) id += "-x";
    state.custom.push({ id, row });
    const src = $("#a-src").value.trim();
    if (src) state.sources[id] = [src];
    save(); buildWords();
    ["word", "meaning", "example", "alts", "src"].forEach((k) => { $("#a-" + k).value = ""; });
    msg.textContent = `Added "${word}".`;
    drawList();
  }

  // ---------- quiz engine (shared by Pop Quiz and Level Test) ----------
  function distractors(w, n) {
    const taken = new Set([w.answer].concat(w.alts).map(norm));
    const pool = shuffle(WORDS.filter((o) => o.cat === w.cat && o.id !== w.id).concat(shuffle(WORDS).slice(0, 30)));
    const out = [];
    for (const o of pool) {
      const a = o.answer;
      // match capitalisation to the blank so the first letter gives nothing away
      const shaped = /^[A-Z]/.test(w.answer) ? a.charAt(0).toUpperCase() + a.slice(1) : a.charAt(0).toLowerCase() + a.slice(1);
      if (taken.has(norm(shaped))) continue;
      taken.add(norm(shaped));
      out.push(shaped);
      if (out.length === n) break;
    }
    return out;
  }

  /* Runs one question. opts: { mode: "type"|"mcq", allowHint, header, onDone(ok, hinted) } */
  function askQuestion(el, w, opts) {
    const [pre, post] = sentenceParts(w);
    let hinted = false, answered = false;
    const choices = opts.mode === "mcq" ? shuffle([w.answer].concat(distractors(w, 3))) : null;

    el.innerHTML = `
      ${opts.header}
      <div class="card">
        <div class="hint">${opts.mode === "mcq" ? "Choose the word that best fits the blank." : "Type ONE suitable word in the blank."}</div>
        <div class="q-sentence">${esc(pre)}${opts.mode === "mcq" ? `<span class="blank">&nbsp;</span>` : `<input type="text" id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your answer">`}${esc(post)}</div>
        ${choices ? `<div class="choices">${choices.map((c) => `<button class="btn" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
        <div class="row" style="margin-top:12px">
          ${choices ? "" : `<button class="btn primary" id="check">Check</button>`}
          ${opts.allowHint ? `<button class="btn" id="hintbtn">Hint</button>` : ""}
          <span id="hinttext" class="hint"></span>
        </div>
        <div id="fb"></div>
      </div>`;

    const input = $("#ans", el);
    if (input) {
      input.focus();
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        // stop the same keypress from also activating the Next button that takes focus
        e.preventDefault();
        if (!answered) check(input.value);
      });
      $("#check", el).addEventListener("click", () => (answered ? next() : check(input.value)));
    }
    if (choices) $$(".choices .btn", el).forEach((b) => b.addEventListener("click", () => { if (!answered) check(b.dataset.c, b); }));
    if (opts.allowHint) $("#hintbtn", el).addEventListener("click", () => {
      hinted = true;
      $("#hinttext", el).textContent = `Meaning: ${w.meaning} (starts with "${w.answer.charAt(0)}")`;
    });

    let result = false;
    function check(given, btn) {
      answered = true;
      result = isCorrect(w, given);
      if (input) input.disabled = true;
      if (choices) {
        $$(".choices .btn", el).forEach((b) => {
          b.disabled = true;
          if (isCorrect(w, b.dataset.c)) b.classList.add("right");
        });
        if (btn && !result) btn.classList.add("wrong");
      }
      const others = w.alts.length ? `<div class="alts">Also accepted: ${w.alts.map(esc).join(", ")}</div>` : "";
      $("#fb", el).innerHTML = `
        <div class="feedback ${result ? "right" : "wrong"}">
          <div class="verdict">${result ? "Correct!" : `Not quite${String(given).trim() ? ` &mdash; you wrote "${esc(given)}"` : ""}.`}</div>
          <div>${esc(pre)}<b>${esc(w.answer)}</b>${esc(post)}</div>
          ${others}
          <div class="hint">${esc(w.word)}: ${esc(w.meaning)}</div>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn primary" id="next">Next &rarr;</button></div>`;
      if ($("#check", el)) $("#check", el).remove();
      if ($("#hintbtn", el)) $("#hintbtn", el).remove();
      $("#next", el).addEventListener("click", next);
      $("#next", el).focus();
    }
    function next() { opts.onDone(result, hinted); }
  }

  function progressBar(i, n) {
    return `<div class="row" style="justify-content:space-between"><strong>Question ${i + 1} of ${n}</strong></div>
            <div class="q-progress"><div style="width:${(i / n) * 100}%"></div></div>`;
  }

  // ---------- pop quiz ----------
  const quizPrefs = { n: 10, pool: "smart", mode: "type" };

  function renderQuizSetup(el) {
    const due = WORDS.filter((w) => isDue(w.id)).length;
    const weak = WORDS.filter((w) => status(w.id) === "weak").length;
    const catOpts = Object.entries(window.CATEGORIES).map(([k, v]) => `<option value="cat:${k}">Category: ${esc(v)}</option>`).join("");
    el.innerHTML = `
      <h1>Pop Quiz</h1>
      <p class="lead">Short practice rounds. Each answer moves the word up or down your review boxes, so weak words come back sooner.</p>
      <div class="card">
        <div class="row" style="gap:16px;align-items:flex-end">
          <label class="field">Questions
            <select id="qn"><option>5</option><option>10</option><option>15</option><option>20</option></select></label>
          <label class="field">Words
            <select id="qpool">
              <option value="smart">Smart mix (due + weak + new)</option>
              <option value="due">Due for review (${due})</option>
              <option value="weak">Weak words (${weak})</option>
              <option value="new">Not tried yet</option>
              <option value="all">Any word</option>
              <option value="lvl:1">Level 1</option><option value="lvl:2">Level 2</option><option value="lvl:3">Level 3</option>
              ${catOpts}
            </select></label>
          <label class="field">Style
            <select id="qmode"><option value="type">Type the word (like the real paper)</option><option value="mcq">Multiple choice (easier)</option></select></label>
          <button class="btn primary" id="qstart">Start</button>
        </div>
        <p id="qmsg" class="hint"></p>
      </div>
      ${state.quizzes.length ? `<div class="card"><h2>Recent quizzes</h2><table class="hist"><tr><th>Date</th><th>Score</th><th>Style</th></tr>
        ${state.quizzes.slice(-6).reverse().map((q) => `<tr><td>${fmtDate(q.date)}</td><td>${q.correct}/${q.total}</td><td>${q.mode === "mcq" ? "Multiple choice" : "Typed"}</td></tr>`).join("")}</table></div>` : ""}`;
    $("#qn").value = String(quizPrefs.n);
    $("#qpool").value = quizPrefs.pool;
    $("#qmode").value = quizPrefs.mode;
    $("#qstart").addEventListener("click", () => {
      quizPrefs.n = Number($("#qn").value);
      quizPrefs.pool = $("#qpool").value;
      quizPrefs.mode = $("#qmode").value;
      const words = pickQuizWords(quizPrefs.pool, quizPrefs.n);
      if (!words.length) { $("#qmsg").textContent = "No words match that choice yet. Try another option."; return; }
      runQuiz(el, words, quizPrefs.mode);
    });
  }

  function pickQuizWords(pool, n) {
    if (pool === "smart") {
      // priority: due-and-weak, other due, unseen, then everything else least recently seen
      const tier = (w) => (isDue(w.id) && status(w.id) === "weak" ? 0 : isDue(w.id) ? 1 : status(w.id) === "new" ? 2 : 3);
      return shuffle(WORDS)
        .sort((a, b) => tier(a) - tier(b) || (tier(a) === 3 ? prog(a.id).last - prog(b.id).last : 0))
        .slice(0, n);
    }
    let list = WORDS;
    if (pool === "due") list = WORDS.filter((w) => isDue(w.id));
    else if (pool === "weak") list = WORDS.filter((w) => status(w.id) === "weak");
    else if (pool === "new") list = WORDS.filter((w) => status(w.id) === "new");
    else if (pool.startsWith("lvl:")) list = WORDS.filter((w) => String(w.level) === pool.slice(4));
    else if (pool.startsWith("cat:")) list = WORDS.filter((w) => w.cat === pool.slice(4));
    return shuffle(list).slice(0, n);
  }

  function runQuiz(el, words, mode) {
    const results = [];
    const step = (i) => {
      if (i === words.length) return quizSummary(el, results, mode);
      askQuestion(el, words[i], {
        mode, allowHint: true,
        header: `<h1>Pop Quiz</h1>${progressBar(i, words.length)}`,
        onDone: (ok, hinted) => {
          record(words[i], ok, hinted);
          results.push({ w: words[i], ok, hinted });
          save();
          step(i + 1);
        },
      });
    };
    step(0);
  }

  function quizSummary(el, results, mode) {
    const correct = results.filter((r) => r.ok).length;
    state.quizzes.push({ date: Date.now(), correct, total: results.length, mode });
    save();
    const pct = Math.round((correct / results.length) * 100);
    el.innerHTML = `
      <h1>Pop Quiz done</h1>
      <div class="card stat">
        <div class="num">${correct} / ${results.length}</div>
        <div class="label">${pct >= 80 ? "Excellent work!" : pct >= 50 ? "Good effort. Review the ones you missed below." : "Keep going. The words you missed will come back soon for review."}</div>
      </div>
      <div class="card">
        <h2>Review</h2>
        ${results.map((r) => {
          const [pre, post] = sentenceParts(r.w);
          return `<p style="margin:6px 0">${r.ok ? "✅" : "❌"} ${esc(pre)}<b>${esc(r.w.answer)}</b>${esc(post)}
            <span class="hint">&mdash; ${esc(r.w.meaning)}${r.hinted ? " (hint used)" : ""}</span></p>`;
        }).join("")}
      </div>
      <div class="row"><button class="btn primary" id="again">Another quiz</button><a class="btn" href="#dashboard">See my level</a></div>`;
    $("#again").addEventListener("click", () => renderQuizSetup(el));
  }

  // ---------- level test (adaptive) ----------
  /* Ability estimate theta runs on the same 1..3 scale as word levels.
   * Start in the middle; right answers push it up, wrong answers down,
   * with the step shrinking as the test homes in. Score = theta mapped to 0..100. */
  function renderTestIntro(el) {
    el.innerHTML = `
      <h1>Level Test</h1>
      <p class="lead">${TEST_LENGTH} typed questions that adapt to you: get one right and the next is harder, get one wrong and it eases off. No hints. Takes about 10 minutes.</p>
      <div class="card">
        <p>Your score (0&ndash;100) places you in a level:</p>
        <table class="hist">${BANDS.map((b) => `<tr><td><strong>${esc(b[1])}</strong></td><td>${b[0]}+</td><td>${esc(b[2])}</td></tr>`).join("")}</table>
        <p class="hint">This measures how well you know this word list. It is a practice guide, not an official PSLE grade.</p>
        <button class="btn primary" id="tstart">Start Level Test</button>
      </div>`;
    $("#tstart").addEventListener("click", () => runTest(el));
  }

  function runTest(el) {
    let theta = 2, stepSize = 0.6, correct = 0;
    const used = new Set();
    const total = Math.min(TEST_LENGTH, WORDS.length);
    const pick = () => {
      const target = Math.max(1, Math.min(3, Math.round(theta)));
      let pool = WORDS.filter((w) => !used.has(w.id) && w.level === target);
      if (!pool.length) pool = WORDS.filter((w) => !used.has(w.id));
      // prefer words not yet mastered so the test is informative
      const fresh = pool.filter((w) => status(w.id) !== "mastered");
      const list = fresh.length >= 3 ? fresh : pool;
      return list[Math.floor(Math.random() * list.length)];
    };
    const step = (i) => {
      if (i === total) return testSummary(el, theta, correct, total);
      const w = pick();
      used.add(w.id);
      askQuestion(el, w, {
        mode: "type", allowHint: false,
        header: `<h1>Level Test</h1>${progressBar(i, total)}`,
        onDone: (ok) => {
          if (ok) correct++;
          // a right answer on a hard word is worth more than on an easy one
          const diff = w.level - theta;
          theta += ok ? stepSize * (1 + Math.max(0, diff) * 0.5) : -stepSize * (1 + Math.max(0, -diff) * 0.5);
          theta = Math.max(0.5, Math.min(3.5, theta));
          stepSize = Math.max(0.15, stepSize * 0.85);
          record(w, ok, false);
          save();
          step(i + 1);
        },
      });
    };
    step(0);
  }

  function testSummary(el, theta, correct, total) {
    const score = Math.round(((theta - 0.5) / 3) * 100);
    const band = bandFor(score);
    const prev = state.tests[state.tests.length - 1];
    state.tests.push({ date: Date.now(), score, correct, total });
    save();
    const delta = prev ? score - prev.score : null;
    el.innerHTML = `
      <h1>Your level</h1>
      <div class="card stat">
        <div class="num">${score}<span style="font-size:1rem;color:var(--muted)">/100</span></div>
        <div class="band">${esc(band[1])}</div>
        <div class="label">${esc(band[2])}</div>
        <p>${correct} of ${total} correct.${delta !== null ? ` ${delta >= 0 ? "Up" : "Down"} ${Math.abs(delta)} from last time.` : ""}</p>
      </div>
      <div class="row"><a class="btn primary" href="#quiz">Practise with a Pop Quiz</a><a class="btn" href="#dashboard">See my dashboard</a></div>`;
  }

  // ---------- use it (write a sentence, marked by Claude) ----------
  const STARS = (n) => "★".repeat(n) + "☆".repeat(4 - n);
  const SCORE_WORDS = ["Not yet", "Needs work", "Nearly", "Good", "Excellent"];
  const writePrefs = { n: 5, showMeaning: true, cat: "" };

  function sentenceCard() {
    const recent = state.sentences.slice(-20);
    if (!recent.length) return "";
    const avg = recent.reduce((s, r) => s + r.score, 0) / recent.length;
    return `<div class="card stat">
      <h2>Sentence writing</h2>
      <div class="num">${avg.toFixed(1)}<span style="font-size:1rem;color:var(--muted)">/4</span></div>
      <div class="label">Average of the last ${recent.length} sentences (${state.sentences.length} written in total).
        <a href="#write">See them</a></div>
    </div>`;
  }

  function startLevel() {
    const t = state.tests[state.tests.length - 1];
    return t ? Math.max(1, Math.min(3, 0.5 + (t.score / 100) * 3)) : 1.5;
  }

  function renderWriteSetup(el) {
    const hasKey = server.marking;
    const catOpts = Object.entries(window.CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    const log = state.sentences.slice(-30).reverse();
    el.innerHTML = `
      <h1>Use It</h1>
      <p class="lead">See a word, write your own sentence with it, and get it marked out of 4. A strong sentence brings a harder word next;
        a weak one brings an easier word, and the missed word comes back later in the round.</p>
      ${hasKey ? "" : `<div class="notice" style="margin-bottom:14px">${server.online
        ? "The home server is running but has no API key yet. Add it to server/config.env and restart the server."
        : "Sentence marking needs the home server. Open the app from the server's address (for example http://raspberrypi.local:8000) instead of as a file. See the README."}</div>`}
      <div class="card">
        <div class="row" style="gap:16px;align-items:flex-end">
          <label class="field">Words
            <select id="wn"><option>5</option><option>8</option><option>10</option><option>15</option></select></label>
          <label class="field">Category
            <select id="wcat"><option value="">All categories</option>${catOpts}</select></label>
          <label class="field">Show the meaning
            <select id="wmean"><option value="1">Yes (easier)</option><option value="0">No (harder)</option></select></label>
          <button class="btn primary" id="wstart" ${hasKey ? "" : "disabled"}>Start</button>
        </div>
        <p class="hint">Starts at ${startLevel() >= 2.5 ? "level 3" : startLevel() >= 1.5 ? "level 2" : "level 1"} words, based on the latest Level Test.</p>
      </div>
      ${log.length ? `<div class="card"><h2>Recent sentences</h2><table class="hist">
        <tr><th>Date</th><th>Word</th><th>Sentence</th><th>Score</th></tr>
        ${log.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.word)}</td>
          <td>${esc(r.sentence)}${r.corrected && r.corrected !== r.sentence ? `<div class="hint">Better: ${esc(r.corrected)}</div>` : ""}</td>
          <td title="${esc(r.feedback)}">${r.score}/4</td></tr>`).join("")}
      </table></div>` : ""}`;
    $("#wn").value = String(writePrefs.n);
    $("#wcat").value = writePrefs.cat;
    $("#wmean").value = writePrefs.showMeaning ? "1" : "0";
    $("#wstart").addEventListener("click", () => {
      writePrefs.n = Number($("#wn").value);
      writePrefs.cat = $("#wcat").value;
      writePrefs.showMeaning = $("#wmean").value === "1";
      runWrite(el);
    });
  }

  function runWrite(el) {
    const pool = WORDS.filter((w) => !writePrefs.cat || w.cat === writePrefs.cat);
    if (!pool.length) return;
    let level = startLevel();
    const used = new Set();
    const retry = [];            // [{w, dueAt}] words to try again later in the round
    const results = [];
    const total = writePrefs.n;

    const pickNext = (i) => {
      const r = retry.findIndex((x) => x.dueAt <= i);
      if (r >= 0) return retry.splice(r, 1)[0].w;
      const target = Math.max(1, Math.min(3, Math.round(level)));
      let list = pool.filter((w) => !used.has(w.id) && w.level === target);
      if (!list.length) list = pool.filter((w) => !used.has(w.id));
      if (!list.length) list = pool;
      // weaker and untried words first
      const weakFirst = list.filter((w) => status(w.id) !== "mastered");
      list = weakFirst.length ? weakFirst : list;
      return list[Math.floor(Math.random() * list.length)];
    };

    const step = (i, w) => {
      if (i === total) return writeSummary(el, results);
      used.add(w.id);
      const isRetry = results.some((r) => r.w.id === w.id);
      el.innerHTML = `
        <h1>Use It</h1>${progressBar(i, total)}
        <div class="card">
          <div class="hint">${isRetry ? "Let's try this one again." : "Write ONE sentence of your own using:"}</div>
          <div class="row" style="margin:6px 0 4px">
            <span class="q-sentence" style="margin:0"><b>${esc(w.word)}</b></span>
            <span class="chip">${esc(window.CATEGORIES[w.cat])}</span>
            <span class="dots" title="Level ${w.level}">${"●".repeat(w.level)}${"○".repeat(3 - w.level)}</span>
            <button class="btn small" id="say" title="Say the word">🔊</button>
          </div>
          ${writePrefs.showMeaning ? `<div class="meaning hint">Meaning: ${esc(w.meaning)}</div>` : ""}
          <textarea id="sent" rows="3" placeholder="Type your sentence here" style="margin-top:10px" spellcheck="false"></textarea>
          <div class="row" style="margin-top:10px">
            <button class="btn primary" id="mark">Mark my sentence</button>
            <button class="btn" id="skip">I'm not sure, show me</button>
            <span id="wmsg" class="hint"></span>
          </div>
          <div id="wfb"></div>
        </div>`;
      const ta = $("#sent", el);
      ta.focus();
      $("#say", el).addEventListener("click", () => speak(w.word.replace(/\.\.\./g, "")));
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#mark", el).click(); }
      });
      $("#skip", el).addEventListener("click", () => finish({ score: 0, skipped: true, feedback: "Here is how it is used. You'll see this word again soon.",
        corrected_sentence: "", model_sentence: filledSentence(w) }, ""));
      $("#mark", el).addEventListener("click", async () => {
        const sentence = ta.value.trim();
        if (sentence.split(/\s+/).length < 3) { $("#wmsg", el).textContent = "Please write a full sentence."; return; }
        $("#mark", el).disabled = true; $("#skip", el).disabled = true; ta.disabled = true;
        $("#wmsg", el).textContent = "Marking...";
        try {
          finish(await window.ClozeTutor.grade(w, sentence, writePrefs.showMeaning), sentence);
        } catch (err) {
          $("#wmsg", el).textContent = err.message;
          $("#mark", el).disabled = false; $("#skip", el).disabled = false; ta.disabled = false;
        }
      });

      function finish(r, sentence) {
        const ok = r.score >= 3;
        record(w, ok, false);
        if (!r.skipped) {
          state.sentences.push({ date: Date.now(), id: w.id, word: w.word, sentence, score: r.score,
            feedback: r.feedback, corrected: r.corrected_sentence });
          if (state.sentences.length > 500) state.sentences.shift();
        }
        save();
        results.push({ w, sentence, ...r });
        // adapt: strong answer -> harder, weak -> easier and repeat the word later
        if (r.score === 4) level = Math.min(3, level + 0.5);
        else if (r.score <= 1) level = Math.max(1, level - 0.5);
        else if (r.score === 2) level = Math.max(1, level - 0.25);
        if (r.score <= 2 && !isRetry && i + 3 < total) retry.push({ w, dueAt: i + 3 });

        const next = i + 1 < total ? pickNext(i + 1) : null;
        const dir = !next ? "" : next.level > w.level ? " (a harder word)" : next.level < w.level ? " (an easier word)" : "";
        ta.disabled = true;
        $("#mark", el).remove(); $("#skip", el).remove(); $("#wmsg", el).textContent = "";
        $("#wfb", el).innerHTML = `
          <div class="feedback ${ok ? "right" : "wrong"}">
            ${r.skipped ? "" : `<div class="verdict">${STARS(r.score)} ${SCORE_WORDS[r.score]} (${r.score}/4)</div>`}
            <div>${esc(r.feedback)}</div>
            ${!r.skipped && r.corrected_sentence && r.corrected_sentence !== sentence ? `<div style="margin-top:6px"><strong>Better:</strong> ${esc(r.corrected_sentence)}</div>` : ""}
            <div style="margin-top:6px"><strong>Example:</strong> ${esc(r.model_sentence)}</div>
          </div>
          <div class="row" style="margin-top:12px"><button class="btn primary" id="wnext">${next ? `Next${dir} &rarr;` : "See results"}</button></div>`;
        $("#wnext", el).addEventListener("click", () => step(i + 1, next));
        $("#wnext", el).focus();
      }
    };
    step(0, pickNext(0));
  }

  function writeSummary(el, results) {
    const marked = results.filter((r) => !r.skipped);
    const avg = marked.length ? marked.reduce((s, r) => s + r.score, 0) / marked.length : 0;
    el.innerHTML = `
      <h1>Use It: results</h1>
      <div class="card stat">
        <div class="num">${avg.toFixed(1)}<span style="font-size:1rem;color:var(--muted)">/4</span></div>
        <div class="label">Average over ${marked.length} marked sentence${marked.length === 1 ? "" : "s"}${results.length > marked.length ? `, ${results.length - marked.length} skipped` : ""}.</div>
      </div>
      <div class="card">
        ${results.map((r) => `<div style="margin:8px 0;padding-bottom:8px;border-bottom:1px solid var(--line)">
          <strong>${esc(r.w.word)}</strong> ${r.skipped ? `<span class="badge weak">Skipped</span>` : `<span class="dots">${STARS(r.score)}</span>`}
          ${r.sentence ? `<div>${esc(r.sentence)}</div>` : ""}
          ${!r.skipped && r.corrected_sentence && r.corrected_sentence !== r.sentence ? `<div class="hint">Better: ${esc(r.corrected_sentence)}</div>` : ""}
          <div class="hint">${esc(r.skipped ? "Example: " + r.model_sentence : r.feedback)}</div></div>`).join("")}
      </div>
      <div class="row"><button class="btn primary" id="wagain">Another round</button><a class="btn" href="#dashboard">See my level</a></div>`;
    $("#wagain").addEventListener("click", () => renderWriteSetup(el));
  }

  // ---------- settings ----------
  function renderSettings(el) {
    el.innerHTML = `
      <h1>Settings</h1>
      <div class="card">
        <h2>About the word list</h2>
        <div class="notice">The built-in list is a curated set of item types that PSLE-style comprehension cloze passages test often:
        connectors, prepositions, relative pronouns, phrasal verbs, collocations, idioms and context vocabulary.
        It is <strong>not</strong> copied from any PSLE or school prelim paper. When you work through an actual paper,
        tag matching words with the source (e.g. "PSLE 2023" or "Nanyang Prelim 2024") or add new words with
        <em>Word List &rarr; Add a word from a paper</em>. You can then search the list by source.</div>
      </div>
      <div class="card">
        <h2>Home server</h2>
        ${server.online
          ? `<p>Connected. Progress is saved on the home server, so every device on the home network sees the same progress.${syncFailed ? ` <strong style="color:var(--bad)">The last save did not reach the server.</strong>` : ""}</p>
             <p>Sentence marking: ${server.marking ? `on, using ${esc(server.model)}.` : "off. Add ANTHROPIC_API_KEY to server/config.env and restart the server."}</p>`
          : `<p>Not connected. Progress is saved in this browser only, and the Use It quiz is unavailable.
             To share progress between devices and mark sentences, run the home server and open the app from its address. See the README.</p>`}
      </div>
      <div class="card">
        <h2>Back up and restore</h2>
        <p class="lead">Saves progress, test history, source tags and your added words to a file.</p>
        <div class="row">
          <button class="btn primary" id="exp">Export backup</button>
          <label class="btn">Import backup<input type="file" id="imp" accept="application/json" hidden></label>
          <span id="smsg" class="hint"></span>
        </div>
      </div>
      <div class="card">
        <h2>Start over</h2>
        <p class="lead">Clears progress and test history. Your added words and source tags are kept.</p>
        <button class="btn danger" id="reset">Reset progress</button>
      </div>`;
    $("#exp").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cloze-coach-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $("#imp").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => {
        const data = JSON.parse(txt);
        if (!data || typeof data.progress !== "object") throw new Error("not a backup");
        state = Object.assign(blankState(), data);
        save(); buildWords();
        $("#smsg").textContent = "Backup restored.";
      }).catch(() => { $("#smsg").textContent = "That file is not a valid backup."; });
    });
    $("#reset").addEventListener("click", () => {
      if (!confirm("Clear all progress and test history?")) return;
      state.progress = {}; state.tests = []; state.quizzes = []; state.sentences = [];
      save();
      $("#smsg").textContent = "Progress cleared.";
    });
  }

  async function init() {
    server = await window.ClozeTutor.status();
    if (server.online) {
      await pullState();
      $(".foot").textContent = "Progress is saved on the home server.";
      // pick up progress made on another device when this one comes back into view
      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState !== "visible") return;
        const tab = (location.hash || "#dashboard").slice(1);
        if ((await pullState()) && ["dashboard", "words", "settings"].includes(tab)) route();
      });
    }
    route();
  }
  init();
})();
