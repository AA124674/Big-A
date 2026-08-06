# BIG A

A static, single-page front end for a Microsoft Copilot Studio agent. It is
plain HTML, CSS and JavaScript — no build step, no framework, no server, no
dependencies. Drop the folder into a GitHub Pages repository and it runs.

## What changed, and why

Copilot Studio has **retired the Direct Line "Token endpoint"** that older
custom canvases (including earlier versions of this app) relied on. Agents
created or republished now expose a **Microsoft 365 Agents SDK connection
string** on the Channels page instead, and are reached over a different
protocol — *Direct-to-Engine*.

BIG A now speaks that protocol natively. The older modes are still here as
fallbacks, because Microsoft still supports Direct Line for scenarios the
Agents SDK does not cover.

| Mode | Status | Use it when |
| --- | --- | --- |
| **Microsoft 365 Agents SDK** | Current, default | Always, unless something below applies |
| **Direct Line token endpoint** | Legacy | Your existing agent still shows a token endpoint and you do not want to change anything |
| **Direct Line + single sign-on** | Legacy | As above, and the agent requires user authentication |
| **Legacy embed (iframe)** | Fallback | Nothing else works and you just need the agent on screen |

Everything the interface can do is unchanged or better: local history,
drag-and-drop uploads, file thumbnails and full previews, chart and table
rendering, copy-a-message and copy-the-whole-conversation, the command palette
and the workbench.

## Setup: the Microsoft 365 Agents SDK

This is a one-time job with three parts: get the connection string, register an
app so people can sign in, and publish the agent.

### 1. Copy the connection details

1. Open your agent in **Copilot Studio**
2. Go to **Channels → Web app** (or **Native app**)
3. Copy the details shown under **Microsoft 365 Agents SDK**

If your Channels page does not show it, you can use the two values it is built
from instead, found under **Settings → Advanced → Metadata**:

- **Environment ID**
- **Schema name** (looks like `cr123_myAgent`)

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

1. Leave the mode on **Microsoft 365 Agents SDK**
2. Paste the connection string — the environment ID, schema name and tenant ID
   fill themselves in
3. Paste the **Application (client) ID**
4. Press **Sign in with Microsoft**, then **Test connection**
5. **Save & connect**

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
| Nothing happens on the Channels page | Your agent predates the change; use the legacy Direct Line mode |

## Known limitations

These are real constraints, not oversights:

- **File uploads are capped at about 4 MB each.** Direct-to-Engine has no
  multipart upload endpoint the way Direct Line did, so files travel inline as
  data URLs. Text that BIG A can read is also extracted and sent alongside the
  prompt, so large text files still work in substance if not in form.
- **No anonymous access.** Every visitor needs a Microsoft account with access
  to the agent. If you need an unauthenticated public chat, that is what the
  legacy embed mode is for.
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

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Command palette |
| `Enter` | Send |
| `Shift + Enter` | New line |
| `Esc` | Close a dialog or preview, or leave focus mode |

## Layout

| Area | What it does |
| --- | --- |
| Sidebar | Recents, Agents, Projects. Drag a chat onto a project to file it; drag it back to Recents to unfile it. |
| Top bar | Agent switcher (shows the agent's own name), connection state, and the usage note. Hover the connection pill for the transport in use and what the agent is currently doing. |
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
