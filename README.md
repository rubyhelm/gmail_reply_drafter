# Gmail Reply Drafter

A Gmail add-on built with Google Apps Script. Open an email, press **Draft reply**, and an LLM writes a reply draft that opens straight in the compose window. If the email asks about scheduling a call or interview, the draft can offer real free time slots taken from your Google Calendar.

It is aimed at job seekers replying to recruiters and hiring managers, but the profile/style field lets you adapt it to anything.

## Features

- One-click reply drafts from the Gmail side panel, with an optional hint ("decline politely", "ask for interview times").
- Availability from your calendars: free slots within your working hours, with buffer, meeting length, minimum notice, weekend and per-day limits.
- Works with any OpenAI-compatible chat completions API (OpenAI by default, Groq and others via the API URL setting).
- Multiple API keys with automatic rotation on rate limits (HTTP 429), one retry, and an optional fallback model.
- Replies to the newest incoming message in the thread (ignores drafts and your own messages) and strips quoted text before sending it to the model.
- The model is told not to invent facts: it only uses the profile you provide.
- Drafts are created with an HTML body (so email-tracking tools such as Mailsuite can work).

## Files

| File | Purpose |
|------|---------|
| [Code.gs](Code.gs) | All add-on logic: cards, settings, calendar lookup, prompt, API calls |
| [appsscript.json](appsscript.json) | Manifest: OAuth scopes, add-on triggers, time zone, Calendar advanced service |

## Installation

1. Go to [script.google.com](https://script.google.com) and create a **New project**.
2. Replace the contents of the default `Code.gs` with this repo's [Code.gs](Code.gs).
3. Show the manifest: **Project Settings** (gear icon) > tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace its contents with this repo's [appsscript.json](appsscript.json).
   - Change `"timeZone"` to your own (for example `"America/New_York"`). Offered times are formatted in this time zone.
4. Click **Deploy > Test deployments**, choose type **Google Workspace Add-on** (or **Gmail Add-on**), and click **Install**. Authorize the requested permissions when prompted.
5. Reload Gmail. The add-on icon (envelope) appears in the right-hand side panel.

For permanent use, create a regular deployment (**Deploy > New deployment**) instead of a test deployment.

> The manifest also enables the Calendar advanced service. The code calls the Calendar REST API directly, so this is not strictly required, but it is harmless.

### Permissions requested

| Scope | Why |
|-------|-----|
| `gmail.addons.current.message.readonly`, `gmail.readonly` | Read the open email and its thread |
| `gmail.compose`, `gmail.addons.current.action.compose` | Create the reply draft |
| `calendar.readonly` | Look up busy times to find free slots |
| `script.external_request` | Call the AI API |
| `userinfo.email` | Know which messages in a thread are yours |

## First-time setup

1. Open any email in Gmail and click the Reply Drafter icon.
2. Press **Settings** (bottom of the card).
3. Press **API keys**, paste your key, and press **Add key**. You can add several keys; they rotate if one is rate limited. Go back to Settings.
4. Fill in the **AI** section (see below) and press **Save**.

### AI settings

| Setting | Meaning |
|---------|---------|
| Model | Model name, e.g. an OpenAI model, or `llama-3.3-70b-versatile` on Groq |
| Fallback model (optional) | Tried if the main model fails or is rate limited. Example for Groq: `llama-3.1-8b-instant` |
| API URL | Any OpenAI-compatible chat completions endpoint. Default `https://api.openai.com/v1/chat/completions`. For Groq use `https://api.groq.com/openai/v1/chat/completions` |
| About me / style / CV summary | Your name, job target, tone, and a short CV summary (max about 8000 characters). The model uses only this to talk about you, so the more accurate it is, the better the drafts. Include how you sign off. |

Note: the default model name in `DEFAULTS` at the top of [Code.gs](Code.gs) is only a placeholder. Set a model that exists on your provider in Settings (or edit the default).

### Availability settings

| Setting | Meaning |
|---------|---------|
| Start time / End time | Working hours in which slots may be offered |
| Buffer around meetings | Padding added before and after existing events |
| Meeting length | Minimum free window length |
| Days ahead | How far into the future to look |
| Max time options (total) | Total number of windows offered |
| Max options per day | Windows per day |
| Minimum notice | Do not offer times sooner than this many hours from now |
| Include weekends | Off by default |
| Calendar IDs | Comma-separated calendar IDs (your email address for your primary calendar), or `all` to use every calendar in your calendar list except holidays and contacts/birthdays. **Leave this empty and no availability is ever used.** |

Calendars shared from another account must be shared with you at least with "See only free/busy".

## Daily use

1. Open an email (or a thread) in Gmail.
2. In the Reply Drafter panel, optionally:
   - type a **Hint**, such as `decline politely` or `ask for interview times`;
   - toggle **Include my availability** (on by default);
   - adjust start/end time, buffer, and meeting length for this reply only (these do not change your saved settings).
3. Press **Draft reply**. The draft opens in the compose window.
4. Review, edit, and send. Always check the draft before sending.

If the calendar lookup fails, the draft is still written without times, and the first line says `[NOTE: Calendar problem: ... Delete this line.]`. Delete that line before sending.

Example slot format the model is given, and will repeat as written:

```
Tue 7 Oct: 9:00am-11:30am, 2:00pm-4:00pm CDT
Wed 8 Oct: 10:15am-12:00pm CDT
```

## How it works

1. `onGmailMessageOpen` shows the card when you open an email.
2. `draftReply` picks the latest incoming message in the thread, reads the settings, and (if enabled) calls `freeWindows`, which queries the Calendar freeBusy API and computes free windows on a 15-minute grid.
3. `buildMessages` builds the prompt: system instructions plus your profile, then the sender, subject, cleaned body, available times, and your hint.
4. `callGroq` sends it to the API, rotating keys and falling back to the second model on errors.
5. `createDraftReply` saves the draft and the compose window opens on it.

Settings and keys are stored in Apps Script **User Properties**, which are private to your Google account and this script.

## Troubleshooting

| Message | Cause / fix |
|---------|-------------|
| `Add an API key in Settings > API keys` | No key saved yet |
| `AI request failed (401 ...)` | Invalid key, or a key that does not match the API URL |
| `AI request failed (404 ...)` / model error | Model name does not exist on that provider |
| `AI request failed (429 ...)` | Rate limited on all keys. Add more keys or a fallback model |
| `End time must be after start time` | Fix the hours on the card |
| `Calendar problem: no access to calendar "..."` | The calendar ID is wrong or not shared with you |
| No times offered | Calendar IDs empty, no free windows within your rules, or the email did not ask about scheduling |
| Changes to code do not appear | Re-deploy or reinstall the test deployment, then reload Gmail |

## Privacy

The sender, subject, the first 4000 characters of the latest message (quoted history removed), your profile text, your hint, and any free time slots are sent to the AI provider you configure. Calendar event details are never sent, only the computed free windows. Your API keys are stored in your own User Properties.
