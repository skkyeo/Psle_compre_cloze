# Cloze Word Coach

A small web app for practising **PSLE English Comprehension Cloze** vocabulary, for one learner.

- **Word List**: 281 built-in items, each with a meaning, an example sentence (the word that fills the blank is highlighted), a difficulty level (1 to 3) and other accepted answers. You can search and filter by category, level, status or source tag, and have a sentence read aloud.
- **Source tags**: tag any word with where you met it (e.g. `PSLE 2023`, `Nanyang Prelim 2024`), then search by that tag.
- **Add a word from a paper**: add your own items (word, meaning, example with a `[[blank]]`, other accepted answers).
- **Pop Quiz**: 5 to 20 questions, either typed open-ended answers (like the real paper) or multiple choice. Rounds can be a smart mix of due, weak and new words, or limited to a level or category. Hints are available, and each word is reviewed after you answer.
- **Use It** (needs the home server and an Anthropic API key): the app shows a word, and the learner writes an original sentence with it. Claude marks the sentence out of 4, explains the problem, gives a corrected version of the learner's own sentence, and adds a fresh example. A 4 leads to a harder word, a 1 or 2 leads to an easier one, and a missed word comes back three questions later. Every sentence is logged so a parent can review them.
- **Level Test**: 20 adaptive typed questions that get harder when you answer correctly and easier when you don't. It gives a 0 to 100 score and a level from Foundation to Exam-ready. Scores are kept so you can see progress over time.
- **My Level dashboard**: latest test score and level, word-list mastery %, words due for review, mastery and accuracy per category, the weakest category to work on next, and a chart of test history.

## About the word list

The built-in list is a **curated** set of item types that comprehension cloze passages test often: connectors and conjunctions, prepositions, relative pronouns and determiners, phrasal verbs, collocations and fixed expressions, idioms, and context verbs, adjectives and adverbs.

It is **not** copied from any PSLE or school prelim paper. Those papers are copyrighted and not published in full. To build a list tied to real papers, work through the papers you have and use the source tags and **Add a word** feature. Use **Settings → Export backup** to keep that data safe.

## Running it

**Without a server:** open `index.html` in a browser. Everything works except the Use It quiz, and progress stays in that one browser. Settings → Export/Import moves it between devices.

**With the home server (recommended):** a Raspberry Pi or an old Mac on your home network serves the app to every device. This gives you:

- **One shared progress record.** The iPad, a laptop and your phone all see the same progress. It is saved in `server/data/state.json`, with a daily copy in `server/data/backups/` (the last 30 days are kept).
- **Use It sentence marking.** The Anthropic API key lives only on the server, so it is never stored on your son's devices.

### Which machine

A **Raspberry Pi** is the better choice. It is always on, uses about 3 W and is silent, and the load here is tiny, so a Pi 3 or newer is plenty. It needs Raspberry Pi OS Bookworm or newer, which comes with Python 3.11.

An **old MacBook** also works, but it must stay awake with the lid open or with power and an external display connected. In System Settings → Battery/Energy, turn on "Prevent automatic sleeping when the display is off". It needs Python 3.10 or newer: macOS's built-in `python3` is 3.9, so install Python from python.org or with `brew install python`.

### Setup (same steps on both)

```bash
git clone https://github.com/skkyeo/Psle_compre_cloze.git ~/cloze-coach
cd ~/cloze-coach
bash server/setup.sh                 # installs, then sets it to start automatically
nano server/config.env               # paste your key after ANTHROPIC_API_KEY=
```

Then restart it so the key is picked up:
- Pi: `sudo systemctl restart cloze-coach`
- Mac: `launchctl kickstart -k gui/$(id -u)/com.clozecoach.server`

On the Mac, clone into your home folder, not into Documents or Desktop: macOS blocks background services from reading those folders. Allow incoming connections if the firewall asks.

Finally, open **http://<machine-name>.local:8000** on the iPad (for example `http://raspberrypi.local:8000`; setup prints the exact address). In Safari, use Share → Add to Home Screen to make it look like an app.

- **Updating:** `git pull`, then restart as above.
- **Logs:** Pi: `journalctl -u cloze-coach -f`. Mac: `server/data/server.log`.
- **Already used the app as a file:** the first time that browser opens the server address with no progress on the server yet, its progress is copied up. Otherwise, use Export in the old copy and Import in the new one.

### Security notes

- Keep the server on the home network only. Do not port-forward it on the router: it has no login, and anyone who can reach it can use your API key for marking. To use it away from home, install Tailscale on the server and the iPad.
- `server/config.env` holds the key. It is git-ignored, readable only by your user, and the server never serves it.
- Set a monthly spend limit for the key at console.anthropic.com. Each marked sentence costs about one US cent.
- If two devices are used at the same moment, the last one to save wins. Each device picks up the latest progress whenever it comes back to the front.

### The marking prompt

The marking prompt and rubric are in `server/marking.py` (`SYSTEM_PROMPT`). The model can be changed with `CLOZE_MODEL` in `server/config.env`.

| Score | Meaning |
|---|---|
| 4 | Word used correctly in meaning and grammar, and the sentence makes the meaning clear |
| 3 | Word used correctly, with a small slip elsewhere or a sentence too bare to show the meaning |
| 2 | Roughly the right idea, but the word itself is misused (e.g. "despite of") |
| 1 | Wrong meaning, or the sentence is too broken to tell |
| 0 | Word missing, off task, or the example copied |

## How progress is scored

- Each word sits in a review box from 0 to 5 (a Leitner system). A correct answer moves it up one box, unless a hint was used. A wrong answer moves it down two. Higher boxes wait longer before coming back for review (0, 1, 2, 4, 8 and 16 days).
- **Mastered** means box 4 or higher. **Weak** means box 0 after at least one try.
- **Word-list mastery %** is the average box ÷ 5 across all words.
- **Level Test score**: ability starts at 2 on the 1 to 3 difficulty scale. Each answer moves it up or down, and the step size shrinks as the test goes on. Correct answers on harder words move it further. The final ability is mapped to 0 to 100. This measures knowledge of this list and is not an official PSLE grade.

## Editing the built-in list

Words are stored in `data/words.js`, one row per word:

```js
["despite", "P", 2, "without being stopped by something", "[[Despite]] the heavy rain, the match went on.", ["alt answer"]],
```

After editing, run `node tools/validate.js` to check every row (exactly one `[[blank]]`, a valid category and level, no duplicate words).
