# BIG A

A static, single-page front end for a Microsoft Copilot Studio agent — or for
Claude, Gemini, or any model on OpenRouter, talked to directly. It is plain
HTML, CSS and JavaScript — no build step, no framework, no server, no
dependencies. Drop the folder into a GitHub Pages repository and it runs.

## Start here: which mode should I use?

**Microsoft 365 Agents SDK is the default and recommended mode for a Copilot
Studio agent.** Newer Copilot Studio agents expose an Agents SDK connection
string and do not expose an anonymous Direct Line Token Endpoint. The Agents
SDK mode keeps BIG A's native, copyable, saved chat canvas, but requires Entra
ID user sign-in.

**Claude, Gemini and OpenRouter are separate, first-class modes**, for talking
to a model directly instead of a Copilot Studio agent. All three use the same
native canvas — saved history, streaming, copy buttons, file drops — but call
the provider's API directly from this browser with your own API key, so none
of them needs an Entra registration or an agent to publish. Gemini's key is
free to create, with no credit card, and stays within Google's free-tier
quota as long as a Flash-class model is selected. OpenRouter's key is also
free to create and can reach a rotating catalog of genuinely free models
across many providers, alongside every paid one, through the one key. Claude's
key is a normal paid API key.

| Mode | Setup needed | Notes |
| --- | --- | --- |
| **Microsoft 365 Agents SDK** (default) | Agents SDK connection string and an Entra single-page application | Uses the authenticated Direct-to-Engine protocol. Requires delegated `CopilotStudio.Copilots.Invoke`, admin consent, and user sign-in. |
| **Claude** | An Anthropic API key | Talks to the Anthropic API directly from this browser. No Copilot Studio agent, no Entra app, no sign-in — just a key. Billed per use. |
| **Gemini** | A free Gemini API key | Talks to Google's Gemini API directly from this browser. No Copilot Studio agent, no Entra app, no sign-in, no credit card — just a key, and Flash-class models stay within Google's free tier. |
| **OpenRouter** | A free OpenRouter API key | Talks to OpenRouter's unified API directly from this browser. One key reaches hundreds of models from dozens of providers, including a live, rotating catalog of $0 ones. No Copilot Studio agent, no Entra app, no sign-in. |
| **Legacy embed (iframe)** | None | Uses Copilot Studio's canvas in a frame. BIG A cannot style, read, copy, search, or save the messages inside it. |
| **Legacy Direct Line canvas** | A Token Endpoint shown by Copilot Studio | Only for older anonymous agents. It is unavailable if the Channels page does not show a Token Endpoint. |
| **Legacy Direct Line with single sign-on** | Token Endpoint and Entra setup | Retained for older agents that still expose Direct Line. |

### Why the mode matters

The Agents SDK, Claude, Gemini, OpenRouter, and legacy Direct Line modes
render every message in BIG A. This enables per-message copy buttons, saved
local history, themes, the workbench, and search. The iframe loads another
origin, so the browser prevents BIG A from reading or changing its contents.

Modes are stored per agent. One agent can talk to Claude, another to Gemini,
another to OpenRouter, another to the Agents SDK, or legacy Direct Line. Set
the mode when adding an agent or in **Connection settings**.

## Adding an agent

**Settings → Add an agent**, or the switcher in the top bar.

In the URL box you can paste **either** the plain address **or** the entire
embed code that Copilot Studio gives you. The `<iframe>` wrapper is stripped
automatically and only the address is kept, so there is no need to hunt for the
`src` by hand.

Choosing **Claude**, **Gemini** or **OpenRouter** as the mode hides the URL
box — none of them has a Copilot Studio address. Save the agent, then use the
**Connection settings** button right there in the same modal to add an API
key and pick a model.

## Setup: the Microsoft 365 Agents SDK

This setup is required for the default Microsoft 365 Agents SDK mode.

This is a one-time job with three parts: get the connection string, register an
app so people can sign in, and publish the agent.

### 1. Copy the connection details

1. Open your agent in **Copilot Studio**
2. Open the agent's **Channels** page, then pick **Web app** (or **Native app**)
3. Copy the value shown under **Microsoft 365 Agents SDK**

**Cannot find Channels?** It is a page belonging to the agent, not a tab in the
environment or a top-level menu item. Open the agent first, and Channels sits
alongside Overview, Knowledge, Tools, Topics and Activity. If your tenant is on
a build that does not surface it, use the fallback below instead.

**Manual fallback.** Prefer the complete connection string because it may
contain a direct-connect URL. If entering values manually, use the agent's
**Schema name** from **Settings → Advanced → Metadata** and copy **Environment
ID** from **Power Apps → Settings → Developer resources**. Default environments
legitimately use `Default-{tenant-id}`. Preserve that complete value because the
`Default-` prefix forms part of the Power Platform environment API hostname.

The Step 1 box also accepts a direct-connect URL, agent URL, HTML embed snippet,
or Session details block. Press **Read what I pasted** to see which fields were
recognised.

### 2. Register an application for sign-in

The Agents SDK protocol accepts **only Entra ID user tokens** — there is no
anonymous mode. This is the deliberate trade for the retired token endpoint,
and it means every user of this page signs in with their own Microsoft account.

In the **Azure portal → Microsoft Entra ID → App registrations → New**:

1. Under **Authentication**, add a **Single-page application** platform.
   The redirect URI must be exactly where you host this site, for example
   `https://yourname.github.io/big-a/`. BIG A shows you the exact string to
   paste in the Connection settings dialog.
2. Under **API permissions**, add **Power Platform API → Delegated permissions
   → `CopilotStudio.Copilots.Invoke`**, then **Grant admin consent**.
   *If Power Platform API is not in the list*, an admin must first register the
   `Microsoft.PowerPlatform` resource provider in the tenant.
3. Copy the **Application (client) ID** and **Directory (tenant) ID**.

### 3. Fill it in

In BIG A, open **Connection settings** (or `Ctrl/Cmd + K` → "connection"):

1. Choose who the settings are for. **This agent only** keeps them against the
   current agent; **Every agent** saves them as the workspace default.
2. Leave the mode on **Microsoft 365 Agents SDK**
3. **Step 1** — paste the connection string. The environment ID, schema name and
   tenant ID fill themselves in, and the line underneath shows the exact
   endpoint the settings resolve to.
4. **Step 2** — paste the **Application (client) ID**, then press **Sign in with
   Microsoft** and **Test connection**
5. **Save & connect**

Those two steps are everything that is required. Cloud, agent type, direct URL
and token scope live in the collapsed **Advanced** section and can be left
alone unless you are on a sovereign cloud or testing an unpublished agent.

### Mixing transports

The connection mode is per agent. An agent with no settings of its own uses the
workspace default, and any agent can be pinned to a different transport, so one
agent can run on the Agents SDK while another stays on the legacy embed. Set it
when adding the agent, or later via **This agent only** in Connection settings.

### 4. Publish the agent

The Agents SDK talks to the **published** agent. Unpublished changes will not
appear, and an unpublished agent returns a 404.

## Setup: Claude, direct to the Anthropic API

This is the whole setup, and it is much shorter than the Agents SDK's:

1. **Settings → Add an agent** (or **Connection settings** for an existing
   one). Give it a name and set **How this agent connects** to **Claude**.
2. Use the **Connection settings** button in that same modal — it saves what you just entered and takes you straight there.
3. Paste an API key from
   [console.anthropic.com → Settings → API keys](https://console.anthropic.com/settings/keys).
4. Pick a model — Claude Sonnet 5 is a reasonable default — and optionally add
   a system prompt to give this agent a persona or instructions, the way a
   Copilot Studio agent's own configuration would.
5. **Test connection**, then **Save & connect**.

That is it: no Entra registration, no admin consent, no publishing step, and
no sign-in. Requests go straight from this browser to `api.anthropic.com`
using the Messages API's own opt-in browser-access header (see Anthropic's
API docs for `anthropic-dangerous-direct-browser-access`), carrying the key
with every request. That trade-off is why the Connection settings panel says
it plainly: anyone with access to this browser can read the key back out of
its network requests, so use a key scoped to a low spending limit rather than
a personal or organisation-wide one.

**What carries over from Copilot Studio, and what does not:**

- **History is permanent**, the same as every other mode — it lives in this
  browser's local storage, not on Anthropic's servers. Because the Messages
  API itself is stateless, BIG A resends the visible transcript with every
  turn, rebuilt fresh from that local history each time the chat is opened.
- **Images and PDFs attach natively.** Anything Claude can read directly is
  sent as a real image or document, not just described. Other file types
  that BIG A can extract text from (code, CSV, JSON, plain text, and
  similar) are inlined as text, the same as the Agents SDK mode does; a
  handful of binary formats it cannot read either way (`.docx`, `.zip`, and
  so on) show up to Claude only as a note that a file was attached.
- **No server-side tools yet.** Copilot Studio's web search, and anything
  else configured on the agent side, has no equivalent here — this mode is
  plain conversation with Claude, nothing more.
- **The optional settings are optional for a reason.** Leave the model's
  default temperature and max tokens alone unless there is a specific need
  to change them; the current generation of Claude models (Sonnet 5, Opus 5,
  Fable 5) reject a non-default temperature outright, so that box only does
  anything on an older model such as Haiku 4.5.

## Setup: Gemini, free-tier direct to Google's API

The same idea as the Claude mode above, but the API key itself costs nothing:

1. **Settings → Add an agent** (or **Connection settings** for an existing
   one). Give it a name and set **How this agent connects** to **Gemini**.
2. Use the **Connection settings** button in that same modal — it saves what you just entered and takes you straight there.
3. Create a free key at
   [aistudio.google.com → Get API key](https://aistudio.google.com/apikey) —
   no credit card required.
4. Pick a model. Every model under **Free tier** in the dropdown stays within
   Google's no-cost quota; **Gemini 3.5 Flash** is a reasonable default.
   Pro-tier models are listed too, clearly marked, for when free-tier quality
   is not enough and a billed key is worth it.
5. Optionally add a system prompt, then **Test connection** and **Save &
   connect**.

**What is different from the free tier's "free," specifically:**

- **It is rate-limited, not unlimited.** Google publishes daily and
  per-minute request caps per model and adjusts them periodically — check
  [the current numbers](https://ai.google.dev/gemini-api/docs/rate-limits)
  rather than assume a fixed figure. Flash-Lite has the most headroom; Pro
  effectively requires billing for anything beyond very light, occasional
  use.
- **Google may use free-tier prompts to improve their models.** This is a
  documented difference between the free and paid tiers of the Gemini API —
  worth knowing before sending anything sensitive through a free key. Billed
  keys are not used this way.
- Everything else about how this mode behaves — permanent local history,
  native image/PDF attachments, no server-side tools, the API key living
  only in this browser and only ever sent to
  `generativelanguage.googleapis.com` — is identical to the Claude mode
  above; see its notes for the detail.

## Setup: OpenRouter, one key across hundreds of models

The same idea again, but instead of one provider this is a router in front of
dozens of them — OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, Qwen and
many more — including a catalog of genuinely free models that rotates as
providers add and retire them:

1. **Settings → Add an agent** (or **Connection settings** for an existing
   one). Give it a name and set **How this agent connects** to **OpenRouter**.
2. Use the **Connection settings** button in that same modal — it saves what
   you just entered and takes you straight there.
3. Create a free key at
   [openrouter.ai → Keys](https://openrouter.ai/keys) — no credit card
   required.
4. Click **Load free models** to fetch today's $0 catalog live from
   OpenRouter and pick one, or type any model ID directly (paid ones
   included) if it's already known.
5. Optionally add a system prompt, then **Test connection** and **Save &
   connect**.

**Why the model list is not just a dropdown of names, like Claude's and
Gemini's:** OpenRouter's free-model roster is far more volatile than either —
models get added and pulled with little notice as the underlying providers
change their own offerings. Hardcoding a "current free models" list here
would be wrong within days, so **Load free models** reads OpenRouter's own
live catalog ([`GET /api/v1/models`](https://openrouter.ai/models), the same
data behind [openrouter.ai/models](https://openrouter.ai/models)) instead of
guessing. The **Custom model ID** field is always available as a fallback —
useful for a brand-new model this page has not fetched yet, or for
deliberately picking a paid one.

**Other things worth knowing:**

- **Free models are rate-limited more tightly than paid ones**, and can queue
  or be briefly unavailable under load — expected for a $0 tier spread across
  many providers, not a fault. If one is being flaky, **Load free models**
  again and try a different one.
- **Only images attach natively here.** Unlike Claude and Gemini, there is no
  single standard way to send a PDF across every provider OpenRouter proxies
  to, so a PDF attachment shows up to the model only as a note that a file
  was there, the same graceful fallback any other unsupported file type
  already gets.
- A small `X-OpenRouter-Title` header is sent with every request, identifying
  this as "BIG A" for OpenRouter's own attribution — a fixed, generic string,
  not this deployment's actual address, so nothing about where this page is
  hosted is disclosed.
- Everything else — permanent local history, no server-side tools, the API
  key living only in this browser and only ever sent to `openrouter.ai` — is
  identical to the Claude and Gemini modes above.

## Troubleshooting

BIG A turns the common failures into plain English, but for reference:

| Symptom | Cause |
| --- | --- |
| `HTTP 401` | The app registration is missing `CopilotStudio.Copilots.Invoke`, or admin consent was never granted |
| `HTTP 403` | The signed-in user has no access to the agent's environment |
| `HTTP 404` | Wrong environment ID or schema name — or the agent has never been published |
| `AADSTS50011` | The redirect URI in the app registration does not match where the site is hosted, exactly |
| `AADSTS65001` | Admin consent is outstanding |
| Sign-in window never opens | The browser blocked the popup — use **Sign in via redirect** instead |
| `Could not load the Microsoft sign-in library` | A network filter or content blocker is blocking the CDN. Press **Check network access** in Connection settings to see exactly which sources are reachable, then either allow `cdn.jsdelivr.net` and `unpkg.com` or self-host the file (see `assets/vendor/README.md`) |
| No Token Endpoint appears on the Channels page | This agent has no anonymous Direct Line channel. Use the Microsoft 365 Agents SDK connection string instead |
| The embed shows "I'm your new agent" and prompt cards | That is Copilot Studio's demo site, not your agent. BIG A rewrites the URL to the embeddable canvas automatically; if you still see it, the agent's URL points somewhere other than `/environments/{id}/bots/{schema}/...` |
| No **Embed code** offered in Copilot Studio | Embed code is only shown while the agent's **Security → Authentication** is set to **No authentication** |
| A strip of the embed is cut off, or its header still shows | Adjust **Hide embedded header** in Settings. It defaults to 60px |
| `Token endpoint returned HTTP 400` on the native canvas | Almost always the default-environment trap below, not a fault in the agent |

### No Token Endpoint

If the agent's Channels page has no **Token Endpoint**, anonymous Direct Line is
not available for that agent. Endpoint discovery and environment-ID changes
cannot create a missing channel. Use the **Microsoft 365 Agents SDK** mode and
the connection string shown under **Web app** or **Native app**.

Legacy Direct Line remains available only for older agents whose Channels page
still displays a Token Endpoint. Paste that complete HTTPS endpoint into the
legacy mode's required field.

### The `Default-` environment value

For a tenant's default environment, Microsoft reports the Environment ID as
`Default-{tenant-id}`. This is a valid environment identifier. Keep the entire
value, including `Default-`, because the client normalizes it into the Power
Platform environment API hostname. Copy it from **Power Apps → Settings →
Developer resources**. Do not substitute the Organization ID or remove the
prefix.

### If your network blocks the sign-in library

Sign-in needs `msal-browser.min.js`. Microsoft stopped publishing that library
to `alcdn.msauth.net` at v3, so the pinned `5.18.0` build comes from the npm
package mirrors instead. Some school and corporate filters block those mirrors,
which stops sign-in before it ever reaches Microsoft.

BIG A tries three sources in order: a self-hosted copy, then the jsDelivr and
unpkg mirrors. **Check network access** in Connection settings reports which of
them this network can reach, and whether `login.microsoftonline.com` is
reachable at all.

If every source is blocked, self-hosting is the fix that cannot be blocked:
download `msal-browser.min.js` on any unrestricted machine and commit it to
`assets/vendor/`. See `assets/vendor/README.md` for the exact URL and filename.

## Known limitations

These are real constraints, not oversights:

- **File uploads are capped at about 4 MB each.** Direct-to-Engine has no
  multipart upload endpoint the way Direct Line did, so files travel inline as
  data URLs. Text that BIG A can read is also extracted and sent alongside the
  prompt, so large text files still work in substance if not in form.
  This limit applies to the Agents SDK mode. The native legacy canvas uploads
  through Direct Line's attachment endpoint and is not capped this way.
- **The Agents SDK mode has no anonymous access.** Every visitor needs a
  Microsoft account with access to the agent. For an unauthenticated public
  chat, use the iframe, or legacy Direct Line only when a Token Endpoint exists.
- **The legacy *embed* cannot be restyled, copied from, or saved.** Its contents
  belong to `copilotstudio.microsoft.com`, and the browser's same-origin policy
  forbids reaching into another origin's document. No CSS, script or setting can
  change its typography, colours or layout; nothing can read its messages to
  copy them; and nothing can persist its history. This is enforced by the
  browser, not a gap in this app.

  BIG A does the three things that *are* possible: it loads the embeddable
  canvas rather than the demo site, it gives the frame the full pane, and it
  crops the canvas's own header out of sight behind this app's top bar
  (**Settings → Hide embedded header**).

  **The fix is to not use the frame.** The default Agents SDK mode and the
  legacy Direct Line mode draw the conversation themselves and therefore have
  none of these restrictions. The frame remains available as a fallback.
- **Web search, charts and tools are agent-side features of Copilot Studio.**
  BIG A renders their output and reports their progress, but cannot switch
  them on — configure those in Copilot Studio. None of the Claude, Gemini or
  OpenRouter modes has an equivalent yet either; all three are plain
  conversation, with no server-side tools.
- **Conversations expire server-side** after a period of inactivity. Your
  transcript is kept locally forever and always displayed, but once a
  conversation has expired the *agent* no longer remembers those earlier turns.
  BIG A opens a fresh conversation automatically and replays the turn you were
  sending, so you will not lose a message. (This does not apply to the Claude,
  Gemini or OpenRouter modes: none has a server-side conversation to expire,
  since the whole visible transcript is resent on every turn.)
- **Claude, Gemini and OpenRouter attachments are capped at 5 MB each**, and
  are re-sent — re-read from local storage and re-uploaded — on every later
  turn of the same chat, since none of the three APIs has any memory of its
  own between requests. Long conversations with several large images (or,
  for Claude and Gemini, PDFs) will therefore use more bandwidth, and on a
  paid key more tokens, per turn as they grow. OpenRouter only attaches
  images natively; see its setup section above for what happens to a PDF
  there.
- **Gemini's free tier is rate-limited and may train on your prompts.**
  Google's no-cost quota is real but bounded — daily and per-minute request
  caps that Google adjusts periodically, tighter on Pro-tier models than on
  Flash — and, unlike the paid tier, free-tier requests may be used to
  improve Google's models. See the Gemini setup section above.
- **OpenRouter's free models rotate, and are more tightly rate-limited than
  paid ones.** The catalog is fetched live rather than hardcoded for exactly
  this reason — see its setup section above.

## Where your data lives

Everything — chats, the full message transcript, projects, attachments, and
any Claude, Gemini or OpenRouter API key you add — is stored **on your
machine** in IndexedDB, under the origin the site is served from. Nothing is
sent anywhere except the messages you send to your agent (and, for the
Claude, Gemini and OpenRouter modes, straight to `api.anthropic.com`,
`generativelanguage.googleapis.com` or `openrouter.ai` respectively);
connection settings, including any of the three API keys, never leave the
browser except in that outgoing request.

That means transcripts survive page closure, browser restart and machine
shutdown. It also means they are per-browser and per-device. To move a
workspace, use **Settings → Saved conversations → Back up**, then **Restore**
on the other machine.

If IndexedDB is unavailable (a private window, or a hardened browser), the app
falls back to localStorage automatically and says so in Settings.

### Clearing it

**Settings → Danger zone** has two options, and they differ in an important way:

| Button | Removes | Keeps |
| --- | --- | --- |
| **Clear chats** | Every conversation, message, project and attachment | Your agents, connection settings, theme and preferences |
| **Erase everything** | All of the above, *plus* agents, settings, the cached Microsoft sign-in, and the database itself | Nothing |

**Erase everything** deletes BIG A's IndexedDB database and BIG A-owned
localStorage keys, and signs the Microsoft account out locally. It deliberately
does not clear all same-origin localStorage, sessionStorage, or Cache Storage,
because other GitHub Pages applications can share that origin. The page then
reloads to a clean install.

Use it if an old build left an agent behind that you never added.

### Browser security

- MSAL stores account and token state in `sessionStorage`, not `localStorage`.
  Closing the tab removes it, which is safer on shared school computers.
- Agent-authored Markdown links, citations, attachment URLs, and HTML artifact
  previews are validated or sanitized before they enter the page.
- Direct-to-Engine URLs, including experimental endpoints returned in response
  headers, must remain on an approved Power Platform environment API hostname
  and authenticated Copilot Studio bot path.
- HTML artifact previews and HTML exports use a restricted version with scripts,
  frames, forms, event handlers, inline styles, unsafe URLs, SVG, and other
  executable elements removed. The source editor remains plain text.
- `index.html` includes a static-host-compatible Content Security Policy whose
  `connect-src` and `frame-src` enumerate individual origins rather than a
  blanket `https:`. See **Content Security Policy** below.
- Remote MSAL `5.18.0` and Bot Framework Web Chat `4.19.1` fallbacks are pinned.
  For the strongest supply-chain protection, place reviewed copies at
  `assets/vendor/msal-browser.min.js` and `assets/vendor/webchat.js`.

### Content Security Policy

GitHub Pages cannot send custom response headers, so the policy in the
`<meta http-equiv="Content-Security-Policy">` element of `index.html` is the one
actually enforced. Any host that *can* send headers should serve the identical
policy as a real header, which additionally covers `frame-ancestors` and
`sandbox` (both ignored in a meta policy):

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://cdn.botframework.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' blob: https://api.anthropic.com https://generativelanguage.googleapis.com https://openrouter.ai https://login.microsoftonline.com https://login.microsoftonline.us https://login.partner.microsoftonline.cn https://*.environment.api.powerplatform.com https://*.environment.api.preprod.powerplatform.com https://*.environment.api.gov.powerplatform.microsoft.us https://*.environment.api.high.powerplatform.microsoft.us https://*.environment.api.appsplatform.us https://*.environment.api.powerplatform.partner.microsoftonline.cn https://*.api.powerplatform.com https://powerva.microsoft.com https://*.powerva.microsoft.com https://copilotstudio.microsoft.com https://directline.botframework.com https://*.directline.botframework.com https://*.botframework.com https://*.blob.core.windows.net https://cdn.jsdelivr.net https://unpkg.com https://cdn.botframework.com wss://directline.botframework.com wss://*.directline.botframework.com; frame-src 'self' blob: https://copilotstudio.microsoft.com https://powerva.microsoft.com https://*.powerva.microsoft.com https://*.powervirtualagents.com https://*.botframework.com https://*.blob.core.windows.net; media-src 'self' blob: https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

A single-tenant deployment can narrow it further. If only the BGS environment is
used, every `*.environment.api.*` entry except
`https://*.environment.api.powerplatform.com` can be deleted, along with the
Direct Line and `powerva` entries when the legacy transports are unused, and
`connect-src` can name the one environment host outright:

```
https://defaulte0a762aaf74f473ab0864ceaefb71f.bd.environment.api.powerplatform.com
```

Two consequences are worth knowing before editing it:

- The legacy **iframe** mode can only frame the Microsoft-hosted canvases listed
  in `frame-src`. Framing a third-party canvas needs its host added there.
- If the CDN mirrors are removed from `script-src`, a vendored
  `assets/vendor/msal-browser.min.js` becomes mandatory.
- If the Claude, Gemini or OpenRouter modes are never used, their host
  (`https://api.anthropic.com`, `https://generativelanguage.googleapis.com`,
  `https://openrouter.ai`) can be removed from `connect-src` too. Pointing
  any of the three modes' optional **API base URL** at a compatible proxy
  instead of the provider's own API needs that proxy's host added here, or
  the browser blocks it.

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Command palette |
| `Ctrl/Cmd + \` | Show or hide the sidebar |
| `Ctrl/Cmd + Shift + \` | Shrink or expand the top bar |
| `Ctrl/Cmd + J` | Show or hide the workbench |
| `Ctrl/Cmd + Shift + O` | New chat |
| `Enter` | Send |
| `Shift + Enter` | New line |
| `Esc` | Close a dialog or preview, or leave focus mode |

`Esc` does not reach this page while the legacy *embed* has keyboard focus,
because the frame belongs to another origin and swallows the key. That is why
focus mode always shows an **Exit focus** button in the corner.

## Layout

| Area | What it does |
| --- | --- |
| Sidebar | Recents, Agents, Projects. Drag a chat onto a project to file it; drag it back to Recents to unfile it. |
| Top bar | Sidebar toggle, top-bar shrink toggle, agent switcher (with the agent's mark and name), connection state, the usage note and the appearance button. Hover the connection pill for the transport in use and what the agent is currently doing. |
| BIG A mark | The mark at the top of the sidebar returns to the home screen: the welcome pane a fresh install opens on. It closes the live session and deselects the current chat. Nothing is deleted. |
| Slim top bar | Shrinks the top bar to a 34px strip, folding away the usage note, the Commands button and the Workbench label. It never hides the bar completely, because the sidebar toggle lives there. |
| Focus mode | Hides the sidebar, workbench **and** top bar so the conversation has the whole window. Leave it with `Esc` or the corner button. |
| Conversation | Native messages, streamed as they are written. Hover one to copy it, send it to the workbench, retry it or delete it. Click an attachment for a full preview. Drop files anywhere on the panel. |
| Workbench | Renders markdown artifacts, tables and charts, and extracts text from files. |

## Appearance

**Settings → Appearance**, or the palette button in the top bar, or
`Ctrl/Cmd + K` → *Appearance*.

Two independent settings combine there:

| Setting | Values |
| --- | --- |
| Dark mode | On or off. It used to be a bare toggle in the top bar; it moved here so it sits with the colourways it now interacts with. |
| Colourway | Clay (the original), Pastel blue, Grey, Pinkish purple, Forest |

Every colourway has both a light and a dark version, so the two settings are
genuinely combinable — ten looks, not five. Under the hood the theme is
`<html data-theme="light|dark">` and the colourway is `<html data-palette="…">`;
`assets/css/styles.css` carries a matching pair of rules for each colourway.
Adding a sixth means adding one entry to `PALETTES` in `app.js`, one card in
`index.html`, and both halves of the rule in the stylesheet.

Both values are mirrored into `localStorage` (`biga.theme`, `biga.palette`) and
repainted before the first frame, so there is no flash of the wrong colour on
load. `Store.wipe()` clears both. A stored colourway that is not in the
whitelist falls back to Clay rather than being written onto the document.

The same page also holds the two sidebar controls:

- **Show agents in the sidebar** removes the whole Agents group.
- **Show individually hidden agents** reveals agents hidden one at a time with
  the eye button on their row.

Neither can strand an agent. The switcher at the top of the window and the
command palette always list every agent, hidden or not, and the sidebar prints
a count of how many are hidden and where to turn them back on.

## Agent icons

Each agent can carry its own picture. Add one when you create the agent, or
click the pencil on its row in the sidebar to edit an existing agent.

PNG, JPEG, GIF, WebP and AVIF are accepted, up to 6 MB. The file is not stored
as you supplied it: it is centre-cropped to a square, drawn into a canvas at
128 × 128 and re-encoded as a PNG, so what is saved is a plain bitmap this page
produced. Metadata, trailing payloads and malformed structure in the original
do not survive that round trip. The result is held with the agent in IndexedDB
and travels with a backup. Nothing is uploaded anywhere.

SVG is deliberately not accepted. An SVG is a document that can carry script,
which is also why `safeMarkdownUrl()` refuses `data:image/svg+xml`. Agents
without a picture keep their initials on a stable, name-derived tint.

## Files

| File | Role |
| --- | --- |
| `index.html` | App shell |
| `assets/css/styles.css` | The whole design system |
| `assets/js/store.js` | IndexedDB persistence, backup and restore |
| `assets/js/m365agents.js` | **Microsoft 365 Agents SDK / Direct-to-Engine client** — current transport |
| `assets/js/anthropic.js` | **Claude client** — talks to the Anthropic Messages API directly |
| `assets/js/gemini.js` | **Gemini client** — talks to Google's Gemini API directly, free tier included |
| `assets/js/openrouter.js` | **OpenRouter client** — talks to OpenRouter's unified API, free-model catalog fetched live |
| `assets/js/directline.js` | Direct Line 3.0 client — legacy transport, kept as a fallback |
| `assets/js/connect.js` | MSAL sign-in, shared by both authenticated transports |
| `assets/js/chat.js` | The conversation surface, streaming, previews and composer |
| `assets/js/app.js` | Sidebar, projects, drag and drop, settings, palette |
| `assets/js/artifacts.js` | Markdown, tables, charts, export |

## Protocol notes

For anyone maintaining this. The Direct-to-Engine calls are:

```
POST {base}/conversations?api-version=2022-03-01-preview
POST {base}/conversations/{conversationId}?api-version=2022-03-01-preview
```

where `{base}` is

```
https://{envPrefix}.{envSuffix}.environment.api.powerplatform.com
  /copilotstudio/dataverse-backed/authenticated/bots/{schemaName}
```

The environment ID has its dashes stripped; in the commercial cloud the last
**two** characters become the second DNS label (one character in the sovereign
clouds). Prebuilt agents use `/copilotstudio/prebuilt/...`.

Both calls answer with a **Server-Sent Events** stream of Bot Framework
activities. The new conversation ID arrives in the `x-ms-conversationid`
response header. Partial answers arrive as `typing` activities whose
`channelData.streamType` is `informative` (progress notices such as "Searching
the web") or `streaming` (partial answer text), followed by a final `message`.
BIG A handles both cumulative and incremental chunking.

**Claude** is unrelated to the above: it is one `POST {base}/v1/messages` per
turn, `stream: true`, with `x-api-key`, `anthropic-version` and
`anthropic-dangerous-direct-browser-access` headers, answered with the
Messages API's own SSE event stream (`content_block_delta` etc.) rather than
Bot Framework activities. `assets/js/anthropic.js` translates that stream into
the same `typing` / `message` activity shape the two Copilot Studio transports
produce, which is what lets `chat.js` render all three without knowing which
one is live. Because the Messages API holds no server-side conversation state,
there is no equivalent of `x-ms-conversationid` to resume — the whole
transcript is rebuilt from local storage and resent each time the chat opens,
then extended turn by turn in memory as replies stream back.

**Gemini** follows the same shape as Claude, for the same reason (no
server-side conversation to resume), but is a different API end to end: one
`POST {base}/v1beta/models/{model}:streamGenerateContent?alt=sse` per turn,
authenticated with an `x-goog-api-key` header, answered with a stream of
`GenerateContentResponse` JSON objects (`candidates[0].content.parts[]`)
rather than Anthropic's typed SSE events. `assets/js/gemini.js` translates
that into the same `typing` / `message` activity shape as the other
transports. It deliberately targets this classic `generateContent` REST
surface rather than Google's newer Interactions API
(`{base}/v1beta/interactions`) — as of this writing the Interactions API's
browser SDK sends an `Api-Revision` header that
`generativelanguage.googleapis.com` does not include in its CORS allow-list,
so it fails outright from a browser, while the classic endpoint used here
answers CORS preflights correctly for `content-type` and `x-goog-api-key`.
Worth re-checking if Google closes that gap, since the Interactions API is
where new Gemini features land first.

**OpenRouter** speaks the OpenAI Chat Completions wire format rather than a
bespoke one: one `POST {base}/api/v1/chat/completions` per turn, `stream:
true`, authenticated with a plain `Authorization: Bearer` header, answered
with a stream of `choices[0].delta.content` chunks terminated by a literal
`data: [DONE]` line. The system prompt travels as an ordinary leading
`{role:"system"}` message rather than a separate field, unlike both Claude
and Gemini. `assets/js/openrouter.js` translates the stream into the same
activity shape as the other three. Two details worth knowing if this ever
needs debugging: OpenRouter periodically sends an SSE *comment* line
(`: OPENROUTER PROCESSING`) as a keep-alive during long waits, which must be
skipped before it is ever handed to `JSON.parse` (an SSE comment is not
JSON); and a mid-generation failure arrives as a `data:` event with an
`error` field sitting at the top level alongside `choices`, not nested
inside one, terminating the stream with `finish_reason: "error"`. The model
list in Connection settings is populated by `OpenRouterClient.fetchModels()`,
which reads OpenRouter's own public, unauthenticated `GET /api/v1/models`
catalog live rather than trusting a hardcoded list — see the OpenRouter
setup section above for why that matters here specifically.

## Deploying to GitHub Pages

This site is pure static files — there is nothing to build. That gives you two
deployment routes, and the simpler one is also the more reliable one.

### Recommended: deploy from a branch

**Settings → Pages → Build and deployment → Source → Deploy from a branch**,
then pick `main` and `/ (root)`.

Branch-based publishing does not go through the Actions Pages deployment queue
at all, so it is immune to the `deployment_queued` stalls described below. The
`.nojekyll` file in the repository root is what makes this work: it tells Pages
to serve `assets/` verbatim instead of running the content through Jekyll,
which would otherwise ignore files and folders beginning with `_`.

Because there is no build step, a workflow buys you nothing here.

### Alternative: deploy via GitHub Actions

If you would rather keep the Actions route, use the workflow supplied at
`.github/workflows/deploy.yml`. It differs from the stock template in three
ways that matter:

- `timeout: 1800000` — 30 minutes instead of the 10-minute default, so a slow
  Pages runner allocation does not abort the deployment.
- `error_count: 20` and `reporting_interval: 10000` — tolerate transient
  status-check failures and poll less aggressively.
- `concurrency: { group: pages, cancel-in-progress: false }` — never cancel an
  in-flight deployment. Cancelling mid-flight is what wedges the `github-pages`
  environment and leaves later runs unable to acquire the deployment lock.

Set **Settings → Pages → Source** to **GitHub Actions** when using this route.

### If a deployment hangs on `deployment_queued`

Log lines like these mean the Pages backend never allocated a deployment
runner. The artifact uploaded fine and the deployment record was created — the
failure is entirely on GitHub's side:

```
Created deployment for <sha>, ID: <sha>
Getting Pages deployment status...
Current status: deployment_queued      <- repeats until it gives up
Error: Timeout reached, aborting!
```

This is a recurring GitHub Pages incident, not a fault in the site. Recovery,
in order:

1. Check <https://www.githubstatus.com> for an open Pages or Actions incident.
   If one is open, **stop pushing** — every push queues another run that will
   also wedge, which lengthens the recovery.
2. Wait for the incident to close, then push an empty commit:
   `git commit --allow-empty -m "retrigger pages deploy" && git push`
3. If a run is stuck and the UI reports "Failed to cancel workflow", force it:
   `gh api -X POST /repos/{owner}/{repo}/actions/runs/{run_id}/force-cancel`
4. If it is still wedged, disable and re-enable Actions under
   **Settings → Actions → General** to clear the queued state.
5. If you need the site up regardless of the incident, switch to branch-based
   publishing as described above. It bypasses the stuck queue entirely.
