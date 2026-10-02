# Chrome Web Store listing (draft)

Ready to paste into the Chrome Web Store developer dashboard. Before uploading, remove the `key` field from `manifest.json` in the release zip (the store assigns its own ID), then put the new ID in `ALLOWED_EXTENSION_IDS` on Vercel.

## Store listing tab

**Name** (75 max)
Glossa: explain any text, remember every word

**Summary** (132 max)
Select any word or passage to see what it means in context, grounded in the page. Keeps a word list and underlines words you've met.

**Category:** Tools → Education (alternative: Productivity)

**Language:** English, plus localized listings (see the end of this file)

**Description**

> Select any text on a web page and Glossa explains what it means *here*, in plain language, in a side panel next to what you're reading.
>
> It doesn't just define words. Glossa reads the sentence around your selection. When the page defines a term or spells out an acronym, Glossa uses that definition and quotes the exact line, and it checks the quote against the page before showing it.
>
> **It remembers.** Every word you look up joins your own word list, with the sentence and page where you met it. When that word appears on another page, Glossa gives it a quiet dotted underline. Hover to see your saved meaning. A short review brings words back before you forget them.
>
> **Made for people who read a lot:** engineers reading English docs, researchers and students reading papers, people reading in a second language, new hires decoding company jargon, anyone reading a contract or a letter that matters.
>
> **How it works**
> • Select text, then press ⌥E (Mac) / Alt+E, click the Explain button, or right-click → Explain
> • Read the meaning that fits this sentence, at your level and in your language, plus a one-line meaning in your first language
> • Ask for simpler, deeper, examples, a translation, or your own question
> • Review your words, export them to Anki, Obsidian (Markdown), CSV or JSON
> • Read PDFs in the built-in Glossa reader (Chrome's PDF viewer hides selections from extensions)
>
> **Free, no API key needed.** A daily allowance of explanations, no account, no card. For unlimited use, add your own OpenAI, Anthropic, Groq, Gemini or OpenRouter key. On supported computers, choose "On this device" to use the AI built into Chrome, so your text never leaves your computer.
>
> **Private by design.** Nothing is sent until you ask. Only your selection and a little nearby text are sent, and you can switch the nearby text off. Your word list, history and settings stay in your browser. The underlines run on the page and send nothing.

**Screenshots** (1280×800, 3 to 5). The end-to-end run saves raw material in `e2e/.artifacts/`; re-shoot at 1280×800 with a real page:
1. A financial news article with "priced in" selected and the side panel answer showing its "From the page" quote
2. An acronym (NIM) with its full form and "Defined on this page"
3. "Your words" list with repeat counts and an expanded entry showing two sightings
4. A page with dotted underlines and the saved-meaning hover card
5. Review card ("What does this mean here?")

**Small promo tile** (440×280): logo and "Select. Understand. Remember."

## Privacy practices tab

**Single purpose**
Glossa explains text the user selects on a web page and keeps a personal list of the words they looked up, so they can recognise and review them later.

**Permission justifications**

| Permission | Justification |
|---|---|
| `sidePanel` | Shows explanations in Chrome's side panel next to the page. |
| `storage` | Saves settings, history and the word list on the user's device. |
| `unlimitedStorage` | A long word list (thousands of entries with example sentences) can exceed the default local storage quota. |
| `activeTab` | Reads the user's selection on the current tab when they press the shortcut or click Explain. |
| `scripting` | Injects the selection script into tabs that were already open when Glossa was installed or updated. |
| `contextMenus` | Adds "Explain '…'" to the right-click menu for selected text. |
| `favicon` | Shows the source site's icon next to an explanation. |
| Host permission for the Glossa API | Sends the selected text to Glossa's service to generate the explanation (free mode). |
| Host permissions for AI providers (OpenAI, Anthropic, Groq, Google, OpenRouter) | Used only when the user adds their own API key; the request goes from their browser to that provider. |
| Content script on all sites | Reads the selection when the user asks, shows the Explain button, and underlines words from the user's own word list. Page text is only compared locally and is not sent unless the user asks for an explanation. |
| Optional host permissions | Requested at the moment of use, only for a custom AI endpoint or to load a PDF from a site into the Glossa reader. |

**Remote code:** No. All code ships in the package. AI responses are treated as data and rendered as text.

**Data usage disclosures** (tick these):
- **Website content:** yes. The selected text and nearby text are sent when the user requests an explanation.
- **Personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity:** no. Glossa doesn't collect them. Users may select such text themselves, which is covered by "website content".
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL:** `https://<your-domain>/privacy`

## Localized listings

Gemini in Chrome was not yet available in the EU/UK as of June 2026, so these markets are worth a translated listing first: German, French, Spanish, Italian, Portuguese, Polish, Dutch. Translate the name, summary and description above. Keep "Glossa" untranslated.

## After approval
- Apply for the **Featured** badge (Developer dashboard → Store listing → request a review). It requires no paywalled core features, a clear privacy policy, and a polished listing; all of these are true for Glossa today.
- Point the website's "Add to Chrome" buttons at the store URL instead of the zip.
