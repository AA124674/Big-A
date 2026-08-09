# BIG A

A static, single-page front end for a Microsoft Copilot Studio agent. It is
plain HTML, CSS and JavaScript — no build step, no framework, no server, no
dependencies. Drop the folder into a GitHub Pages repository and it runs.

## Start here: which mode should I use?

**Microsoft 365 Agents SDK is the default and recommended mode.** Newer
Copilot Studio agents expose an Agents SDK connection string and do not expose
an anonymous Direct Line Token Endpoint. The Agents SDK mode keeps BIG A's
native, copyable, saved chat canvas, but requires Entra ID user sign-in.

| Mode | Setup needed | Notes |
| --- | --- | --- |
| **Microsoft 365 Agents SDK** (default) | Agents SDK connection string and an Entra single-page application | Uses the authenticated Direct-to-Engine protocol. Requires delegated `CopilotStudio.Copilots.Invoke`, admin consent, and user sign-in. |
| **Legacy embed (iframe)** | None | Uses Copilot Studio's canvas in a frame. BIG A cannot style, read, copy, search, or save the messages inside it. |
| **Legacy Direct Line canvas** | A Token Endpoint shown by Copilot Studio | Only for older anonymous agents. It is unavailable if the Channels page does not show a Token Endpoint. |
| **Legacy Direct Line with single sign-on** | Token Endpoint and Entra setup | Retained for older agents that still expose Direct Line. |

### Why the mode matters

The Agents SDK and legacy Direct Line modes render every message in BIG A. This
enables per-message copy buttons, saved local history, themes, the workbench,
and search. The iframe loads another origin, so the browser prevents BIG A from
reading or changing its contents.

Modes are stored per agent. One older agent can use Direct Line while a current
agent uses the Agents SDK. Set the mode when adding an agent or in **Connection
settings**.

## Adding an agent

**Settings → Add an agent**, or the switcher in the top bar.

In the URL box you can paste **either** the plain address **or** the entire
embed code that Copilot Studio gives you. The `<iframe>` wrapper is stripped
automatically and only the address is kept, so there is no need to hunt for the
`src` by hand.

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
- **Web search, charts and tools are agent-side features.** BIG A renders their
  output and reports their progress, but cannot switch them on — configure
  those in Copilot Studio.
- **Conversations expire server-side** after a period of inactivity. Your
  transcript is kept locally forever and always displayed, but once a
  conversation has expired the *agent* no longer remembers those earlier turns.
  BIG A opens a fresh conversation automatically and replays the turn you were
  sending, so you will not lose a message.

## Where your data lives

Everything — chats, the full message transcript, projects and attachments — is
stored **on your machine** in IndexedDB, under the origin the site is served
from. Nothing is sent anywhere except the messages you send to your agent, and
the connection settings never leave the browser.

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
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://cdn.botframework.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' blob: https://login.microsoftonline.com https://login.microsoftonline.us https://login.partner.microsoftonline.cn https://*.environment.api.powerplatform.com https://*.environment.api.preprod.powerplatform.com https://*.environment.api.gov.powerplatform.microsoft.us https://*.environment.api.high.powerplatform.microsoft.us https://*.environment.api.appsplatform.us https://*.environment.api.powerplatform.partner.microsoftonline.cn https://*.api.powerplatform.com https://powerva.microsoft.com https://*.powerva.microsoft.com https://copilotstudio.microsoft.com https://directline.botframework.com https://*.directline.botframework.com https://*.botframework.com https://*.blob.core.windows.net https://cdn.jsdelivr.net https://unpkg.com https://cdn.botframework.com wss://directline.botframework.com wss://*.directline.botframework.com; frame-src 'self' blob: https://copilotstudio.microsoft.com https://powerva.microsoft.com https://*.powerva.microsoft.com https://*.powervirtualagents.com https://*.botframework.com https://*.blob.core.windows.net; media-src 'self' blob: https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
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

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Command palette |
| `Ctrl/Cmd + \` | Show or hide the sidebar |
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
| Top bar | Sidebar toggle, agent switcher (with the agent's mark and name), connection state, and the usage note. Hover the connection pill for the transport in use and what the agent is currently doing. |
| Focus mode | Hides the sidebar, workbench **and** top bar so the conversation has the whole window. Leave it with `Esc` or the corner button. |
| Conversation | Native messages, streamed as they are written. Hover one to copy it, send it to the workbench, retry it or delete it. Click an attachment for a full preview. Drop files anywhere on the panel. |
| Workbench | Renders markdown artifacts, tables and charts, and extracts text from files. |

## Files

| File | Role |
| --- | --- |
| `index.html` | App shell |
| `assets/css/styles.css` | The whole design system |
| `assets/js/store.js` | IndexedDB persistence, backup and restore |
| `assets/js/m365agents.js` | **Microsoft 365 Agents SDK / Direct-to-Engine client** — current transport |
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
