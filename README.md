# Cloze Word Coach

A small offline web app for practising **PSLE English Comprehension Cloze** vocabulary, for one learner.

- **Word List**: 281 built-in items, each with a meaning, an example sentence (the word that fills the blank is highlighted), a difficulty level (1 to 3) and other accepted answers. You can search and filter by category, level, status or source tag, and have a sentence read aloud.
- **Source tags**: tag any word with where you met it (e.g. `PSLE 2023`, `Nanyang Prelim 2024`), then search by that tag.
- **Add a word from a paper**: add your own items (word, meaning, example with a `[[blank]]`, other accepted answers).
- **Pop Quiz**: 5 to 20 questions, either typed open-ended answers (like the real paper) or multiple choice. Rounds can be a smart mix of due, weak and new words, or limited to a level or category. Hints are available, and each word is reviewed after you answer.
- **Level Test**: 20 adaptive typed questions that get harder when you answer correctly and easier when you don't. It gives a 0 to 100 score and a level from Foundation to Exam-ready. Scores are kept so you can see progress over time.
- **My Level dashboard**: latest test score and level, word-list mastery %, words due for review, mastery and accuracy per category, the weakest category to work on next, and a chart of test history.

## About the word list

The built-in list is a **curated** set of item types that comprehension cloze passages test often: connectors and conjunctions, prepositions, relative pronouns and determiners, phrasal verbs, collocations and fixed expressions, idioms, and context verbs, adjectives and adverbs.

It is **not** copied from any PSLE or school prelim paper. Those papers are copyrighted and not published in full. To build a list tied to real papers, work through the papers you have and use the source tags and **Add a word** feature. Use **Settings → Export backup** to keep that data safe.

## Running it

No install and no server. Open `index.html` in any modern browser (desktop, tablet or phone).

To use it on a phone or iPad, host the folder on GitHub Pages (repo Settings → Pages → deploy from this branch) and open the URL.

Progress is kept in the browser's `localStorage`, so it belongs to one browser on one device. Use Export or Import in Settings to move it between devices.

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
