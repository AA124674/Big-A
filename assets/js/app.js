/* ==========================================================================
   app.js — BIG A workspace shell
   Navigation, chat registry, projects, agents, workbench, palette, exports.

   The chat surface itself lives in chat.js and the transport in
   directline.js; this file wires them to the UI and to durable storage.
   ========================================================================== */

(function (global) {
  "use strict";

  var A = global.Artifacts;
  var Store = global.Store;
  var Chat = global.Chat;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ------------------------------------------------------------- constants */

  var THEME_KEY = "biga.theme";   // mirrored to localStorage to avoid a flash
  var PALETTE_KEY = "biga.palette";

  /* The colourways. `id` is the value of the data-palette attribute that the
     stylesheet keys off; every entry here must have a matching pair of rules
     in styles.css (a light half and a dark half). "clay" is the original look
     and is treated as the default, so an install that has never opened the
     appearance page renders exactly as it did before.

     Kept as a whitelist rather than trusting whatever is in storage: the value
     goes straight onto an attribute of <html>, so it must be one of these. */
  var PALETTES = ["clay", "adobe", "blue", "grey", "orchid", "forest"];
  var PALETTE_LABEL = {
    clay: "Clay",
    adobe: "Adobe",
    blue: "Pastel blue",
    grey: "Grey",
    orchid: "Pinkish purple",
    forest: "Forest"
  };

  /* Uploaded agent icons are re-encoded to a square PNG at this size. Large
     enough for the 30px avatar on a 2x display, small enough that a handful of
     agents cannot fill the preferences record. */
  var ICON_PX = 128;
  var ICON_MAX_BYTES = 6 * 1024 * 1024;   // refused before decoding

  /* There is deliberately no seeded agent. A fresh install starts on the
     welcome pane and the first agent is whichever one the user adds, so the
     interface never claims a connection it does not have. The agent's own
     name is the only label used for it anywhere in the UI: in the switcher,
     in the sidebar, and on each of its messages. */

  var ICONS = {
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    search: '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="m20 20-3.6-3.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
    bot: '<rect x="4" y="7" width="16" height="12" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 4v3M9 13h.01M15 13h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
    folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v1H5.5L3 17z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M3 17h16l2-7H5.5z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    check: '<path d="m4 12 5 5L20 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    x: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    settings: '<circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.5l2 1.2M17.5 15.3l2 1.2M4.5 16.5l2-1.2M17.5 8.7l2-1.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    sun: '<circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M15 4v16" stroke="currentColor" stroke-width="1.8"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-.6 4M20 5v6h-6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    paperclip: '<path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.9-7.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
    activity: '<path d="M3 12h4l3 8 4-16 3 8h4" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    print: '<path d="M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    chevron: '<path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
    plug: '<path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0zM12 18v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><circle cx="7.8" cy="11.5" r="1.05" fill="currentColor"/><circle cx="11" cy="7.6" r="1.05" fill="currentColor"/><circle cx="15.6" cy="8.6" r="1.05" fill="currentColor"/>',
    collapseBar: '<path d="M4 5h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 20V11m0 0-3 3m3-3 3 3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.7" stroke="currentColor" stroke-width="1.7" fill="none"/>',
    eyeOff: '<path d="M4 4l16 16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M9.9 5.9A9.4 9.4 0 0 1 12 5.7c6 0 9.5 6.3 9.5 6.3a17 17 0 0 1-3.2 3.9M6.4 7.9A17 17 0 0 0 2.5 12S6 18.3 12 18.3c1.2 0 2.3-.2 3.3-.6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.8 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
  };

  function icon(name, cls) {
    return '<svg viewBox="0 0 24 24" class="' + (cls || "") + '" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }

  var SAMPLE_DOC =
    "# Quarterly Performance Review\n\n" +
    "A short demonstration of the artifact renderer. Replace this with any text the agent gives you.\n\n" +
    "## Highlights\n\n" +
    "- Revenue grew **18%** against the prior quarter\n" +
    "- Support resolution time fell to *4.2 hours*\n" +
    "- Two new regions came online\n\n" +
    "## Results by region\n\n" +
    "| Region | Revenue | Growth | Status |\n" +
    "| --- | --- | --- | --- |\n" +
    "| North | 412,000 | 12% | On track |\n" +
    "| South | 388,500 | 24% | Ahead |\n" +
    "| East | 205,900 | 6% | Watch |\n" +
    "| West | 331,200 | 19% | On track |\n\n" +
    "> Growth was driven mainly by the South region following the March campaign.\n\n" +
    "## Next steps\n\n" +
    "1. Rebalance spend toward the South\n" +
    "2. Review the East pipeline\n" +
    "3. Publish the revised forecast\n\n" +
    "```js\nconst growth = (now, before) => ((now - before) / before) * 100;\nconsole.log(growth(412000, 349000).toFixed(1) + '%');\n```\n";

  var SAMPLE_DATA = "Region,Revenue,Target\nNorth,412000,400000\nSouth,388500,310000\nEast,205900,240000\nWest,331200,300000\n";

  /* ------------------------------------------------------------ app state */

  var state = {
    theme: "light",
    // Second axis of the appearance decision. See PALETTES above.
    palette: "clay",
    // Whether the top bar is in its shrunken form. Persisted, because a layout
    // preference that resets on every reload is not a preference.
    slimTopbar: false,
    agents: [],
    activeAgent: "default",
    activeChat: null,
    // The workbench is opt-in. Opening a side panel unasked on first load
    // buries the conversation and surprises people; it is one click or
    // Ctrl/Cmd + J away whenever it is wanted.
    // `showAgents` hides the whole Agents group in the sidebar;
    // `showHiddenAgents` reveals agents that were hidden one at a time. Both
    // are presentation only: the top-bar switcher and the command palette
    // always list every agent, so nothing here can strand one.
    settings: {
      fileAttach: true,
      autoOpenWorkbench: false,
      showAgents: true,
      showHiddenAgents: false
    },
    // How much of the embedded canvas's own header is hidden behind our top
    // bar, in CSS pixels. 0 shows it. Stored separately from the boolean
    // switches above because it is a number, not a toggle.
    embedCrop: 60,
    connection: {
      // Default transport: authenticated Direct-to-Engine. New Copilot Studio
      // agents expose an Agents SDK connection string rather than an anonymous
      // Direct Line token endpoint.
      mode: "m365",
      connectionString: "",
      environmentId: "",
      schemaName: "",
      cloud: "prod",
      agentType: "published",
      directConnectUrl: "",
      // Entra ID app registration used by every authenticated mode.
      clientId: "",
      tenantId: "",
      scope: "",
      // Legacy Direct Line fallback.
      tokenEndpoint: "",
      // Claude, direct to the Anthropic API.
      claudeApiKey: "",
      claudeModel: "",
      claudeSystemPrompt: "",
      claudeMaxTokens: "",
      claudeTemperature: "",
      claudeBaseUrl: "",
      // Gemini, direct to Google's free-tier API.
      geminiApiKey: "",
      geminiModel: "",
      geminiSystemPrompt: "",
      geminiMaxTokens: "",
      geminiTemperature: "",
      geminiBaseUrl: "",
      // OpenRouter, one key across hundreds of models.
      openrouterApiKey: "",
      openrouterModel: "",
      openrouterSystemPrompt: "",
      openrouterMaxTokens: "",
      openrouterTemperature: "",
      openrouterBaseUrl: ""
    },
    artifact: { title: "Untitled document", type: "markdown", source: "" },
    log: []
  };

  var chats = [];       // cached from Store
  var projects = [];    // cached from Store

  function savePrefs() {
    return Promise.all([
      Store.kv.set("theme", state.theme),
      Store.kv.set("palette", state.palette),
      Store.kv.set("slimTopbar", state.slimTopbar),
      Store.kv.set("agents", state.agents),
      Store.kv.set("activeAgent", state.activeAgent),
      Store.kv.set("activeChat", state.activeChat),
      Store.kv.set("settings", state.settings),
      Store.kv.set("embedCrop", state.embedCrop),
      Store.kv.set("connection", state.connection),
      Store.kv.set("artifact", state.artifact)
    ]).catch(function () { /* storage full or blocked: keep running */ });
  }

  function loadPrefs() {
    return Store.kv.all().then(function (kv) {
      if (kv.theme) state.theme = kv.theme;
      // Anything not in the whitelist falls back to the default rather than
      // being written onto <html>.
      if (kv.palette && PALETTES.indexOf(kv.palette) !== -1) state.palette = kv.palette;
      if (typeof kv.slimTopbar === "boolean") state.slimTopbar = kv.slimTopbar;
      if (kv.settings && typeof kv.settings === "object") {
        Object.keys(state.settings).forEach(function (k) {
          if (typeof kv.settings[k] === "boolean") state.settings[k] = kv.settings[k];
        });
      }
      if (kv.artifact && typeof kv.artifact === "object") state.artifact = kv.artifact;
      if (typeof kv.embedCrop === "number" && kv.embedCrop >= 0 && kv.embedCrop <= 200) {
        state.embedCrop = kv.embedCrop;
      }

      state.agents = Array.isArray(kv.agents) ? kv.agents.filter(Boolean) : [];

      // Earlier builds shipped a seeded agent pointing at whichever tenant the
      // site was built for. Nothing creates a built-in agent any more, so drop
      // any that survive from an older install rather than leaving people
      // staring at a connection error for an agent they never chose.
      //
      // The flag alone is not enough: the very first builds seeded the agent
      // WITHOUT marking it, so it is also matched by shape. A seeded agent is
      // one the user never edited, carrying a name this app used to ship. A
      // real agent someone happened to name "Claude" survives, because adding
      // one always records `addedAt`.
      var SEEDED_NAMES = ["claude", "big a", "biga", "demo agent", "default"];
      state.agents = state.agents.filter(function (a) {
        if (a.builtin) return false;
        if (a.addedAt) return true;
        return SEEDED_NAMES.indexOf(String(a.name || "").trim().toLowerCase()) === -1;
      });

      state.activeAgent = kv.activeAgent && state.agents.some(function (a) { return a.id === kv.activeAgent; })
        ? kv.activeAgent
        : (state.agents[0] ? state.agents[0].id : null);
      state.activeChat = kv.activeChat || null;

      var conn = kv.connection;
      if (conn && typeof conn === "object") {
        Object.keys(state.connection).forEach(function (k) {
          if (typeof conn[k] === "string") state.connection[k] = conn[k];
        });
      }
      if (["iframe", "m365", "directline", "sso", "claude", "gemini", "openrouter"].indexOf(state.connection.mode) === -1) {
        state.connection.mode = "m365";
      }

      migrateConnection();
    });
  }

  /**
   * Older versions of this app only knew about Direct Line token endpoints,
   * which Copilot Studio has retired. Where possible, derive the Agents SDK
   * settings from what is already stored so nobody has to reconfigure by hand.
   */
  function migrateConnection() {
    var c = state.connection;
    var M = global.M365Agents;
    if (!M) return;

    if (!c.environmentId && !c.directConnectUrl) {
      var agent = currentAgent();
      var source = c.connectionString || (agent && agent.url) || "";
      if (source) {
        try {
          var parsed = M.parseConnection(source);
          if (parsed.environmentId) c.environmentId = parsed.environmentId;
          if (parsed.schemaName) c.schemaName = parsed.schemaName;
          if (parsed.directConnectUrl) c.directConnectUrl = parsed.directConnectUrl;
          if (parsed.tenantId && !c.tenantId) c.tenantId = parsed.tenantId;
          if (parsed.clientId && !c.clientId) c.clientId = parsed.clientId;
          if (parsed.cloud) c.cloud = parsed.cloud;
        } catch (e) { /* nothing derivable: the user will fill the form in */ }
      }
    }

  }

  function tokenScope(settings) {
    if (settings && settings.scope) return settings.scope;
    if (global.M365Agents && global.M365Agents.scopeForCloud) {
      return global.M365Agents.scopeForCloud(settings && settings.cloud);
    }
    return global.Connect ? global.Connect.DEFAULT_AGENT_SCOPE : "";
  }

  function uid() { return Store.uid(); }

  function currentAgent() {
    return state.agents.filter(function (a) { return a.id === state.activeAgent; })[0] ||
           state.agents[0] || null;
  }

  /** True while the workspace has no agent to talk to. */
  function hasAgent() { return state.agents.length > 0; }

  /* ------------------------------------------------- per-agent connection */

  /* Connection settings are workspace-wide by default, but any agent may
     override any of them — including the transport itself. That is what lets
     one agent run the full Agents SDK client while another sits on the legacy
     embed, which is common while an older agent is being migrated. */

  var CONN_KEYS = [
    "connectionString", "directConnectUrl", "environmentId", "schemaName",
    "cloud", "agentType", "clientId", "tenantId", "scope", "tokenEndpoint",
    "claudeApiKey", "claudeModel", "claudeSystemPrompt", "claudeMaxTokens", "claudeTemperature", "claudeBaseUrl",
    "geminiApiKey", "geminiModel", "geminiSystemPrompt", "geminiMaxTokens", "geminiTemperature", "geminiBaseUrl",
    "openrouterApiKey", "openrouterModel", "openrouterSystemPrompt", "openrouterMaxTokens",
    "openrouterTemperature", "openrouterBaseUrl"
  ];

  /** The settings actually in force for one agent: its overrides over ours. */
  function effectiveConn(agent) {
    var out = {};
    Object.keys(state.connection).forEach(function (k) { out[k] = state.connection[k]; });

    // Earlier builds stored per-agent Agents SDK details under `m365`.
    if (agent && agent.m365 && typeof agent.m365 === "object") {
      Object.keys(agent.m365).forEach(function (k) { if (agent.m365[k]) out[k] = agent.m365[k]; });
    }
    if (agent && agent.conn && typeof agent.conn === "object") {
      if (agent.conn.mode) out.mode = agent.conn.mode;
      CONN_KEYS.forEach(function (k) { if (agent.conn[k]) out[k] = agent.conn[k]; });
    }
    if (agent && agent.tokenEndpoint && !out.tokenEndpoint) out.tokenEndpoint = agent.tokenEndpoint;
    return out;
  }

  function activeConn() { return effectiveConn(currentAgent()); }
  function activeMode() { return activeConn().mode || "m365"; }

  /** True when this agent carries its own settings rather than inheriting. */
  function agentHasOverride(agent) {
    if (!agent || !agent.conn || typeof agent.conn !== "object") return false;
    if (agent.conn.mode) return true;
    return CONN_KEYS.some(function (k) { return !!agent.conn[k]; });
  }

  /* ---------------------------------------------------------------- toasts */

  function toast(msg, kind) {
    var host = $("#toasts");
    var el = document.createElement("div");
    el.className = "toast" + (kind === "err" ? " err" : "");
    el.innerHTML = icon(kind === "err" ? "info" : "check") + "<span></span>";
    $("span", el).textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      setTimeout(function () { el.remove(); }, 320);
    }, 2900);
  }

  /* -------------------------------------------------------------- activity */

  function logEvent(title, detail, kind) {
    state.log.unshift({ t: Date.now(), title: title, detail: detail || "", kind: kind || "" });
    if (state.log.length > 120) state.log.length = 120;
    renderLog();
    var badge = $("#tab-activity .badge");
    if (badge) { badge.textContent = state.log.length; badge.hidden = false; }
  }

  function timeAgo(t) {
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return new Date(t).toLocaleDateString();
  }

  function renderLog() {
    var host = $("#log-list");
    if (!host) return;
    if (!state.log.length) {
      host.innerHTML = '<li class="side-empty">No activity yet. Actions you take in this workspace appear here.</li>';
      return;
    }
    host.innerHTML = state.log.map(function (e) {
      return '<li class="log-item"><div class="log-ico ' + (e.kind || "") + '">' +
        icon(e.kind === "ok" ? "check" : e.kind === "warn" ? "info" : "activity") +
        '</div><div class="log-body"><strong></strong>' +
        (e.detail ? "<code></code><br>" : "") +
        "<span>" + timeAgo(e.t) + "</span></div></li>";
    }).join("");
    $$(".log-item", host).forEach(function (li, i) {
      $("strong", li).textContent = state.log[i].title;
      var c = $("code", li);
      if (c) c.textContent = state.log[i].detail;
    });
  }

  /* ----------------------------------------------------------------- theme */

  function applyTheme(t) {
    state.theme = t === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", state.theme);
    // The old top-bar theme button has moved into the appearance page, so this
    // is written defensively: applyTheme runs before the appearance controls
    // are necessarily in the document, and it must not throw either way.
    var sw = $("#dark-toggle");
    if (sw) sw.setAttribute("aria-checked", String(state.theme === "dark"));
    try { localStorage.setItem(THEME_KEY, state.theme); } catch (e) { /* ignore */ }
    Store.kv.set("theme", state.theme);
  }

  /**
   * The colourway. Written as a separate attribute from the theme so the two
   * compose: styles.css carries a light and a dark rule for every colourway,
   * and the browser picks the pair. Doing it as one combined value would have
   * meant twelve mutually exclusive themes instead of six plus a switch.
   */
  function applyPalette(p) {
    if (PALETTES.indexOf(p) === -1) p = "clay";
    state.palette = p;
    document.documentElement.setAttribute("data-palette", p);
    syncPaletteCards();
    try { localStorage.setItem(PALETTE_KEY, p); } catch (e) { /* ignore */ }
    Store.kv.set("palette", p);
  }

  function syncPaletteCards() {
    $$("#palette-grid [data-palette]").forEach(function (card) {
      var on = card.dataset.palette === state.palette;
      card.setAttribute("aria-checked", String(on));
      // Roving tabindex: the group is one tab stop, arrows move within it.
      card.tabIndex = on ? 0 : -1;
    });
  }

  /** Open the appearance page with every control showing the live state. */
  function openAppearance() {
    var dark = $("#dark-toggle");
    if (dark) dark.setAttribute("aria-checked", String(state.theme === "dark"));
    var slim = $("#slim-toggle");
    if (slim) slim.setAttribute("aria-checked", String(!!state.slimTopbar));
    var sa = $("#show-agents-toggle");
    if (sa) sa.setAttribute("aria-checked", String(!!state.settings.showAgents));
    var sh = $("#show-hidden-agents-toggle");
    if (sh) sh.setAttribute("aria-checked", String(!!state.settings.showHiddenAgents));
    syncPaletteCards();
    openModal("#appearance-modal");
  }

  /* ------------------------------------------------------- connection pill */

  var STATUS_TEXT = {
    connecting: ["Connecting", "warn"],
    signin: ["Signing in", "warn"],
    online: ["Live", "secure"],
    reconnecting: ["Reconnecting", "warn"],
    offline: ["Offline", "err"],
    embed: ["Legacy embed", "warn"],
    err: ["Problem", "err"],
    idle: ["Not connected", ""]
  };

  var MODE_LABEL = {
    m365: "Microsoft 365 Agents SDK",
    claude: "Claude \u00b7 Anthropic API",
    gemini: "Gemini \u00b7 Google AI (free tier)",
    openrouter: "OpenRouter",
    directline: "Legacy \u00b7 Direct Line, native canvas",
    sso: "Legacy \u00b7 Direct Line with single sign-on",
    iframe: "Legacy \u00b7 embedded frame"
  };

  function setStatus(kind, detail) {
    var el = $("#conn-status");
    var map = STATUS_TEXT[kind] || ["", ""];
    el.textContent = map[0];
    el.className = "conn-pill " + map[1];
    // The tooltip carries the detail: which transport, and what went wrong.
    el.title = [MODE_LABEL[activeMode()] || "", detail || map[0]]
      .filter(Boolean).join(" · ");
  }

  /**
   * Keep the top bar in step with the transport in use.
   *
   * The frame mode once had a whole bar of its own, then a badge beside the
   * status pill. Both were saying what the pill already says, so only the
   * frame-specific BUTTONS remain conditional. One statement of fact, one
   * place to read it.
   */
  function syncTopbarMode() {
    var framed = hasAgent() && activeMode() === "iframe";
    var acts = $("#legacy-acts");
    if (acts) acts.hidden = !framed;
    document.body.classList.toggle("legacy-embed", framed);
  }

  /**
   * Push the chosen header crop into CSS, where the clip window reads it.
   *
   * The crop only makes sense while the top bar exists: it slides Copilot
   * Studio's own header up so that OUR bar covers it. Focus mode hides our
   * bar, so keeping the crop would shear the top off the agent's canvas and
   * leave a blank strip with nothing covering it. In focus mode the crop is
   * therefore forced to zero, which is what made focus mode look broken in
   * the legacy frame.
   */
  function applyEmbedCrop() {
    var px = Math.max(0, Math.min(200, Number(state.embedCrop) || 0));
    if (document.body.classList.contains("zen")) px = 0;
    document.documentElement.style.setProperty("--embed-crop", px + "px");
  }

  /* ----------------------------------------------------- agent connection */

  /* Exactly one of the three stage panes is visible at any time. */
  function showPane(which) {
    $("#welcome-pane").hidden = which !== "welcome";
    $("#chat-surface").hidden = which !== "chat";
    $("#embed-pane").hidden = which !== "embed";
  }

  /** Landing state: no agent configured yet, so there is nothing to connect. */
  function showWelcome() {
    Chat.disconnect();
    stopEmbed();
    showPane("welcome");
    $("#agent-name").textContent = "No agent";
    $("#wb-agent").textContent = "No agent";
    renderAgentAvatar();
    document.title = "BIG A";
    setStatus("idle", "Add an agent to get started");
    syncTopbarMode();
    return Promise.resolve();
  }

  /**
   * The BIG A mark in the sidebar head. It was an anchor pointing at "#",
   * which did nothing at all; it now returns to the home screen — the same
   * welcome pane a fresh install opens on, before any agent has been added.
   *
   * Nothing is deleted. The live session is closed and the open chat is
   * deselected so that clicking that same chat in the sidebar reopens it (the
   * chat opener short-circuits when the requested chat is already the active
   * one, so leaving it selected would have made the sidebar look broken).
   * Agents, chats, projects and settings are all untouched.
   */
  function goHome() {
    Chat.disconnect();
    stopEmbed();
    document.body.classList.remove("zen");
    state.activeChat = null;
    savePrefs();
    showPane("welcome");
    // The top bar still names the active agent: the home screen is a place in
    // the app, not a sign-out, and blanking the agent would suggest otherwise.
    var agent = hasAgent() ? currentAgent() : null;
    $("#agent-name").textContent = agent ? agent.name : "No agent";
    $("#wb-agent").textContent = agent ? agent.name : "No agent";
    renderAgentAvatar();
    document.title = "BIG A";
    setStatus("idle", agent ? "Home — start a new chat when you are ready" : "Add an agent to get started");
    renderSidebar();
    syncTopbarMode();
    applyEmbedCrop();
    return Promise.resolve();
  }

  /* ------------------------------------------------------------ legacy embed */

  var embedTimer = null;
  var embedUrl = "";

  /** Tear the frame down so a hidden embed cannot keep running or recording. */
  function stopEmbed() {
    if (embedTimer) { clearTimeout(embedTimer); embedTimer = null; }
    var frame = $("#agent-frame");
    if (frame && frame.src !== "about:blank") frame.src = "about:blank";
  }

  /**
   * Legacy path: the agent's own canvas in a sandboxed frame. Kept as an
   * escape hatch. We cannot style or read across the origin boundary, but we
   * can own the chrome around it, crop its header away, and notice when it
   * fails to load.
   *
   * Turn whatever URL the agent was added with into the *embeddable* canvas.
   *
   * This is the fix for the frame showing Copilot Studio's demo site — the
   * "I'm your new agent" splash with prompt cards and a floating chat box —
   * instead of the agent. Those two canvases live at almost the same address:
   * the demo site is ".../bots/{schema}/canvas" (or a webchat URL without
   * cliAgent), while the embeddable one is
   * ".../bots/{schema}/webchat?__version__=2&cliAgent=true". Anything that is
   * not a Copilot Studio address is passed through untouched.
   */
  function embedUrlFor(agent) {
    var raw = (agent && agent.url) || "";
    if (!raw) return "";
    if (!global.M365Agents || !global.M365Agents.webChatUrl) return raw;
    try {
      return global.M365Agents.webChatUrl(raw, { fileAttachment: !!state.settings.fileAttach });
    } catch (e) {
      return raw;
    }
  }

  function loadEmbed() {
    var agent = currentAgent();
    if (!agent) return showWelcome();

    var frame = $("#agent-frame");
    Chat.disconnect();
    showPane("embed");
    syncTopbarMode();
    applyEmbedCrop();

    $("#embed-loading").hidden = false;
    $("#embed-blocked").hidden = true;

    embedUrl = embedUrlFor(agent);

    if (embedUrl && embedUrl !== agent.url) {
      logEvent("Embed URL normalised", embedUrl, "info");
    }

    if (!embedUrl) {
      $("#embed-loading").hidden = true;
      $("#embed-blocked").hidden = false;
      $("#embed-blocked-msg").textContent =
        "This agent has no embed URL. Add one in its settings, or switch to the full client.";
      setStatus("err", "Legacy embed: no URL configured");
      return Promise.resolve();
    }

    frame.src = embedUrl;

    // A cross-origin frame that refuses to be embedded fires no error event,
    // so fall back to a deadline. `load` clears it if the canvas arrives.
    if (embedTimer) clearTimeout(embedTimer);
    embedTimer = setTimeout(function () {
      embedTimer = null;
      if (!$("#embed-loading").hidden) {
        $("#embed-loading").hidden = true;
        $("#embed-blocked").hidden = false;
        $("#embed-blocked-msg").textContent =
          "The agent's canvas did not load within 20 seconds. Its site may refuse " +
          "to be embedded, or the URL may be wrong. Opening it in its own tab usually works.";
        setStatus("err", "Legacy embed did not load");
        logEvent("Legacy embed timed out", agent.name, "err");
      }
    }, 20000);

    setStatus("embed", "Embedded canvas: messages are not stored locally");
    logEvent("Legacy embed loaded", agent.name, "warn");
    return Promise.resolve();
  }

  function openEmbedTab() {
    var agent = currentAgent();
    var url = embedUrl || (agent && agent.url) || "";
    if (!url) { toast("This agent has no URL to open.", "err"); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /** Current path: Direct-to-Engine over the Microsoft 365 Agents SDK. */
  function connectActiveChat() {
    if (!hasAgent()) return showWelcome();
    // Leaving the home screen by picking an agent, rather than by picking a
    // chat, arrives here with nothing selected. Start a conversation instead
    // of asking the store to load messages for a chat that does not exist.
    if (!state.activeChat) return newChat();

    var agent = currentAgent();
    var conn = effectiveConn(agent);

    Chat.setAgent(agent);
    $("#agent-name").textContent = agent.name;
    $("#wb-agent").textContent = agent.name;
    renderAgentAvatar();
    $("#chat-empty-title").textContent = "How can I help today?";
    document.title = agent.name + " · BIG A";
    syncTopbarMode();

    if (conn.mode === "iframe") return loadEmbed();

    stopEmbed();
    showPane("chat");

    if (conn.mode === "m365") return connectViaAgentsSdk(agent);
    if (conn.mode === "claude") return connectViaClaude(agent);
    if (conn.mode === "gemini") return connectViaGemini(agent);
    if (conn.mode === "openrouter") return connectViaOpenRouter(agent);

    var bearerStep = conn.mode === "sso" && global.Connect
      ? global.Connect.acquireToken(conn).then(function (res) {
          renderAccount();
          return res.accessToken;
        })
      : Promise.resolve(null);

    return bearerStep.then(function (bearer) {
      return Chat.open(state.activeChat, {
        transport: "directline",
        bearer: bearer,
        tokenEndpoint: conn.tokenEndpoint || "",
        // Load-bearing for default environments, whose URL carries the tenant
        // ID rather than the environment ID.
        envId: conn.environmentId || ""
      });
    }).catch(function (err) {
      setStatus("offline", err && err.message);
      logEvent("Connection failed", err && err.message, "err");
      // A failed legacy Direct Line connection must not be a dead end.
      // Fall back to the frame, which needs nothing but the agent URL.
      if (conn.mode === "directline") return fallBackToFrame(agent, err);
    });
  }

  /**
   * Last resort for the legacy Direct Line transport.
   *
   * The native canvas needs the agent to be published with security set to
   * "No authentication". When it is not, or the school network blocks the
   * Direct Line host, the frame usually still works, because it is the exact
   * thing Copilot Studio's own embed code does. Rather than leaving an error
   * on screen, switch this agent over and say so.
   *
   * The switch is recorded against the AGENT, not the workspace, so one
   * stubborn agent does not drag every other agent onto the frame.
   */
  function fallBackToFrame(agent, err) {
    if (!agent || !embedUrlFor(agent)) return Promise.resolve();

    agent.conn = agent.conn && typeof agent.conn === "object" ? agent.conn : {};
    if (agent.conn.mode === "iframe") return Promise.resolve();
    agent.conn.mode = "iframe";

    logEvent("Fell back to the embedded frame", (err && err.message) || "", "warn");
    toast("Could not open the BIG A canvas for " + agent.name +
          ", so it is using the embedded frame instead.", "warn");

    return savePrefs().then(function () {
      renderAgents();
      renderAgentMenu();
      syncTopbarMode();
      return loadEmbed();
    });
  }

  /**
   * Agent settings for the active agent: per-agent overrides win, otherwise
   * the global connection settings apply.
   */
  function agentSettings(agent) {
    var c = effectiveConn(agent);
    return {
      connectionString: c.connectionString,
      directConnectUrl: c.directConnectUrl,
      environmentId: c.environmentId,
      schemaName: c.schemaName,
      cloud: c.cloud,
      agentType: c.agentType,
      tenantId: c.tenantId,
      clientId: c.clientId,
      scope: c.scope
    };
  }

  function connectViaAgentsSdk(agent) {
    var settings = agentSettings(agent);

    if (!global.M365Agents || !global.M365Agents.isConfigured(settings)) {
      setStatus("offline", "Agent connection is not configured yet.");
      logEvent("Connection settings needed", "Add the Agents SDK connection string", "warn");
      Chat.showSetupNeeded(
        "This chat needs the agent's Microsoft 365 Agents SDK connection details. " +
        "Open Connection settings to paste them in."
      );
      return Promise.resolve();
    }

    setStatus("signin", "Signing in with Microsoft");

    // The Agents SDK is user-authenticated only, so a token function is
    // handed to the transport and re-invoked whenever one expires.
    var getToken = function (opts) {
      opts = opts || {};
      return global.Connect.acquireToken({
        clientId: settings.clientId,
        tenantId: settings.tenantId,
        scopes: [tokenScope(settings)],
        forceRefresh: !!opts.forceRefresh,
        silentOnly: !!opts.silentOnly
      }).then(function (res) {
        renderAccount();
        return res.accessToken;
      });
    };

    return Chat.open(state.activeChat, {
      transport: "m365",
      settings: settings,
      getToken: getToken
    }).catch(function (err) {
      setStatus("offline", err && err.message);
      logEvent("Connection failed", err && err.message, "err");
    });
  }

  function claudeSettings(agent) {
    var c = effectiveConn(agent);
    return {
      apiKey: c.claudeApiKey,
      model: c.claudeModel,
      systemPrompt: c.claudeSystemPrompt,
      maxTokens: c.claudeMaxTokens,
      temperature: c.claudeTemperature,
      baseUrl: c.claudeBaseUrl
    };
  }

  /** Claude, direct to the Anthropic API — no sign-in, just an API key. */
  function connectViaClaude(agent) {
    var settings = claudeSettings(agent);

    if (!global.AnthropicClient || !global.AnthropicClient.isConfigured(settings)) {
      setStatus("offline", "Claude connection is not configured yet.");
      logEvent("Connection settings needed", "Add the Anthropic API key", "warn");
      Chat.showSetupNeeded(
        "This chat needs a Claude API key. Open Connection settings and paste in a key from " +
        "console.anthropic.com \u203A Settings \u203A API keys."
      );
      return Promise.resolve();
    }

    setStatus("connecting");

    return Chat.open(state.activeChat, {
      transport: "claude",
      settings: settings
    }).catch(function (err) {
      setStatus("offline", err && err.message);
      logEvent("Connection failed", err && err.message, "err");
    });
  }

  function geminiSettings(agent) {
    var c = effectiveConn(agent);
    return {
      apiKey: c.geminiApiKey,
      model: c.geminiModel,
      systemPrompt: c.geminiSystemPrompt,
      maxTokens: c.geminiMaxTokens,
      temperature: c.geminiTemperature,
      baseUrl: c.geminiBaseUrl
    };
  }

  /** Gemini, direct to Google's free-tier API — no sign-in, just an API key. */
  function connectViaGemini(agent) {
    var settings = geminiSettings(agent);

    if (!global.GeminiClient || !global.GeminiClient.isConfigured(settings)) {
      setStatus("offline", "Gemini connection is not configured yet.");
      logEvent("Connection settings needed", "Add the Gemini API key", "warn");
      Chat.showSetupNeeded(
        "This chat needs a Gemini API key. Open Connection settings and paste in a free key from " +
        "aistudio.google.com \u203A Get API key."
      );
      return Promise.resolve();
    }

    setStatus("connecting");

    return Chat.open(state.activeChat, {
      transport: "gemini",
      settings: settings
    }).catch(function (err) {
      setStatus("offline", err && err.message);
      logEvent("Connection failed", err && err.message, "err");
    });
  }

  function openrouterSettings(agent) {
    var c = effectiveConn(agent);
    return {
      apiKey: c.openrouterApiKey,
      model: c.openrouterModel,
      systemPrompt: c.openrouterSystemPrompt,
      maxTokens: c.openrouterMaxTokens,
      temperature: c.openrouterTemperature,
      baseUrl: c.openrouterBaseUrl
    };
  }

  /** OpenRouter, one key across hundreds of models — no sign-in, just an API key. */
  function connectViaOpenRouter(agent) {
    var settings = openrouterSettings(agent);

    if (!global.OpenRouterClient || !global.OpenRouterClient.isConfigured(settings)) {
      setStatus("offline", "OpenRouter connection is not configured yet.");
      logEvent("Connection settings needed", "Add the OpenRouter API key", "warn");
      Chat.showSetupNeeded(
        "This chat needs an OpenRouter API key. Open Connection settings and paste in a key from " +
        "openrouter.ai \u203A Keys."
      );
      return Promise.resolve();
    }

    setStatus("connecting");

    return Chat.open(state.activeChat, {
      transport: "openrouter",
      settings: settings
    }).catch(function (err) {
      setStatus("offline", err && err.message);
      logEvent("Connection failed", err && err.message, "err");
    });
  }

  /* -------------------------------------------------------------- chats */

  function refreshChats() {
    return Store.chats.list().then(function (rows) {
      chats = rows;
      return chats;
    });
  }

  function refreshProjects() {
    return Store.projects.list().then(function (rows) {
      projects = rows;
      return projects;
    });
  }

  function newChat(projectId) {
    // Creating a chat with nothing to talk to just produces a dead end.
    if (!hasAgent()) {
      showWelcome();
      toast("Add an agent first.");
      setTimeout(openAgentModal, 200);
      return Promise.resolve();
    }
    var c = {
      id: uid(),
      title: "New chat",
      agent: state.activeAgent,
      projectId: projectId || null,
      created: Date.now(),
      updated: Date.now()
    };
    return Store.chats.put(c).then(function () {
      state.activeChat = c.id;
      savePrefs();
      return refreshChats();
    }).then(function () {
      renderSidebar();
      document.body.classList.remove("zen");
      return connectActiveChat();
    }).then(function () {
      if (hasAgent()) $("#composer-input").focus();
      logEvent("New chat started", (currentAgent() || {}).name || "no agent", "ok");
    });
  }

  function openChat(id) {
    if (state.activeChat === id) return Promise.resolve();
    state.activeChat = id;
    savePrefs();
    renderSidebar();
    return connectActiveChat();
  }

  function deleteChat(id) {
    return Store.chats.remove(id).then(refreshChats).then(function () {
      if (state.activeChat === id) {
        state.activeChat = chats.length ? chats[0].id : null;
        savePrefs();
        if (state.activeChat) return connectActiveChat();
        return newChat();
      }
      renderSidebar();
    }).then(function () {
      renderSidebar();
      toast("Chat deleted");
    });
  }

  function renameChat(id) {
    var chat = chats.filter(function (c) { return c.id === id; })[0];
    if (!chat) return;
    askPrompt("Rename chat", {
      label: "Chat name",
      value: chat.title,
      ok: "Rename"
    }).then(function (name) {
      if (name == null) return;
      chat.title = name || chat.title;
      return Store.chats.put(chat).then(refreshChats).then(renderSidebar);
    });
  }

  function moveChat(chatId, projectId) {
    var chat = chats.filter(function (c) { return c.id === chatId; })[0];
    if (!chat) return Promise.resolve();
    if ((chat.projectId || null) === (projectId || null)) return Promise.resolve();
    chat.projectId = projectId || null;
    return Store.chats.put(chat).then(refreshChats).then(function () {
      renderSidebar();
      var p = projects.filter(function (x) { return x.id === projectId; })[0];
      toast(p ? 'Moved to "' + p.name + '"' : "Moved out of the project");
      logEvent("Chat filed", chat.title + " \u2192 " + (p ? p.name : "Recents"), "ok");
    });
  }

  /* ------------------------------------------------------------- sidebar */

  function chatItemHTML(c) {
    return '<li class="chat-li"><button class="side-item' + (c.id === state.activeChat ? " active" : "") +
      '" data-chat="' + c.id + '" draggable="true">' + icon("chat") +
      '<span class="txt"></span>' +
      '<span class="row-acts">' +
      '<span class="del" data-rename="' + c.id + '" role="button" tabindex="0" aria-label="Rename chat">' + icon("pencil") + "</span>" +
      '<span class="del" data-del="' + c.id + '" role="button" tabindex="0" aria-label="Delete chat">' + icon("trash") + "</span>" +
      "</span></button></li>";
  }

  function fillTitles(host, list) {
    $$("[data-chat]", host).forEach(function (btn) {
      var c = list.filter(function (x) { return x.id === btn.dataset.chat; })[0];
      if (c) {
        $(".txt", btn).textContent = c.title || "Untitled";
        btn.title = c.title || "Untitled";
      }
    });
  }

  function searchTerm() { return ($("#side-search").value || "").toLowerCase().trim(); }

  function matches(c, q) {
    if (!q) return true;
    return (c.title || "").toLowerCase().indexOf(q) > -1 ||
           (c.preview || "").toLowerCase().indexOf(q) > -1;
  }

  function renderRecents() {
    var q = searchTerm();
    var host = $("#chat-list");
    var list = chats.filter(function (c) { return !c.projectId && matches(c, q); });

    host.innerHTML = list.length
      ? list.map(chatItemHTML).join("")
      : '<li class="side-empty">' + (q ? "No matching chats." : "No loose chats \u2014 everything is filed.") + "</li>";
    fillTitles(host, list);
  }

  function renderProjects() {
    var q = searchTerm();
    var host = $("#project-list");

    if (!projects.length) {
      host.innerHTML = '<p class="side-empty">No projects yet. Press + to make one, then drag chats into it.</p>';
      return;
    }

    host.innerHTML = projects.map(function (p) {
      var kids = chats.filter(function (c) { return c.projectId === p.id && matches(c, q); });
      var open = !p.collapsed;
      return '<section class="project" data-projid="' + p.id + '">' +
        '<div class="project-head' + (open ? " open" : "") + '" data-drop="' + p.id + '" tabindex="0" role="button"' +
        ' aria-expanded="' + open + '">' +
          '<span class="proj-chev">' + icon("chevron") + "</span>" +
          '<span class="proj-ico">' + icon(open ? "folderOpen" : "folder") + "</span>" +
          '<span class="proj-name"></span>' +
          '<span class="proj-count">' + kids.length + "</span>" +
          '<span class="row-acts">' +
            '<span class="del" data-projnew="' + p.id + '" role="button" tabindex="0" aria-label="New chat in project">' + icon("plus") + "</span>" +
            '<span class="del" data-projrename="' + p.id + '" role="button" tabindex="0" aria-label="Rename project">' + icon("pencil") + "</span>" +
            '<span class="del" data-projdel="' + p.id + '" role="button" tabindex="0" aria-label="Delete project">' + icon("trash") + "</span>" +
          "</span>" +
        "</div>" +
        '<ul class="side-list project-body"' + (open ? "" : " hidden") + ' data-project="' + p.id + '">' +
          (kids.length ? kids.map(chatItemHTML).join("")
                       : '<li class="side-empty drop-hint">Drop a chat here</li>') +
        "</ul>" +
      "</section>";
    }).join("");

    projects.forEach(function (p) {
      var sec = host.querySelector('[data-projid="' + p.id + '"]');
      if (sec) $(".proj-name", sec).textContent = p.name;
    });
    fillTitles(host, chats);
  }

  /** The agents the sidebar should list, given the two visibility settings. */
  function visibleAgents() {
    if (state.settings.showHiddenAgents) return state.agents.slice();
    return state.agents.filter(function (a) { return !a.hidden; });
  }

  function renderAgents() {
    var host = $("#agent-list");
    var group = $("#agents-group");
    var note = $("#agents-hidden-note");

    // The whole group can be switched off. Hiding the list but leaving its
    // heading and "+" button behind would look like a rendering failure.
    if (group) group.hidden = !state.settings.showAgents;
    if (!state.settings.showAgents) return;

    if (!state.agents.length) {
      host.innerHTML = '<li class="side-note">No agents yet. Use <strong>+</strong> above to add one.</li>';
      if (note) note.hidden = true;
      return;
    }

    var shown = visibleAgents();
    var buried = state.agents.length - shown.length;

    // Say so, rather than letting an agent silently vanish from the sidebar
    // with no clue about where it went or how to get it back.
    if (note) {
      note.hidden = buried === 0;
      note.textContent = buried === 0 ? "" :
        buried + (buried === 1 ? " agent is hidden." : " agents are hidden.") +
        " Turn on “Show individually hidden agents” in Settings › Appearance to see them.";
    }

    if (!shown.length) { host.innerHTML = ""; return; }

    host.innerHTML = shown.map(function (a) {
      return '<li><button class="side-item' + (a.id === state.activeAgent ? " active" : "") +
        (a.hidden ? " is-hidden-agent" : "") +
        '" data-agent="' + a.id + '"><span class="txt"></span>' +
        '<span class="row-acts">' +
        '<span class="act" data-agenticon="' + a.id + '" role="button" tabindex="0" ' +
        'aria-label="Edit this agent">' + icon("pencil") + "</span>" +
        '<span class="act' + (a.hidden ? " on" : "") + '" data-agenthide="' + a.id + '" role="button" tabindex="0" ' +
        'aria-label="' + (a.hidden ? "Show this agent in the sidebar" : "Hide this agent from the sidebar") + '">' +
        icon(a.hidden ? "eyeOff" : "eye") + "</span>" +
        '<span class="del" data-agentdel="' + a.id +
        '" role="button" tabindex="0" aria-label="Remove agent">' + icon("trash") + "</span></span>" +
        "</button></li>";
    }).join("");
    // Names and avatars are set as nodes, never interpolated into markup, so
    // an agent named with a stray angle bracket cannot break the list.
    $$("[data-agent]", host).forEach(function (btn, i) {
      var a = shown[i];
      btn.insertBefore(A.avatar(a, "sm"), btn.firstChild);
      $(".txt", btn).textContent = a.name;
      btn.title = a.name + (a.hidden ? " (hidden from the sidebar)" : "");
    });
  }

  function renderSidebar() {
    renderRecents();
    renderProjects();
    renderAgents();
  }

  /* ------------------------------------------------- drag & drop of chats */

  var dragChatId = null;

  function bindDragAndDrop() {
    var sidebar = $(".sidebar-body");

    sidebar.addEventListener("dragstart", function (e) {
      var item = e.target.closest("[data-chat]");
      if (!item) return;
      dragChatId = item.dataset.chat;
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragChatId); } catch (err) { /* IE-ish */ }
      item.classList.add("dragging");
      document.body.classList.add("dragging-chat");
    });

    sidebar.addEventListener("dragend", function (e) {
      var item = e.target.closest("[data-chat]");
      if (item) item.classList.remove("dragging");
      document.body.classList.remove("dragging-chat");
      $$(".drop-target").forEach(function (el) { el.classList.remove("drop-target"); });
      dragChatId = null;
    });

    function dropZoneFor(target) {
      // A project header, a project body, or the Recents list.
      var head = target.closest("[data-drop]");
      if (head) return { el: head, project: head.dataset.drop };
      var body = target.closest("[data-project]");
      if (body) return { el: body, project: body.dataset.project || null };
      return null;
    }

    sidebar.addEventListener("dragover", function (e) {
      if (!dragChatId) return;
      var zone = dropZoneFor(e.target);
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      $$(".drop-target").forEach(function (el) { if (el !== zone.el) el.classList.remove("drop-target"); });
      zone.el.classList.add("drop-target");
    });

    sidebar.addEventListener("dragleave", function (e) {
      var zone = dropZoneFor(e.target);
      if (zone) zone.el.classList.remove("drop-target");
    });

    sidebar.addEventListener("drop", function (e) {
      var id = dragChatId || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
      if (!id) return;
      var zone = dropZoneFor(e.target);
      if (!zone) return;
      e.preventDefault();
      zone.el.classList.remove("drop-target");
      moveChat(id, zone.project || null);
      dragChatId = null;
    });
  }

  /* ------------------------------------------------------------ projects */

  function addProject() {
    askPrompt("New project", {
      label: "Project name",
      placeholder: "e.g. Quarterly report",
      hint: "Projects group related chats in the sidebar.",
      ok: "Create"
    }).then(function (name) {
      if (name == null) return;
      var p = { id: uid(), name: name, order: projects.length, collapsed: false };
      return Store.projects.put(p).then(refreshProjects).then(function () {
        renderProjects();
        toast('Created "' + name + '"');
        logEvent("Project created", name, "ok");
      });
    });
  }

  function renameProject(id) {
    var p = projects.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    askPrompt("Rename project", {
      label: "Project name",
      value: p.name,
      ok: "Rename"
    }).then(function (name) {
      if (name == null) return;
      p.name = name || p.name;
      return Store.projects.put(p).then(refreshProjects).then(renderProjects);
    });
  }

  function deleteProject(id) {
    var p = projects.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var kids = chats.filter(function (c) { return c.projectId === id; });

    askConfirm('Delete "' + p.name + '"?', {
      body: kids.length
        ? "Its " + kids.length + " chat" + (kids.length === 1 ? "" : "s") +
          " will move back to Recents. No messages are deleted."
        : "This project is empty. Nothing else will be removed.",
      ok: "Delete project",
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      return Promise.all(kids.map(function (c) { c.projectId = null; return Store.chats.put(c); }))
        .then(function () { return Store.projects.remove(id); })
        .then(function () { return Promise.all([refreshChats(), refreshProjects()]); })
        .then(function () { renderSidebar(); toast("Project deleted"); });
    });
  }

  function toggleProject(id) {
    var p = projects.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    p.collapsed = !p.collapsed;
    Store.projects.put(p).then(refreshProjects).then(renderProjects);
  }

  /* ------------------------------------------------------------- workbench */

  function openWorkbench(tab) {
    $(".app").classList.add("workbench-open");
    if (tab) selectTab(tab);
  }
  function toggleWorkbench() { $(".app").classList.toggle("workbench-open"); }

  function selectTab(id) {
    $$(".wb-tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === id)); });
    $$(".wb-panel").forEach(function (p) { p.classList.toggle("active", p.dataset.panel === id); });
  }

  /* --------------------------------------------------------- artifact tab */

  function renderArtifact() {
    var view = $("#artifact-view");
    var src = $("#artifact-src").value;
    var type = $("#artifact-type").value;
    state.artifact.source = src;
    state.artifact.type = type;
    state.artifact.title = $("#artifact-title").value || "Untitled document";

    if (!src.trim()) {
      view.className = "artifact-view empty";
      view.textContent = "Send a reply here from the chat, or paste one, then press Render.";
      return;
    }

    view.className = "artifact-view md";
    if (type === "markdown") {
      view.innerHTML = A.markdown(src);
    } else     if (type === "html") {
      // HTML artifacts may come from an agent. Never execute that source in
      // BIG A's origin because MSAL tokens and saved chats live here.
      view.innerHTML = Artifacts.sanitizeHTML(src);
    } else if (type === "code") {
      view.innerHTML = "<pre><code>" + A.highlight(src) + "</code></pre>";
    } else if (type === "table") {
      try {
        var rows = A.parseDelimited(src).filter(function (r) { return r.join("").trim() !== ""; });
        view.innerHTML = "<table><thead><tr>" +
          rows[0].map(function (c) { return "<th>" + A.esc(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.slice(1).map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + A.esc(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table>";
      } catch (e) {
        view.className = "artifact-view empty";
        view.textContent = "Could not read that as a table.";
        return;
      }
    }
    savePrefs();
    logEvent("Artifact rendered", state.artifact.title + " · " + type, "ok");
  }

  function artifactHTML() {
    var view = $("#artifact-view");
    return view.classList.contains("empty") ? "" : view.innerHTML;
  }

  function exportArtifact(fmt) {
    var title = state.artifact.title || "document";
    var base = A.slug(title) + "-" + A.stamp();
    var src = $("#artifact-src").value;

    if (!src.trim()) { toast("Nothing to export yet.", "err"); return; }

    if (fmt === "md") {
      A.download(base + ".md", src, "text/markdown;charset=utf-8");
    } else if (fmt === "txt") {
      A.download(base + ".txt", src, "text/plain;charset=utf-8");
    } else if (fmt === "html") {
      A.download(base + ".html", A.standaloneHTML(title, artifactHTML()), "text/html;charset=utf-8");
    } else if (fmt === "json") {
      A.download(base + ".json", JSON.stringify({
        title: title, type: state.artifact.type, generated: new Date().toISOString(), content: src
      }, null, 2), "application/json");
    } else if (fmt === "csv") {
      var table = $("#artifact-view table");
      if (!table) { toast("Render a table first to export CSV.", "err"); return; }
      var csv = $$("tr", table).map(function (tr) {
        return $$("th,td", tr).map(function (c) {
          var v = c.textContent;
          return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(",");
      }).join("\n");
      A.download(base + ".csv", csv, "text/csv;charset=utf-8");
    } else if (fmt === "print") {
      printDocument(title, artifactHTML());
      logEvent("Sent to printer", title + " · save as PDF", "ok");
      return;
    }
    logEvent("File downloaded", base + "." + fmt, "ok");
    toast("Downloaded " + base + "." + fmt);
  }

  function printDocument(title, bodyHTML) {
    var w = window.open("", "_blank");
    if (!w) { toast("Allow pop-ups to print or save as PDF.", "err"); return; }
    w.document.write(A.standaloneHTML(title, bodyHTML));
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 400);
  }

  /* ------------------------------------------------------------- chart tab */

  var lastChartSVG = "";

  function buildChart() {
    var out = $("#chart-out");
    try {
      var ds = A.parseDataset($("#chart-data").value);
      lastChartSVG = A.chart({
        type: $("#chart-type").value,
        data: ds,
        title: $("#chart-title").value,
        dark: state.theme === "dark",
        width: 720,
        height: 440
      });
      out.innerHTML = lastChartSVG;
      var pts = ds.series.reduce(function (a, s) { return a + s.values.length; }, 0);
      logEvent("Chart generated", $("#chart-type").value + " · " + ds.series.length + " series · " + pts + " points", "ok");
    } catch (err) {
      lastChartSVG = "";
      out.innerHTML = '<p style="color:var(--clay);font-size:13px;margin:0">' + A.esc(err.message) + "</p>";
      logEvent("Chart failed", err.message, "warn");
    }
  }

  function exportChart(fmt) {
    if (!lastChartSVG) { toast("Generate a chart first.", "err"); return; }
    var base = A.slug($("#chart-title").value || "chart") + "-" + A.stamp();

    if (fmt === "svg") {
      A.download(base + ".svg", lastChartSVG, "image/svg+xml;charset=utf-8");
      toast("Downloaded " + base + ".svg");
    } else if (fmt === "png") {
      A.svgToPng(lastChartSVG, 2, function (err, blob) {
        if (err) { toast(err.message, "err"); return; }
        A.download(base + ".png", blob);
        toast("Downloaded " + base + ".png");
      });
    } else if (fmt === "csv") {
      try {
        A.download(base + ".csv", A.datasetToCSV(A.parseDataset($("#chart-data").value)), "text/csv;charset=utf-8");
        toast("Downloaded " + base + ".csv");
      } catch (e) { toast(e.message, "err"); }
    } else if (fmt === "html") {
      A.download(base + ".html",
        A.standaloneHTML($("#chart-title").value || "Chart",
          "<h1>" + A.esc($("#chart-title").value || "Chart") + "</h1>" + lastChartSVG),
        "text/html;charset=utf-8");
      toast("Downloaded " + base + ".html");
    }
    logEvent("File downloaded", base + "." + fmt, "ok");
  }

  /* -------------------------------------------------------------- files tab */

  var files = [];

  function fmtSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }

  function addFiles(list) {
    Array.prototype.forEach.call(list, function (f) {
      var entry = { name: f.name, size: f.size, type: f.type, text: null, file: f };
      files.push(entry);
      logEvent("File attached", f.name + " · " + fmtSize(f.size), "ok");

      var readable = /^text\/|json|csv|xml|javascript|markdown/.test(f.type) ||
                     /\.(txt|md|csv|tsv|json|log|xml|yml|yaml|js|ts|py|sql|html|css)$/i.test(f.name);
      if (readable && f.size < 2 * 1024 * 1024) {
        var r = new FileReader();
        r.onload = function () { entry.text = r.result; renderFiles(); };
        r.readAsText(f);
      }
      renderFiles();
    });
    var badge = $("#tab-files .badge");
    badge.textContent = files.length;
    badge.hidden = files.length === 0;
  }

  function renderFiles() {
    var host = $("#file-list");
    if (!files.length) { host.innerHTML = ""; $("#file-actions").hidden = true; return; }
    $("#file-actions").hidden = false;
    host.innerHTML = files.map(function (f, i) {
      var ext = (f.name.split(".").pop() || "?").slice(0, 4);
      return '<li class="file-row"><span class="file-ico">' + A.esc(ext) +
        '</span><div class="file-meta"><strong></strong><span>' + fmtSize(f.size) +
        (f.text != null ? " · text extracted" : " · binary") + '</span></div>' +
        '<button class="btn btn-ghost btn-sm" data-fsend="' + i + '">To chat</button>' +
        (f.text != null ? '<button class="btn btn-ghost btn-sm" data-fcopy="' + i + '">Copy text</button>' : "") +
        '<button class="icon-btn" data-frm="' + i + '" aria-label="Remove file">' + icon("x") + "</button></li>";
    }).join("");
    $$(".file-row", host).forEach(function (row, i) { $("strong", row).textContent = files[i].name; });
  }

  function filesAsContext() {
    var withText = files.filter(function (f) { return f.text != null; });
    if (!withText.length) return "";
    return withText.map(function (f) {
      return "--- FILE: " + f.name + " (" + fmtSize(f.size) + ") ---\n" + f.text;
    }).join("\n\n") + "\n\n--- END OF FILES ---\n\nUsing the files above, please ";
  }

  /* ------------------------------------------------------------ clipboard */

  function copyText(text, label) {
    Chat.copyToClipboard(text);
    toast((label || "Copied") + " to the clipboard");
  }

  /* --------------------------------------------------------- backup files */

  function exportWorkspace() {
    Store.exportAll().then(function (data) {
      var name = "biga-workspace-" + A.stamp() + ".json";
      A.download(name, JSON.stringify(data, null, 2), "application/json");
      toast("Backed up " + data.chats.length + " chats");
      logEvent("Workspace backed up", data.messages.length + " messages", "ok");
    });
  }

  function importWorkspace(file) {
    var r = new FileReader();
    r.onload = function () {
      var data;
      try { data = JSON.parse(r.result); }
      catch (e) { toast("That file is not valid JSON.", "err"); return; }

      var counts = summariseBackup(data);

      askConfirm("Restore this backup?", {
        body: counts +
          "\n\nReplace: everything here is deleted first, leaving exactly the backup." +
          "\nMerge: the backup is added alongside what you already have.",
        ok: "Replace everything",
        alt: "Merge",
        danger: true
      }).then(function (choice) {
        if (!choice) return;                       // cancelled
        runImport(data, choice === "alt" ? false : true);
      });
    };
    r.onerror = function () { toast("Could not read that file.", "err"); };
    r.readAsText(file);
  }

  /** Describe what is inside a backup so the choice is an informed one. */
  function summariseBackup(data) {
    function n(v) { return Array.isArray(v) ? v.length : 0; }
    var bits = [
      n(data && data.chats) + " chats",
      n(data && data.messages) + " messages",
      n(data && data.projects) + " projects"
    ];
    return "The file contains " + bits.join(", ") + ".";
  }

  function runImport(data, replace) {
    return Store.importAll(data, { replace: replace })
      .then(function (r2) {
        return Promise.all([refreshChats(), refreshProjects(), loadPrefs()]).then(function () { return r2; });
      })
      .then(function (r2) {
        renderSidebar();
        renderAgents();
        renderAgentMenu();
        toast("Restored " + r2.chats + " chats");
        logEvent("Workspace restored", r2.messages + " messages", "ok");
        if (chats.length && hasAgent()) {
          state.activeChat = chats[0].id;
          savePrefs();
          return connectActiveChat();
        }
        return showWelcome();
      })
      .catch(function (err) { toast(err.message, "err"); });
  }

  /* ------------------------------------------------------- command palette */

  var COMMANDS = [
    { id: "new", label: "New chat", grp: "Chat", icon: "plus", run: function () { newChat(); } },
    { id: "reload", label: "Reconnect to the agent", grp: "Chat", icon: "refresh", run: function () { connectActiveChat(); toast("Reconnecting"); } },
    { id: "copychat", label: "Copy the whole conversation", grp: "Chat", icon: "copy", run: function () { copyText(Chat.transcript(), "Transcript"); } },
    { id: "conncheck", label: "Test the agent connection", grp: "Chat", icon: "plug", run: function () { openConnectModal(); setTimeout(testConnection, 120); } },
    { id: "project", label: "New project", grp: "Chat", icon: "folder", run: addProject },
    { id: "zen", label: "Toggle focus mode", grp: "View", icon: "expand", run: toggleZen },
    { id: "wb", label: "Toggle workbench", grp: "View", icon: "panel", run: toggleWorkbench },
    { id: "theme", label: "Toggle light / dark theme", grp: "View", icon: "moon", run: function () { applyTheme(state.theme === "dark" ? "light" : "dark"); } },
    { id: "sidebar", label: "Toggle sidebar", grp: "View", icon: "menu", run: toggleSidebar },
    { id: "slimbar", label: "Shrink / expand the top bar", grp: "View", icon: "collapseBar", run: toggleTopbarSlim },
    { id: "appearance", label: "Appearance, theme & colourway", grp: "View", icon: "palette", run: openAppearance },
    { id: "home", label: "Go to the home screen", grp: "View", icon: "sparkle", run: goHome },
    { id: "art", label: "Open artifact studio", grp: "Workbench", icon: "doc", run: function () { openWorkbench("artifact"); } },
    { id: "chart", label: "Open chart builder", grp: "Workbench", icon: "chart", run: function () { openWorkbench("chart"); } },
    { id: "files", label: "Open file attachments", grp: "Workbench", icon: "paperclip", run: function () { openWorkbench("files"); } },
    { id: "activity", label: "Open activity log", grp: "Workbench", icon: "activity", run: function () { openWorkbench("activity"); } },
    { id: "addagent", label: "Add an agent", grp: "Agents", icon: "bot", run: openAgentModal },
    { id: "connect", label: "Connection & sign-in", grp: "App", icon: "lock", run: openConnectModal },
    { id: "settings", label: "Open settings", grp: "App", icon: "settings", run: function () { openModal("#settings-modal"); } },
    { id: "backup", label: "Back up the workspace", grp: "App", icon: "download", run: exportWorkspace },
    { id: "exportmd", label: "Download artifact as Markdown", grp: "Export", icon: "download", run: function () { exportArtifact("md"); } },
    { id: "exporthtml", label: "Download artifact as HTML", grp: "Export", icon: "download", run: function () { exportArtifact("html"); } },
    { id: "exportpdf", label: "Print artifact / save as PDF", grp: "Export", icon: "print", run: function () { exportArtifact("print"); } },
    { id: "exportpng", label: "Download chart as PNG", grp: "Export", icon: "download", run: function () { exportChart("png"); } }
  ];

  var paletteIdx = 0, paletteList = [];

  function openPalette() {
    openModal("#palette");
    var input = $("#palette-input");
    input.value = "";
    filterPalette("");
    setTimeout(function () { input.focus(); }, 40);
  }

  function filterPalette(q) {
    q = (q || "").toLowerCase();
    paletteList = COMMANDS.filter(function (c) {
      return !q || (c.label + " " + c.grp).toLowerCase().indexOf(q) > -1;
    });
    paletteIdx = 0;
    var host = $("#palette-list");
    if (!paletteList.length) { host.innerHTML = '<li class="side-empty">No matching commands.</li>'; return; }
    host.innerHTML = paletteList.map(function (c, i) {
      return '<li class="palette-item" role="option" data-cmd="' + c.id + '" aria-selected="' + (i === 0) + '">' +
        icon(c.icon) + "<span></span><span class='grp'>" + A.esc(c.grp) + "</span></li>";
    }).join("");
    $$("[data-cmd]", host).forEach(function (li, i) { $("span", li).textContent = paletteList[i].label; });
  }

  function movePalette(d) {
    var items = $$("#palette-list .palette-item");
    if (!items.length) return;
    paletteIdx = (paletteIdx + d + items.length) % items.length;
    items.forEach(function (it, i) { it.setAttribute("aria-selected", String(i === paletteIdx)); });
    items[paletteIdx].scrollIntoView({ block: "nearest" });
  }

  function runPalette() {
    var cmd = paletteList[paletteIdx];
    if (!cmd) return;
    closeModals();
    setTimeout(cmd.run, 60);
  }

  /* ---------------------------------------------------------------- modals */

  function openModal(sel) {
    closeModals();
    $("#scrim").classList.add("open");
    $(sel).classList.add("open");
  }
  function closeModals() {
    // Any dialog awaiting an answer counts as dismissed when the scrim, the
    // close button or Escape takes the modal layer down.
    settleAsk(null);
    $("#scrim").classList.remove("open");
    $$(".modal").forEach(function (m) { m.classList.remove("open"); });
    $$(".menu").forEach(function (m) { m.classList.remove("open"); });
  }

  /* ------------------------------------------------- ask / confirm dialogs */
  /* Replaces window.prompt and window.confirm. Native dialogs cannot be
     themed, are suppressed in some embedded contexts, and block the event
     loop. These return a Promise instead: a string (or true) when accepted,
     null (or false) when dismissed. */

  var askPending = null;      // { resolve, kind }
  var askReturnFocus = null;
  var askRequired = true;     // prompt only: reject an empty value

  function settleAsk(value) {
    if (!askPending) return;
    var p = askPending;
    askPending = null;
    // Confirm resolves false rather than null so callers can use it directly.
    p.resolve(value === null && p.kind === "confirm" ? false : value);
    if (askReturnFocus && document.contains(askReturnFocus)) {
      try { askReturnFocus.focus(); } catch (e) { /* element went away */ }
    }
    askReturnFocus = null;
  }

  /**
   * Open the shared dialog.
   * @param {Object} o
   *   kind      "prompt" | "confirm"
   *   title     heading
   *   body      explanatory text (optional)
   *   label     field label, prompt only
   *   value     initial field value, prompt only
   *   hint      help text under the field, optional
   *   ok        confirm button label
   *   danger    style the confirm button as destructive
   *   required  reject an empty value, prompt only (default true)
   * @returns {Promise<string|null|boolean>}
   */
  function askDialog(o) {
    settleAsk(null);
    o = o || {};
    var kind = o.kind === "prompt" ? "prompt" : "confirm";
    var isPrompt = kind === "prompt";
    askRequired = o.required !== false;

    var body = $("#ask-body");
    var field = $("#ask-field");
    var input = $("#ask-input");
    var hint = $("#ask-hint");
    var err = $("#ask-error");
    var ok = $("#ask-ok");

    $("#ask-title").textContent = o.title || (isPrompt ? "Enter a value" : "Are you sure?");

    body.textContent = o.body || "";
    body.hidden = !o.body;

    field.hidden = !isPrompt;
    hint.textContent = o.hint || "";
    hint.hidden = !o.hint;
    err.hidden = true;
    err.textContent = "";

    if (isPrompt) {
      $("#ask-label").textContent = o.label || "Name";
      input.value = o.value == null ? "" : String(o.value);
      input.placeholder = o.placeholder || "";
    }

    ok.textContent = o.ok || (isPrompt ? "Save" : "Confirm");
    ok.classList.toggle("btn-danger", !!o.danger);
    ok.classList.toggle("btn-primary", !o.danger);

    // Optional third choice, for questions that are not really yes/no.
    var alt = $("#ask-alt");
    alt.hidden = !o.alt;
    alt.textContent = o.alt || "";

    $("#ask-cancel").textContent = o.cancel || "Cancel";

    askReturnFocus = document.activeElement;
    openModal("#ask-modal");
    setTimeout(function () { (isPrompt ? input : ok).focus(); if (isPrompt) input.select(); }, 40);

    return new Promise(function (resolve) {
      askPending = { resolve: resolve, kind: kind };
    });
  }

  function askPrompt(title, o) {
    o = o || {};
    o.kind = "prompt";
    o.title = title;
    return askDialog(o);
  }

  function askConfirm(title, o) {
    o = o || {};
    o.kind = "confirm";
    o.title = title;
    return askDialog(o);
  }

  /** Accept the dialog. Validates the field for prompts. */
  function acceptAsk() {
    if (!askPending) return;
    if (askPending.kind === "confirm") { finishAsk(true); return; }

    var input = $("#ask-input");
    var value = input.value.trim();
    if (askRequired && !value) {
      var err = $("#ask-error");
      err.textContent = "Please enter a value.";
      err.hidden = false;
      input.focus();
      return;
    }
    finishAsk(value);
  }

  /** Close the dialog layer and settle with a real answer. */
  function finishAsk(value) {
    var p = askPending;
    askPending = null;
    $("#scrim").classList.remove("open");
    $("#ask-modal").classList.remove("open");
    if (p) p.resolve(value);
    if (askReturnFocus && document.contains(askReturnFocus)) {
      try { askReturnFocus.focus(); } catch (e) { /* element went away */ }
    }
    askReturnFocus = null;
  }

  /* ------------------------------------------------- add / edit an agent */

  /* The agent being edited, or null when the modal is adding a new one. */
  var agentEditing = null;
  /* The icon staged by the file picker, as a data URL, before Save is pressed.
     Held separately so cancelling the modal cannot alter a stored agent. */
  var agentIconDraft = null;

  function agentById(id) {
    for (var i = 0; i < state.agents.length; i++) {
      if (state.agents[i].id === id) return state.agents[i];
    }
    return null;
  }

  /**
   * `id` is optional. This function is also wired directly as a click handler
   * and as a command-palette action, both of which call it with an Event or
   * with nothing, so anything that is not a string is treated as "add new".
   */
  function openAgentModal(id) {
    var a = typeof id === "string" ? agentById(id) : null;
    agentEditing = a ? a.id : null;
    agentIconDraft = a && typeof a.icon === "string" ? a.icon : null;

    $("#agent-form-name").value = a ? a.name : "";
    $("#agent-form-url").value = a ? a.url : "";
    $("#agent-form-desc").value = a && a.desc ? a.desc : "";
    var modeSel = $("#agent-form-mode");
    if (modeSel) modeSel.value = a && a.conn && a.conn.mode ? a.conn.mode : "";

    $("#agent-modal-title").textContent = a ? "Edit agent" : "Add an agent";
    $("#agent-save").textContent = a ? "Save changes" : "Add agent";

    syncAgentFormMode();
    renderIconDraft();
    openModal("#agent-modal");
    setTimeout(function () { $("#agent-form-name").focus(); }, 40);
  }

  /** Claude agents have no Copilot Studio URL, so hide that field for them. */
  function syncAgentFormMode() {
    var sel = $("#agent-form-mode");
    var mode = sel ? sel.value : "";
    var isClaude = mode === "claude";
    var isGemini = mode === "gemini";
    var isOpenRouter = mode === "openrouter";
    var urlField = $("#agent-form-url-field");
    var claudeNote = $("#agent-form-claude-note");
    var geminiNote = $("#agent-form-gemini-note");
    var openrouterNote = $("#agent-form-openrouter-note");
    // None of Claude, Gemini or OpenRouter has a Copilot Studio address to paste.
    if (urlField) urlField.hidden = isClaude || isGemini || isOpenRouter;
    if (claudeNote) claudeNote.hidden = !isClaude;
    if (geminiNote) geminiNote.hidden = !isGemini;
    if (openrouterNote) openrouterNote.hidden = !isOpenRouter;
  }

  /** Show the staged icon, or the initials that would be used instead. */
  function renderIconDraft() {
    var host = $("#agent-form-icon-preview");
    if (!host) return;
    host.textContent = "";
    // A throwaway agent-shaped object, so the preview goes through exactly the
    // same avatar renderer (and the same URL filter) as the real thing.
    host.appendChild(A.avatar({
      name: $("#agent-form-name").value.trim() || "New agent",
      icon: agentIconDraft || ""
    }, "lg"));
    var clear = $("#agent-form-icon-clear");
    if (clear) clear.hidden = !agentIconDraft;
  }

  /**
   * Turn a chosen file into a square PNG data URL.
   *
   * Re-encoding through a canvas is not merely a resize. It means the bytes
   * that get stored are produced by this page, not supplied by the file: any
   * metadata, trailing payload or malformed structure in the original is
   * discarded, and what remains is a plain bitmap. SVG is refused outright,
   * because an SVG is a document that can carry script, which is also why the
   * shared URL filter rejects data:image/svg+xml.
   */
  function readAgentIcon(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type || "")) {
      toast("Choose a PNG, JPEG, GIF, WebP or AVIF image.", "err");
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      toast("That image is larger than 6 MB. Choose a smaller one.", "err");
      return;
    }

    var objUrl = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) throw new Error("empty image");
        // Centre crop to a square first, so a wide banner does not arrive
        // squashed into the avatar.
        var side = Math.min(w, h);
        var sx = Math.round((w - side) / 2);
        var sy = Math.round((h - side) / 2);

        var c = document.createElement("canvas");
        c.width = ICON_PX;
        c.height = ICON_PX;
        var g = c.getContext("2d");
        g.imageSmoothingQuality = "high";
        g.drawImage(img, sx, sy, side, side, 0, 0, ICON_PX, ICON_PX);

        var url = c.toDataURL("image/png");
        // Belt and braces: the avatar renderer will only accept a data URL in
        // one of a few image types, so check here rather than storing
        // something that would silently fail to render later.
        if (url.indexOf("data:image/png;base64,") !== 0) throw new Error("encode failed");
        agentIconDraft = url;
      } catch (e) {
        toast("That image could not be prepared. Try a different file.", "err");
      }
      URL.revokeObjectURL(objUrl);
      renderIconDraft();
    };
    img.onerror = function () {
      URL.revokeObjectURL(objUrl);
      toast("This browser could not read that image.", "err");
    };
    img.src = objUrl;
  }

  /* --------------------------------------------------- connection & sign-in */

  var MODE_HINTS = {
    directline: "Legacy option for older anonymous agents. It keeps the full BIG A canvas, but it only " +
                "works when Copilot Studio shows a Token Endpoint for the agent. If there is no Token " +
                "Endpoint, use the Microsoft 365 Agents SDK mode instead.",
    iframe: "Loads Copilot Studio's own chat canvas inside a frame. Nothing to register, but the frame " +
            "belongs to Microsoft's site, so its appearance cannot be changed, its messages cannot be " +
            "copied or saved here, and files cannot be dropped into it.",
    m365: "Recommended and the default. Uses the Microsoft 365 Agents SDK Direct-to-Engine protocol and " +
          "the full BIG A canvas. It requires an Entra ID single-page application, delegated " +
          "CopilotStudio.Copilots.Invoke permission, admin consent, and user sign-in.",
    sso: "Legacy Direct Line with single sign-on. Use it only for an older agent whose Channels page " +
         "still exposes a Token Endpoint.",
    claude: "Talks directly to the Anthropic API from this browser, on the same native BIG A canvas as " +
            "the Agents SDK mode \u2014 saved history, copy buttons, file drops. Needs an Anthropic API " +
            "key, which is stored only in this browser and sent only to api.anthropic.com.",
    gemini: "Talks directly to Google's Gemini API from this browser, on the same native canvas \u2014 " +
            "saved history, copy buttons, file drops. Needs a Gemini API key, free to create with no " +
            "credit card, stored only in this browser and sent only to generativelanguage.googleapis.com.",
    openrouter: "Talks directly to OpenRouter's unified API from this browser, on the same native canvas " +
                "\u2014 saved history, copy buttons, file drops. One key reaches hundreds of models across " +
                "every major provider, including a rotating catalog of free ones. Stored only in this " +
                "browser and sent only to openrouter.ai."
  };

  /** The agent the connection modal is currently editing, or null for global. */
  var connEditing = null;

  function syncConnFields() {
    var mode = $("#conn-mode").value;
    $("#conn-mode-hint").textContent = MODE_HINTS[mode] || "";

    var needsSdk = mode === "m365";
    var needsLegacy = mode === "directline" || mode === "sso";
    var needsSignIn = mode === "m365" || mode === "sso";
    var needsClaude = mode === "claude";
    var needsGemini = mode === "gemini";
    var needsOpenRouter = mode === "openrouter";

    // The wrapper is only empty for modes with no fields at all, which no
    // longer happens: the embed mode has its own panel now.
    $("#conn-fields").hidden = false;
    $("#conn-m365-fields").hidden = !needsSdk;
    $("#conn-legacy-fields").hidden = !needsLegacy;
    $("#conn-signin-fields").hidden = !needsSignIn;
    $("#conn-iframe-fields").hidden = mode !== "iframe";
    var claudeFields = $("#conn-claude-fields");
    if (claudeFields) claudeFields.hidden = !needsClaude;
    var claudeAdv = $("#conn-claude-advanced");
    if (claudeAdv) claudeAdv.hidden = !needsClaude;
    if (needsClaude) syncClaudeModelField();
    var geminiFields = $("#conn-gemini-fields");
    if (geminiFields) geminiFields.hidden = !needsGemini;
    var geminiAdv = $("#conn-gemini-advanced");
    if (geminiAdv) geminiAdv.hidden = !needsGemini;
    if (needsGemini) syncGeminiModelField();
    var openrouterFields = $("#conn-openrouter-fields");
    if (openrouterFields) openrouterFields.hidden = !needsOpenRouter;
    var openrouterAdv = $("#conn-openrouter-advanced");
    if (openrouterAdv) openrouterAdv.hidden = !needsOpenRouter;
    if (needsOpenRouter) syncOpenRouterModelField();

    // Only nag for the environment ID when it is actually unobtainable from
    // the URL, which is exactly the default-environment case.
    var envCallout = $("#conn-legacy-envid");
    if (envCallout) {
      var a = currentAgent();
      var dl = global.DirectLine;
      var isDefaultEnv = !!(a && a.url && dl && dl.isDefaultAlias &&
        dl.isDefaultAlias(dl.environmentSegment(a.url)));
      envCallout.hidden = !needsLegacy || !isDefaultEnv;

      var warn = $("#conn-legacy-env-warn");
      if (warn) {
        var problem = describeEnvIdProblem($("#conn-legacy-env-id").value);
        warn.textContent = problem;
        warn.hidden = !problem;
        warn.className = problem ? "hint err" : "hint";
      }
    }
    // Advanced settings only mean anything to the two direct transports.
    // Claude, Gemini and OpenRouter each have their own "Optional settings"
    // block instead (#conn-claude-advanced / #conn-gemini-advanced /
    // #conn-openrouter-advanced above).
    var adv = $("#conn-advanced");
    if (adv) adv.hidden = mode === "iframe" || needsClaude || needsGemini || needsOpenRouter;

    // Number the visible steps, so "Step 2" is always the second thing seen.
    var signInNo = $("#conn-signin-no");
    if (signInNo) signInNo.textContent = needsSdk ? "2" : "1";
    var signInSub = $("#conn-signin-sub");
    if (signInSub) {
      signInSub.textContent = needsSdk
        ? "Required. This protocol has no anonymous mode, so every request is sent as a signed-in user."
        : "Required for single sign-on: BIG A signs you in and answers the agent's sign-in card for you.";
    }

    var clientHint = $("#conn-client-hint");
    if (clientHint) {
      clientHint.textContent = needsSdk
        ? "Required. A single-page-application registration with the delegated Power Platform API " +
          "permission CopilotStudio.Copilots.Invoke, granted admin consent."
        : "Required for single sign-on only.";
    }

    var resolved = $("#conn-resolved");
    if (resolved) resolved.textContent = describeTarget();

    syncConnTargetHint();
    syncConnEmbedPreview();
  }

  /** Say plainly which agents the settings about to be saved will apply to. */
  function syncConnTargetHint() {
    var sel = $("#conn-target");
    var hint = $("#conn-target-hint");
    if (!sel || !hint) return;
    if (sel.value === "agent") {
      var name = connEditing ? connEditing.name : "this agent";
      hint.textContent = "Saved against " + name + " only. Other agents keep their own settings, so " +
        "you can run one agent on the Agents SDK and another on the embedded canvas.";
    } else {
      hint.textContent = "Saved as the workspace default, used by every agent that has no settings " +
        "of its own.";
    }
  }

  /** Show the exact frame URL the embed mode will load for this agent. */
  function syncConnEmbedPreview() {
    var out = $("#conn-embed-url");
    if (!out) return;
    var agent = connEditing || currentAgent();
    if (!agent) { out.textContent = "Add an agent first."; return; }
    var url = embedUrlFor(agent);
    out.textContent = url || "This agent has no URL yet.";
  }

  /** Show the endpoint the current settings resolve to: fast way to spot a typo. */
  function describeTarget() {
    if (!global.M365Agents) return "";
    try {
      var s = readConnForm();
      if (!global.M365Agents.isConfigured(s)) return "Not configured yet.";
      return "Resolves to " + global.M365Agents.baseUrl(s);
    } catch (e) {
      return e.message;
    }
  }

  var GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DEFAULT_ENV_RE = /^Default-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var GUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

  /** Read the tenant ID embedded in a default-environment route. */
  function tenantIdFromAgent() {
    var a = currentAgent();
    var dl = global.DirectLine;
    if (!a || !a.url || !dl || !dl.environmentSegment) return "";
    var seg = dl.environmentSegment(a.url);
    return dl.isDefaultAlias(seg) ? seg.replace(/^Default-/i, "").toLowerCase() : "";
  }

  /**
   * Pull a usable environment identifier out of whatever was pasted.
   *
   * Standard environments use a GUID. The tenant's default environment uses
   * the official "Default-{tenantId}" identifier; the entire value, including
   * "Default-", is required when deriving its environment API hostname.
   */
  function extractEnvId(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (GUID_RE.test(s) || DEFAULT_ENV_RE.test(s)) return s.toLowerCase();

    // A connection string carries it in a named field, so prefer that reading.
    if (global.M365Agents && global.M365Agents.parseConnection) {
      try {
        var parsed = global.M365Agents.parseConnection(s);
        if (parsed && (GUID_RE.test(parsed.environmentId || "") ||
            DEFAULT_ENV_RE.test(parsed.environmentId || ""))) {
          return parsed.environmentId.toLowerCase();
        }
      } catch (e) { /* fall through to the scan below */ }
    }

    // A token endpoint URL hides it as an undotted 32-char hex host label.
    var host = s.match(/([0-9a-f]{30})\.([0-9a-f]{2})\.environment\.api/i);
    if (host) {
      var hex = (host[1] + host[2]).toLowerCase();
      return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    }

    // Last resort: any GUID in the text that is not the tenant ID.
    var tenant = tenantIdFromAgent();
    var found = s.match(GUID_ANYWHERE) || [];
    for (var i = 0; i < found.length; i++) {
      if (found[i].toLowerCase() !== tenant) return found[i].toLowerCase();
    }
    return "";
  }

  /**
   * Returns a plain-English complaint about an environment ID, or "" if it
   * looks usable.
   *
   * Accept both standard GUID identifiers and Microsoft's official
   * Default-{tenantId} identifier for the tenant's default environment.
   */
  function describeEnvIdProblem(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";

    var id = extractEnvId(s);
    var tenant = tenantIdFromAgent();

    if (!id) {
      return "No environment ID found in that. Paste Environment ID from Power Apps \u203A " +
        "Settings \u203A Developer resources, or paste the whole Agents SDK connection string.";
    }

    if (tenant && id === tenant) {
      return "That is the bare tenant ID. For the default environment, paste the complete " +
        "Environment ID shown by Developer resources, including the \u201CDefault-\u201D prefix.";
    }

    return "";
  }

  function readConnForm() {
    return {
      connectionString: $("#conn-string").value.trim(),
      directConnectUrl: $("#conn-direct-url").value.trim(),
      // Two boxes, one setting. The SDK step and the native step both need the
      // environment ID, and nobody should have to type it twice. Both are run
      // through extractEnvId so a pasted connection string or endpoint URL
      // works as well as a bare GUID.
      environmentId: extractEnvId($("#conn-env-id").value) ||
        extractEnvId($("#conn-legacy-env-id").value) ||
        $("#conn-env-id").value.trim(),
      schemaName: $("#conn-schema").value.trim(),
      cloud: $("#conn-cloud").value,
      agentType: $("#conn-agent-type").value,
      clientId: $("#conn-client-id").value.trim(),
      tenantId: $("#conn-tenant-id").value.trim(),
      scope: $("#conn-scope").value.trim(),
      claudeApiKey: $("#conn-claude-key").value.trim(),
      claudeModel: readClaudeModel(),
      claudeSystemPrompt: $("#conn-claude-system").value.trim(),
      claudeMaxTokens: $("#conn-claude-max-tokens").value.trim(),
      claudeTemperature: $("#conn-claude-temperature").value.trim(),
      claudeBaseUrl: $("#conn-claude-base-url").value.trim(),
      geminiApiKey: $("#conn-gemini-key").value.trim(),
      geminiModel: readGeminiModel(),
      geminiSystemPrompt: $("#conn-gemini-system").value.trim(),
      geminiMaxTokens: $("#conn-gemini-max-tokens").value.trim(),
      geminiTemperature: $("#conn-gemini-temperature").value.trim(),
      geminiBaseUrl: $("#conn-gemini-base-url").value.trim(),
      openrouterApiKey: $("#conn-openrouter-key").value.trim(),
      openrouterModel: readOpenRouterModel(),
      openrouterSystemPrompt: $("#conn-openrouter-system").value.trim(),
      openrouterMaxTokens: $("#conn-openrouter-max-tokens").value.trim(),
      openrouterTemperature: $("#conn-openrouter-temperature").value.trim(),
      openrouterBaseUrl: $("#conn-openrouter-base-url").value.trim()
    };
  }

  /** The model select doubles as a "Custom model ID…" escape hatch. */
  function readClaudeModel() {
    var sel = $("#conn-claude-model");
    if (!sel) return "";
    if (sel.value === "__custom") {
      var custom = $("#conn-claude-model-custom");
      return custom ? custom.value.trim() : "";
    }
    return sel.value;
  }

  /** Show the free-text model box only when "Custom model ID…" is picked. */
  function syncClaudeModelField() {
    var sel = $("#conn-claude-model");
    var custom = $("#conn-claude-model-custom");
    if (!sel || !custom) return;
    custom.hidden = sel.value !== "__custom";
  }

  /** Reverse of readClaudeModel(): put a stored model id back into the form. */
  function setClaudeModelSelect(value) {
    var sel = $("#conn-claude-model");
    var custom = $("#conn-claude-model-custom");
    if (!sel) return;
    if (!value) {
      sel.selectedIndex = 0;
      if (custom) custom.value = "";
    } else if ($$("option", sel).some(function (o) { return o.value === value; })) {
      sel.value = value;
      if (custom) custom.value = "";
    } else {
      sel.value = "__custom";
      if (custom) custom.value = value;
    }
    syncClaudeModelField();
  }

  /** Same idea as readClaudeModel(), for the Gemini model select. */
  function readGeminiModel() {
    var sel = $("#conn-gemini-model");
    if (!sel) return "";
    if (sel.value === "__custom") {
      var custom = $("#conn-gemini-model-custom");
      return custom ? custom.value.trim() : "";
    }
    return sel.value;
  }

  /** Show the free-text model box only when "Custom model ID…" is picked. */
  function syncGeminiModelField() {
    var sel = $("#conn-gemini-model");
    var custom = $("#conn-gemini-model-custom");
    if (!sel || !custom) return;
    custom.hidden = sel.value !== "__custom";
  }

  /** Reverse of readGeminiModel(): put a stored model id back into the form. */
  function setGeminiModelSelect(value) {
    var sel = $("#conn-gemini-model");
    var custom = $("#conn-gemini-model-custom");
    if (!sel) return;
    if (!value) {
      sel.selectedIndex = 0;
      if (custom) custom.value = "";
    } else if ($$("option", sel).some(function (o) { return o.value === value; })) {
      sel.value = value;
      if (custom) custom.value = "";
    } else {
      sel.value = "__custom";
      if (custom) custom.value = value;
    }
    syncGeminiModelField();
  }

  /** Same idea as readClaudeModel(), for the OpenRouter model select. */
  function readOpenRouterModel() {
    var sel = $("#conn-openrouter-model");
    if (!sel) return "";
    if (sel.value === "__custom") {
      var custom = $("#conn-openrouter-model-custom");
      return custom ? custom.value.trim() : "";
    }
    return sel.value;
  }

  /** Show the free-text model box only when "Custom model ID…" is picked. */
  function syncOpenRouterModelField() {
    var sel = $("#conn-openrouter-model");
    var custom = $("#conn-openrouter-model-custom");
    if (!sel || !custom) return;
    custom.hidden = sel.value !== "__custom";
  }

  /** Reverse of readOpenRouterModel(): put a stored model id back into the form. */
  function setOpenRouterModelSelect(value) {
    var sel = $("#conn-openrouter-model");
    var custom = $("#conn-openrouter-model-custom");
    if (!sel) return;
    if (!value) {
      sel.selectedIndex = 0;
      if (custom) custom.value = "";
    } else if ($$("option", sel).some(function (o) { return o.value === value; })) {
      sel.value = value;
      if (custom) custom.value = "";
    } else {
      sel.value = "__custom";
      if (custom) custom.value = value;
    }
    syncOpenRouterModelField();
  }

  /**
   * OpenRouter's free-model roster rotates too often to hardcode, so the
   * select starts with only "Custom model ID…" and this fills it in from
   * OpenRouter's own live catalog. Only $0-priced models are listed — the
   * custom field remains the way to reach a paid one.
   */
  function populateOpenRouterModelSelect(models) {
    var sel = $("#conn-openrouter-model");
    if (!sel) return;
    var current = readOpenRouterModel();
    var free = models.filter(function (m) { return m.free; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    while (sel.firstChild) sel.removeChild(sel.firstChild);

    if (free.length) {
      var grp = document.createElement("optgroup");
      grp.label = "Free (" + free.length + ")";
      free.forEach(function (m) {
        var opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name + " \u2014 " + m.id;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    }
    var customOpt = document.createElement("option");
    customOpt.value = "__custom";
    customOpt.textContent = "Custom model ID\u2026";
    sel.appendChild(customOpt);

    setOpenRouterModelSelect(current || (free[0] && free[0].id) || "");
  }

  /** Fetches OpenRouter's live catalog and fills the model select from it. */
  function loadOpenRouterModels() {
    var btn = $("#conn-openrouter-load-models");
    if (!btn || !global.OpenRouterClient) return;
    var form = readConnForm();
    var settings = { apiKey: form.openrouterApiKey, baseUrl: form.openrouterBaseUrl };

    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Loading\u2026";

    global.OpenRouterClient.fetchModels(settings).then(function (models) {
      populateOpenRouterModelSelect(models);
      var freeCount = models.filter(function (m) { return m.free; }).length;
      toast(freeCount ? ("Loaded " + freeCount + " free models") : "No free models found right now");
    }).catch(function (err) {
      toast(err.message, "err");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = was;
    });
  }

  /**
   * Copilot Studio hands out one connection string; pasting it should fill in
   * everything it contains rather than making anyone pick it apart by hand.
   */
  function applyConnectionString() {
    var out = $("#conn-string-read");
    var raw = $("#conn-string").value.trim();
    function say(msg, kind) {
      if (!out) return;
      out.textContent = msg;
      out.className = "hint" + (kind ? " " + kind : "");
    }

    if (!raw || !global.M365Agents) {
      say("Paste something first.", "err");
      return;
    }
    var p;
    try {
      p = global.M365Agents.parseConnection(raw);
    } catch (e) {
      say(e.message, "err");
      toast(e.message, "err");
      return;
    }

    // Report field by field, because a half-recognised paste is the single
    // most common reason this page fails to connect.
    var read = [];
    function take(key, id, label) {
      if (!p[key]) return;
      var node = $(id);
      if (node) node.value = p[key];
      read.push(label);
    }
    take("environmentId", "#conn-env-id", "environment ID");
    take("schemaName", "#conn-schema", "agent schema name");
    take("directConnectUrl", "#conn-direct-url", "direct URL");
    take("tenantId", "#conn-tenant-id", "tenant ID");
    take("clientId", "#conn-client-id", "client ID");
    take("cloud", "#conn-cloud", "cloud");
    take("agentType", "#conn-agent-type", "agent type");

    if (read.length) {
      say("Read " + read.join(", ") + ".", "ok");
      toast("Read " + read.length + " value" + (read.length === 1 ? "" : "s") + ".", "ok");
    } else {
      say("Nothing recognisable in there. Paste the connection string, the agent's URL, or the " +
          "Environment ID and Schema name from Settings, Advanced, Metadata.", "err");
    }
    syncConnFields();
  }

  function renderAccount() {
    var box = $("#conn-account");
    var acct = global.Connect && global.Connect.currentAccount ? global.Connect.currentAccount() : null;
    if (!acct) { box.hidden = true; return; }
    box.hidden = false;
    $("#conn-account-name").textContent = acct.name || "Signed in";
    $("#conn-account-mail").textContent = acct.username || "";
  }

  function openConnectModal(opts) {
    opts = opts || {};
    var agent = opts.agent || currentAgent();

    // Default to editing whichever scope already holds settings: if this agent
    // has its own, that is almost certainly what needs changing.
    connEditing = agent || null;
    var scope = opts.scope || (agentHasOverride(agent) ? "agent" : "global");
    if (!agent) scope = "global";

    var sel = $("#conn-target");
    if (sel) {
      var agentOpt = sel.querySelector('option[value="agent"]');
      if (agentOpt) {
        agentOpt.disabled = !agent;
        agentOpt.textContent = agent ? "This agent only (" + agent.name + ")" : "This agent only";
      }
      sel.value = scope;
    }

    var c = scope === "agent" && agent ? effectiveConn(agent) : state.connection;
    var read = $("#conn-string-read");
    if (read) { read.textContent = ""; read.className = "hint"; }
    var diag = $("#conn-diag");
    if (diag) { diag.hidden = true; diag.textContent = ""; }
    $("#conn-mode").value = c.mode;
    $("#conn-string").value = c.connectionString || "";
    $("#conn-direct-url").value = c.directConnectUrl || "";
    $("#conn-env-id").value = c.environmentId || "";
    $("#conn-legacy-env-id").value = c.environmentId || "";
    $("#conn-schema").value = c.schemaName || "";
    $("#conn-cloud").value = c.cloud || "prod";
    $("#conn-agent-type").value = c.agentType || "published";
    $("#conn-token-endpoint").value = c.tokenEndpoint || "";
    $("#conn-client-id").value = c.clientId || "";
    $("#conn-tenant-id").value = c.tenantId || "";
    $("#conn-scope").value = c.scope || "";
    var claudeKey = $("#conn-claude-key");
    claudeKey.value = c.claudeApiKey || "";
    claudeKey.type = "password";
    var claudeKeyToggle = $("#conn-claude-key-toggle");
    if (claudeKeyToggle) claudeKeyToggle.textContent = "Show";
    setClaudeModelSelect(c.claudeModel || "");
    $("#conn-claude-system").value = c.claudeSystemPrompt || "";
    $("#conn-claude-max-tokens").value = c.claudeMaxTokens || "";
    $("#conn-claude-temperature").value = c.claudeTemperature || "";
    $("#conn-claude-base-url").value = c.claudeBaseUrl || "";
    var claudeResolved = $("#conn-claude-resolved");
    if (claudeResolved) claudeResolved.textContent = "";
    var geminiKey = $("#conn-gemini-key");
    geminiKey.value = c.geminiApiKey || "";
    geminiKey.type = "password";
    var geminiKeyToggle = $("#conn-gemini-key-toggle");
    if (geminiKeyToggle) geminiKeyToggle.textContent = "Show";
    setGeminiModelSelect(c.geminiModel || "");
    $("#conn-gemini-system").value = c.geminiSystemPrompt || "";
    $("#conn-gemini-max-tokens").value = c.geminiMaxTokens || "";
    $("#conn-gemini-temperature").value = c.geminiTemperature || "";
    $("#conn-gemini-base-url").value = c.geminiBaseUrl || "";
    var geminiResolved = $("#conn-gemini-resolved");
    if (geminiResolved) geminiResolved.textContent = "";
    var openrouterKey = $("#conn-openrouter-key");
    openrouterKey.value = c.openrouterApiKey || "";
    openrouterKey.type = "password";
    var openrouterKeyToggle = $("#conn-openrouter-key-toggle");
    if (openrouterKeyToggle) openrouterKeyToggle.textContent = "Show";
    setOpenRouterModelSelect(c.openrouterModel || "");
    $("#conn-openrouter-system").value = c.openrouterSystemPrompt || "";
    $("#conn-openrouter-max-tokens").value = c.openrouterMaxTokens || "";
    $("#conn-openrouter-temperature").value = c.openrouterTemperature || "";
    $("#conn-openrouter-base-url").value = c.openrouterBaseUrl || "";
    var openrouterResolved = $("#conn-openrouter-resolved");
    if (openrouterResolved) openrouterResolved.textContent = "";
    var redirect = location.origin + location.pathname;
    $("#conn-redirect").textContent = redirect;
    $("#conn-redirect-legacy").textContent = redirect;
    syncConnFields();
    renderAccount();
    openModal("#connect-modal");
  }

  /** Sign in without leaving the settings modal, so problems surface early. */
  function connectSignIn(useRedirect) {
    var s = readConnForm();
    if (!s.clientId) { toast("Add the Entra ID application (client) ID first.", "err"); return; }
    var btn = $("#conn-signin");
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Signing in…";

    var scopes = [tokenScope(s)];
    var cfg = { clientId: s.clientId, tenantId: s.tenantId, scopes: scopes };

    var p = useRedirect
      ? global.Connect.signInRedirect(cfg)
      : global.Connect.acquireToken(cfg);

    p.then(function () {
      renderAccount();
      toast("Signed in");
      logEvent("Signed in with Microsoft", (global.Connect.currentAccount() || {}).username, "ok");
    }).catch(function (err) {
      toast(err.message, "err");
      logEvent("Sign-in failed", err.message, "err");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = was;
    });
  }

  /** Confirm the settings actually reach the agent before saving them. */
  function testConnection() {
    var btn = $("#conn-test");
    var s = readConnForm();
    if (!global.M365Agents || !global.M365Agents.isConfigured(s)) {
      toast("Add the connection string (or environment ID and agent schema name) first.", "err");
      return;
    }
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Testing…";

    var getToken = function (o) {
      o = o || {};
      return global.Connect.acquireToken({
        clientId: s.clientId,
        tenantId: s.tenantId,
        scopes: [tokenScope(s)],
        forceRefresh: !!o.forceRefresh
      }).then(function (r) { return r.accessToken; });
    };

    global.M365Agents.connect({
      settings: s,
      getToken: getToken,
      greeting: false,
      onActivity: function () {},
      onStatus: function () {}
    }).then(function (c) {
      try { c.end(); } catch (e) { /* ignore */ }
      $("#conn-resolved").textContent = "Connected. Conversation started successfully.";
      toast("Connection works");
      logEvent("Connection test passed", global.M365Agents.baseUrl(s), "ok");
    }).catch(function (err) {
      $("#conn-resolved").textContent = err.message;
      toast(err.message, "err");
      logEvent("Connection test failed", err.message, "err");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = was;
    });
  }

  /** Same idea as testConnection(), for the Claude transport's own key + model. */
  function testClaudeConnection() {
    var btn = $("#conn-claude-test");
    var s = readConnForm();
    var settings = { apiKey: s.claudeApiKey, model: s.claudeModel, baseUrl: s.claudeBaseUrl };
    if (!global.AnthropicClient || !global.AnthropicClient.isConfigured(settings)) {
      toast("Add your API key and choose a model first.", "err");
      return;
    }
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Testing…";

    global.AnthropicClient.testConnection(settings).then(function () {
      $("#conn-claude-resolved").textContent = "Connected. Claude answered successfully.";
      toast("Connection works");
      logEvent("Connection test passed", settings.model, "ok");
    }).catch(function (err) {
      $("#conn-claude-resolved").textContent = err.message;
      toast(err.message, "err");
      logEvent("Connection test failed", err.message, "err");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = was;
    });
  }

  /** Same idea as testClaudeConnection(), for the Gemini transport's own key + model. */
  function testGeminiConnection() {
    var btn = $("#conn-gemini-test");
    var s = readConnForm();
    var settings = { apiKey: s.geminiApiKey, model: s.geminiModel, baseUrl: s.geminiBaseUrl };
    if (!global.GeminiClient || !global.GeminiClient.isConfigured(settings)) {
      toast("Add your API key and choose a model first.", "err");
      return;
    }
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Testing…";

    global.GeminiClient.testConnection(settings).then(function () {
      $("#conn-gemini-resolved").textContent = "Connected. Gemini answered successfully.";
      toast("Connection works");
      logEvent("Connection test passed", settings.model, "ok");
    }).catch(function (err) {
      $("#conn-gemini-resolved").textContent = err.message;
      toast(err.message, "err");
      logEvent("Connection test failed", err.message, "err");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = was;
    });
  }

  /** Same idea as testGeminiConnection(), for the OpenRouter transport's own key + model. */
  function testOpenRouterConnection() {
    var btn = $("#conn-openrouter-test");
    var s = readConnForm();
    var settings = { apiKey: s.openrouterApiKey, model: s.openrouterModel, baseUrl: s.openrouterBaseUrl };
    if (!global.OpenRouterClient || !global.OpenRouterClient.isConfigured(settings)) {
      toast("Add your API key and choose a model first.", "err");
      return;
    }
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Testing…";

    global.OpenRouterClient.testConnection(settings).then(function () {
      $("#conn-openrouter-resolved").textContent = "Connected. The model answered successfully.";
      toast("Connection works");
      logEvent("Connection test passed", settings.model, "ok");
    }).catch(function (err) {
      $("#conn-openrouter-resolved").textContent = err.message;
      toast(err.message, "err");
      logEvent("Connection test failed", err.message, "err");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = was;
    });
  }

  /** Legacy helper. Copilot Studio no longer publishes token endpoints for new agents. */
  function detectEndpoint() {
    var btn = $("#conn-detect");
    var agent = currentAgent();
    if (!agent || !agent.url) {
      toast("Add an agent with an embed URL first.", "err");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Detecting…";
    global.DirectLine.discoverTokenEndpoint(agent.url, null, $("#conn-legacy-env-id").value.trim())
      .then(function (found) {
        $("#conn-token-endpoint").value = found.endpoint;
        toast("Found a working token endpoint");
        logEvent("Token endpoint detected", found.endpoint, "ok");
      })
      .catch(function (err) {
        toast("Could not detect it automatically — paste it from Copilot Studio.", "err");
        // Log every address tried, not just the headline. Which ones failed,
        // and how, is the whole diagnosis.
        var detail = err.message;
        if (err.attempts && err.attempts.length) {
          detail += " Tried: " + err.attempts.map(function (a) {
            return a.endpoint + " (" + (a.status ? "HTTP " + a.status : "unreachable") + ")";
          }).join("; ");
        }
        logEvent("Endpoint detection failed", detail, "warn");
      })
      .then(function () { btn.disabled = false; btn.textContent = "Detect automatically"; });
  }

  /**
   * Report which sign-in sources this network can actually reach. Written for
   * the case where sign-in fails with nothing to go on: it separates "your
   * network blocks the library" from "your app registration is wrong", which
   * otherwise look identical from the user's side.
   */
  function runDiagnostics() {
    var box = $("#conn-diag");
    var btn = $("#conn-diagnose");
    if (!box || !global.Connect || !global.Connect.diagnose) return;

    var was = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Checking…";
    box.hidden = false;
    box.textContent = "Checking each source…";

    return global.Connect.diagnose().then(function (r) {
      box.innerHTML = "";
      r.rows.forEach(function (row) {
        // A missing self-hosted copy is the norm, not a failure worth flagging.
        var skipped = row.optional && !row.ok;
        var div = document.createElement("div");
        div.className = "conn-diag-row " + (skipped ? "skip" : row.ok ? "ok" : "bad");

        var mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = skipped ? "–" : row.ok ? "✓" : "✗";

        var nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = row.label + (skipped ? " (not installed)" : row.ok ? "" : " — " + row.why);

        var ms = document.createElement("span");
        ms.className = "ms";
        ms.textContent = skipped ? "" : row.ms + " ms";

        div.appendChild(mark); div.appendChild(nm); div.appendChild(ms);
        box.appendChild(div);
      });

      var p = document.createElement("p");
      p.className = "conn-diag-summary";
      p.textContent = r.summary;
      box.appendChild(p);

      logEvent("Network check", r.canLoadLibrary ? "Sign-in library reachable" : "All sources blocked",
        r.canLoadLibrary && r.canReachMicrosoft ? "ok" : "err");
    }).catch(function (e) {
      box.textContent = "The check itself failed: " + (e && e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = was;
    });
  }

  function saveConnection() {
    var mode = $("#conn-mode").value;
    var form = readConnForm();
    var endpoint = $("#conn-token-endpoint").value.trim();

    if (endpoint && !/^https:\/\//i.test(endpoint)) {
      toast("The token endpoint must start with https://", "err");
      return;
    }
    if (mode === "sso" && !form.clientId) {
      toast("Single sign-on needs an Entra ID client ID.", "err");
      return;
    }
    if (mode === "m365") {
      if (!global.M365Agents.isConfigured(form)) {
        toast("Paste the connection string from Copilot Studio, or fill in the environment ID and agent schema name.", "err");
        return;
      }
      if (!form.clientId) {
        toast("The Agents SDK signs in with Entra ID — add the application (client) ID.", "err");
        return;
      }
      try {
        global.M365Agents.baseUrl(form);
      } catch (e) {
        toast(e.message, "err");
        return;
      }
    }
    if ((mode === "directline" || mode === "sso") && !endpoint) {
      toast("Legacy Direct Line requires the Token Endpoint shown on the agent's Channels page.", "err");
      return;
    }
    if (mode === "directline" && form.environmentId) {
      var envProblem = describeEnvIdProblem(form.environmentId);
      if (envProblem) {
        toast(envProblem, "err");
        return;
      }
    }
    if (mode === "claude") {
      if (!form.claudeApiKey) {
        toast("Add your Anthropic API key.", "err");
        return;
      }
      if (!form.claudeModel) {
        toast("Choose a model, or enter a custom model ID.", "err");
        return;
      }
    }
    if (mode === "gemini") {
      if (!form.geminiApiKey) {
        toast("Add your Gemini API key.", "err");
        return;
      }
      if (!form.geminiModel) {
        toast("Choose a model, or enter a custom model ID.", "err");
        return;
      }
    }
    if (mode === "openrouter") {
      if (!form.openrouterApiKey) {
        toast("Add your OpenRouter API key.", "err");
        return;
      }
      if (!form.openrouterModel) {
        toast("Choose a model, or enter a custom model ID.", "err");
        return;
      }
    }

    var next = {
      mode: mode,
      connectionString: form.connectionString,
      directConnectUrl: form.directConnectUrl,
      environmentId: form.environmentId,
      schemaName: form.schemaName,
      cloud: form.cloud,
      agentType: form.agentType,
      tokenEndpoint: endpoint,
      clientId: form.clientId,
      tenantId: form.tenantId,
      scope: form.scope,
      claudeApiKey: form.claudeApiKey,
      claudeModel: form.claudeModel,
      claudeSystemPrompt: form.claudeSystemPrompt,
      claudeMaxTokens: form.claudeMaxTokens,
      claudeTemperature: form.claudeTemperature,
      claudeBaseUrl: form.claudeBaseUrl,
      geminiApiKey: form.geminiApiKey,
      geminiModel: form.geminiModel,
      geminiSystemPrompt: form.geminiSystemPrompt,
      geminiMaxTokens: form.geminiMaxTokens,
      geminiTemperature: form.geminiTemperature,
      geminiBaseUrl: form.geminiBaseUrl,
      openrouterApiKey: form.openrouterApiKey,
      openrouterModel: form.openrouterModel,
      openrouterSystemPrompt: form.openrouterSystemPrompt,
      openrouterMaxTokens: form.openrouterMaxTokens,
      openrouterTemperature: form.openrouterTemperature,
      openrouterBaseUrl: form.openrouterBaseUrl
    };

    var sel = $("#conn-target");
    var toAgent = sel && sel.value === "agent" && connEditing;

    if (toAgent) {
      // Only keep what actually differs, so an agent that is merely pinned to
      // a different transport does not freeze a stale copy of everything else.
      var over = { mode: mode };
      CONN_KEYS.forEach(function (k) {
        if (next[k] && next[k] !== state.connection[k]) over[k] = next[k];
      });
      connEditing.conn = over;
      // Retire the older per-agent shape so the two cannot disagree.
      delete connEditing.m365;
      logEvent("Connection settings saved", connEditing.name + " · " + mode, "ok");
    } else {
      state.connection = next;
      logEvent("Connection settings saved", "Workspace default · " + mode, "ok");
    }

    savePrefs();
    closeModals();
    renderAgents();
    renderAgentMenu();
    toast("Reconnecting…");
    connectActiveChat();
  }

  /**
   * Remove an agent, optionally taking its conversations with it.
   *
   * Chats record which agent they belong to, so "delete its chats too" is a
   * real option rather than an all-or-nothing reset. It is offered as the
   * third button so the safe choice stays the obvious one.
   */
  function removeAgent(victim) {
    if (!victim) return Promise.resolve();

    var owned = chats.filter(function (c) { return c.agent === victim.id; });
    var last = state.agents.length === 1;

    var body = last
      ? "This is your only agent. Removing it returns you to the welcome screen."
      : "The agent is removed from this browser.";
    body += owned.length
      ? "\n\nIt has " + owned.length + (owned.length === 1 ? " saved chat" : " saved chats") +
        ", which are kept unless you choose to delete them as well."
      : "\n\nIt has no saved chats.";

    return askConfirm('Remove "' + victim.name + '"?', {
      body: body,
      ok: "Remove agent",
      alt: owned.length ? "Remove and delete its chats" : "",
      danger: true
    }).then(function (answer) {
      if (!answer) return null;

      state.agents = state.agents.filter(function (a) { return a.id !== victim.id; });
      if (state.activeAgent === victim.id) {
        state.activeAgent = state.agents[0] ? state.agents[0].id : null;
      }

      // "alt" is the third button: remove the agent AND its conversations.
      var purge = answer === "alt" && owned.length
        ? Promise.all(owned.map(function (c) { return Store.chats.remove(c.id); }))
            .then(refreshChats)
            .then(function () {
              if (owned.some(function (c) { return c.id === state.activeChat; })) {
                state.activeChat = chats.length ? chats[0].id : null;
              }
            })
        : Promise.resolve();

      return purge.then(function () {
        return savePrefs();
      }).then(function () {
        renderSidebar();
        renderAgentMenu();
        toast(answer === "alt" && owned.length
          ? "Removed " + victim.name + " and " + owned.length +
            (owned.length === 1 ? " chat" : " chats")
          : "Removed " + victim.name);
        logEvent("Agent removed", victim.name, "warn");
        return connectActiveChat();
      });
    });
  }

  /**
   * afterSave, if given, is called with the saved agent once everything else
   * here has finished — used by the "Connection settings" button in this
   * same modal to jump straight there for the agent just saved, rather than
   * whichever agent happened to be active.
   */
  function saveAgent(afterSave) {
    var name = $("#agent-form-name").value.trim();
    var modeSel = $("#agent-form-mode");
    var mode = modeSel ? modeSel.value : "";
    // Claude, Gemini and OpenRouter all talk straight to their own API, so
    // there is no Copilot Studio address to require or extract here — that
    // agent's credentials live in Connection settings instead, same as an
    // Agents SDK agent's Entra details do.
    var noUrlMode = mode === "claude" || mode === "gemini" || mode === "openrouter";

    var raw = $("#agent-form-url").value.trim();
    // Copilot Studio hands out a whole HTML document, so accept that too and
    // keep only the address from inside it.
    var url = noUrlMode ? "" : A.extractUrl(raw);
    if (!name) { toast("Give the agent a name.", "err"); return; }
    if (!noUrlMode) {
      if (!raw) { toast("Give the agent a name and a URL.", "err"); return; }
      if (!url) {
        toast("No https:// address found. Paste the agent URL, or the whole embed code.", "err");
        return;
      }
      if (url !== raw) $("#agent-form-url").value = url;
    }

    var desc = $("#agent-form-desc").value.trim();

    /* ---- editing an agent that already exists ---- */
    var existing = agentEditing ? agentById(agentEditing) : null;
    if (existing) {
      var prevMode = (existing.conn && existing.conn.mode) || "";
      var urlChanged = false;
      existing.name = name;
      // Leave a URL-less agent's stored URL alone rather than blanking it —
      // switching back to a Copilot Studio mode later should not require
      // pasting the address again.
      if (!noUrlMode) {
        urlChanged = existing.url !== url;
        existing.url = url;
      }
      existing.desc = desc;
      // A cleared picture must remove the stored one, so this is assigned
      // unconditionally rather than only when a new file was chosen.
      if (agentIconDraft) existing.icon = agentIconDraft;
      else delete existing.icon;
      // Only the mode is touched here. The rest of an agent's connection
      // record (endpoints, ids, the Claude/Gemini API key) belongs to the
      // connection modal and must survive a rename.
      if (mode) {
        existing.conn = existing.conn || {};
        existing.conn.mode = mode;
      } else if (existing.conn) {
        delete existing.conn.mode;
      }
      var modeChanged = ((existing.conn && existing.conn.mode) || "") !== prevMode;
      agentEditing = null;
      agentIconDraft = null;
      savePrefs();
      renderAgents();
      renderAgentMenu();
      renderAgentAvatar();
      closeModals();
      toast("Saved " + name);
      // Changing where an agent points, or how it connects, has to take
      // effect now; a rename alone does not justify tearing down a live
      // conversation.
      if ((urlChanged || modeChanged) && existing.id === state.activeAgent) connectActiveChat();
      if (afterSave) afterSave(existing);
      return;
    }

    /* ---- adding a new agent ---- */
    // `addedAt` marks this as a real, user-created agent, which is what the
    // stale-seed cleanup in loadPrefs looks for.
    var a = {
      id: uid(),
      name: name,
      url: url,
      desc: desc,
      builtin: false,
      hidden: false,
      addedAt: Date.now()
    };
    if (agentIconDraft) a.icon = agentIconDraft;

    // An agent may be pinned to its own transport at the moment it is added.
    if (mode) a.conn = { mode: mode };

    agentIconDraft = null;
    state.agents.push(a);
    state.activeAgent = a.id;
    savePrefs();
    renderAgents();
    renderAgentMenu();
    closeModals();
    toast("Added " + name);
    newChat();
    if (afterSave) afterSave(a);
  }

  /** Flip one agent's sidebar visibility. */
  function toggleAgentHidden(id) {
    var a = agentById(id);
    if (!a) return;
    a.hidden = !a.hidden;
    savePrefs();
    renderAgents();
    if (a.hidden && !state.settings.showHiddenAgents) {
      toast(a.name + " hidden from the sidebar. It is still in the agent switcher.");
    } else if (!a.hidden) {
      toast(a.name + " shown in the sidebar again.");
    }
  }

  function renderAgentMenu() {
    var host = $("#agent-menu");
    host.innerHTML = '<div class="menu-label">Switch agent</div>' +
      state.agents.map(function (a) {
        return '<button class="menu-item' + (a.id === state.activeAgent ? " sel" : "") + '" data-pick="' + a.id + '">' +
          '<span class="body"><span class="nm"></span><span class="sub"></span></span>' +
          (a.id === state.activeAgent ? icon("check") : "") + "</button>";
      }).join("") +
      '<div class="menu-sep"></div><button class="menu-item" data-addagent="1">' + icon("plus") +
      "<span class='body'>Add an agent…</span></button>";
    $$("[data-pick]", host).forEach(function (btn, i) {
      var a = state.agents[i];
      btn.insertBefore(A.avatar(a), btn.firstChild);
      $(".nm", btn).textContent = a.name;
      $(".sub", btn).textContent = a.desc || MODE_LABEL[effectiveConn(a).mode] || "Copilot Studio agent";
    });
  }

  /** Show which agent is active, by mark as well as by name. */
  function renderAgentAvatar() {
    var host = $("#agent-avatar");
    if (!host) return;
    host.textContent = "";
    var agent = hasAgent() ? currentAgent() : null;
    if (agent) host.appendChild(A.avatar(agent));
  }

  /* ---------------------------------------------------------------- layout */

  function toggleSidebar() {
    var app = $(".app");
    if (window.innerWidth <= 960) app.classList.toggle("sidebar-open");
    else app.classList.toggle("sidebar-collapsed");
    syncSidebarBtn();
  }

  /** Keep the top-bar toggle describing what it will actually do next. */
  function syncSidebarBtn() {
    var btn = $("#sidebar-btn");
    if (!btn) return;
    var app = $(".app");
    var shown = window.innerWidth <= 960
      ? app.classList.contains("sidebar-open")
      : !app.classList.contains("sidebar-collapsed");
    // Focus mode hides the sidebar regardless of the collapsed class.
    if (document.body.classList.contains("zen")) shown = false;
    btn.setAttribute("aria-pressed", String(shown));
    btn.setAttribute("aria-label", shown ? "Hide the sidebar" : "Show the sidebar");
    btn.title = (shown ? "Hide sidebar" : "Show sidebar") + " (Ctrl \\)";
  }

  /**
   * The slim top bar.
   *
   * This SHRINKS the bar; it never removes it. That is a deliberate limit, not
   * an unfinished feature. The sidebar toggle lives in this bar, so a top bar
   * that could be hidden outright would take the only pointer route back to
   * the sidebar with it — collapse both and the window would have no chrome at
   * all. Shrunk, the bar keeps its two layout toggles, the agent switcher and
   * the connection pill, so every state is reversible with one click.
   *
   * Focus mode does hide the bar completely, and pays for that with a floating
   * exit chip. There is no need for a second control with the same cost.
   */
  function setTopbarSlim(on) {
    state.slimTopbar = !!on;
    document.body.classList.toggle("topbar-slim", state.slimTopbar);

    var btn = $("#topbar-slim-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", String(state.slimTopbar));
      btn.setAttribute("aria-label", state.slimTopbar ? "Expand the top bar" : "Shrink the top bar");
      btn.title = (state.slimTopbar ? "Expand top bar" : "Shrink top bar") + " (Ctrl Shift \\)";
    }
    var sw = $("#slim-toggle");
    if (sw) sw.setAttribute("aria-checked", String(state.slimTopbar));
  }

  function toggleTopbarSlim() {
    setTopbarSlim(!state.slimTopbar);
    savePrefs();
  }

  /**
   * Focus mode. Hides the sidebar, the workbench and the top bar so the
   * conversation has the whole window.
   *
   * The top bar is only hidden once there is somewhere else to click, which is
   * why the floating exit chip is not optional: in the legacy frame the page
   * has no other chrome of its own, so without the chip focus mode would be a
   * one-way door for anyone who does not know the Esc shortcut.
   */
  function toggleZen() {
    document.body.classList.toggle("zen");
    var on = document.body.classList.contains("zen");
    $("#zen-btn").setAttribute("aria-pressed", String(on));
    var exit = $("#zen-exit");
    if (exit) exit.hidden = !on;
    syncSidebarBtn();
    // The crop depends on whether the top bar is present, so it has to be
    // recomputed on every entry and exit, not only for the frame.
    applyEmbedCrop();
    toast(on ? "Focus mode on — press Esc to exit" : "Focus mode off");
  }

  /* ------------------------------------------------------------------ init */

  function bindEvents() {
    $("#reload-btn").addEventListener("click", function () { connectActiveChat(); toast("Reconnecting"); });
    $("#zen-btn").addEventListener("click", toggleZen);
    $("#appearance-btn").addEventListener("click", openAppearance);
    $("#wb-btn").addEventListener("click", toggleWorkbench);
    $("#wb-close").addEventListener("click", function () { $(".app").classList.remove("workbench-open"); });
    $("#sidebar-btn").addEventListener("click", toggleSidebar);
    $("#topbar-slim-btn").addEventListener("click", toggleTopbarSlim);
    $("#brand-home").addEventListener("click", goHome);
    $("#zen-exit").addEventListener("click", toggleZen);
    // Crossing the mobile breakpoint swaps which class means "shown".
    window.addEventListener("resize", syncSidebarBtn);
    $("#palette-btn").addEventListener("click", openPalette);

    // Sidebar
    $("#new-chat").addEventListener("click", function () { newChat(); });
    $("#side-search").addEventListener("input", function () { renderRecents(); renderProjects(); });
    $("#add-agent").addEventListener("click", openAgentModal);
    $("#add-project").addEventListener("click", addProject);

    $("#chat-list").addEventListener("click", onChatListClick);
    $("#project-list").addEventListener("click", onProjectListClick);

    $("#agent-list").addEventListener("click", function (e) {
      // Row actions are checked before the row itself, so clicking the eye or
      // the pencil does not also switch to that agent.
      var hide = e.target.closest("[data-agenthide]");
      if (hide) { e.stopPropagation(); toggleAgentHidden(hide.dataset.agenthide); return; }

      var edit = e.target.closest("[data-agenticon]");
      if (edit) { e.stopPropagation(); openAgentModal(edit.dataset.agenticon); return; }

      var del = e.target.closest("[data-agentdel]");
      if (del) {
        e.stopPropagation();
        var id = del.dataset.agentdel;
        var victim = state.agents.filter(function (a) { return a.id === id; })[0];
        if (!victim) return;

        removeAgent(victim);
        return;
      }
      var item = e.target.closest("[data-agent]");
      if (item && item.dataset.agent !== state.activeAgent) {
        state.activeAgent = item.dataset.agent;
        savePrefs(); renderAgents(); renderAgentMenu(); connectActiveChat();
      }
    });

    bindDragAndDrop();

    // Agent switcher menu
    $("#agent-switch").addEventListener("click", function (e) {
      e.stopPropagation();
      var menu = $("#agent-menu");
      var open = menu.classList.contains("open");
      closeModals();
      if (!open) {
        var r = this.getBoundingClientRect();
        menu.style.left = r.left + "px";
        menu.style.top = (r.bottom + 6) + "px";
        menu.classList.add("open");
      }
    });
    $("#agent-menu").addEventListener("click", function (e) {
      if (e.target.closest("[data-addagent]")) { closeModals(); openAgentModal(); return; }
      var pick = e.target.closest("[data-pick]");
      if (pick) {
        state.activeAgent = pick.dataset.pick;
        savePrefs(); renderAgents(); renderAgentMenu(); connectActiveChat(); closeModals();
      }
    });
    document.addEventListener("click", function () { $$(".menu").forEach(function (m) { m.classList.remove("open"); }); });

    // Tabs
    $$(".wb-tab").forEach(function (t) {
      t.addEventListener("click", function () { selectTab(t.dataset.tab); });
    });

    // Artifact
    $("#artifact-render").addEventListener("click", renderArtifact);
    $("#artifact-type").addEventListener("change", renderArtifact);
    $("#artifact-sample").addEventListener("click", function () {
      $("#artifact-title").value = "Quarterly Performance Review";
      $("#artifact-type").value = "markdown";
      $("#artifact-src").value = SAMPLE_DOC;
      renderArtifact();
    });
    $("#artifact-clear").addEventListener("click", function () {
      $("#artifact-src").value = "";
      renderArtifact();
    });
    $("#artifact-copy").addEventListener("click", function () {
      var v = $("#artifact-src").value;
      if (!v.trim()) { toast("Nothing to copy yet.", "err"); return; }
      copyText(v, "Artifact source");
    });
    $("#artifact-copy-rich").addEventListener("click", function () {
      var t = $("#artifact-view").innerText;
      if (!t.trim()) { toast("Render something first.", "err"); return; }
      copyText(t, "Rendered text");
    });
    $$("[data-export]").forEach(function (b) {
      b.addEventListener("click", function () { exportArtifact(b.dataset.export); });
    });

    // Chart
    $("#chart-build").addEventListener("click", buildChart);
    $("#chart-type").addEventListener("change", function () { if (lastChartSVG) buildChart(); });
    $("#chart-sample").addEventListener("click", function () {
      $("#chart-title").value = "Revenue against target by region";
      $("#chart-data").value = SAMPLE_DATA;
      buildChart();
    });
    $$("[data-chartexp]").forEach(function (b) {
      b.addEventListener("click", function () { exportChart(b.dataset.chartexp); });
    });

    // Workbench files
    var dz = $("#dropzone");
    var fi = $("#file-input");
    dz.addEventListener("click", function () { fi.click(); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); }
    });
    fi.addEventListener("change", function () { addFiles(fi.files); fi.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("over"); });
    });
    dz.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });

    $("#file-list").addEventListener("click", function (e) {
      var rm = e.target.closest("[data-frm]");
      if (rm) {
        files.splice(+rm.dataset.frm, 1);
        renderFiles();
        var badge = $("#tab-files .badge");
        badge.textContent = files.length;
        badge.hidden = files.length === 0;
        return;
      }
      var cp = e.target.closest("[data-fcopy]");
      if (cp) { copyText(files[+cp.dataset.fcopy].text, "File contents"); return; }
      var snd = e.target.closest("[data-fsend]");
      if (snd) {
        Chat.stageFiles([files[+snd.dataset.fsend].file]);
        toast("Added to the composer");
        $("#composer-input").focus();
      }
    });

    $("#files-copy-all").addEventListener("click", function () {
      var ctx = filesAsContext();
      if (!ctx) { toast("No readable text files attached.", "err"); return; }
      copyText(ctx, "File context block");
    });
    $("#files-clear").addEventListener("click", function () {
      files = [];
      renderFiles();
      $("#tab-files .badge").hidden = true;
      toast("Attachments cleared");
    });

    // Activity
    $("#log-clear").addEventListener("click", function () {
      state.log = [];
      renderLog();
      $("#tab-activity .badge").hidden = true;
    });
    $("#log-export").addEventListener("click", function () {
      if (!state.log.length) { toast("Nothing logged yet.", "err"); return; }
      var name = "activity-" + A.stamp() + ".json";
      A.download(name, JSON.stringify(state.log.map(function (e) {
        return { time: new Date(e.t).toISOString(), event: e.title, detail: e.detail };
      }), null, 2), "application/json");
      toast("Downloaded " + name);
    });

    // Modals
    $("#scrim").addEventListener("click", closeModals);
    $$("[data-close]").forEach(function (b) { b.addEventListener("click", closeModals); });

    // Welcome pane
    $("#welcome-add").addEventListener("click", openAgentModal);
    $("#welcome-connect").addEventListener("click", openConnectModal);

    // Legacy embed chrome
    $("#agent-frame").addEventListener("load", function () {
      // Fires for about:blank too, so only treat it as success when we are
      // actually showing an agent.
      if ($("#embed-pane").hidden) return;
      if (this.src === "about:blank") return;
      if (embedTimer) { clearTimeout(embedTimer); embedTimer = null; }
      $("#embed-loading").hidden = true;
    });
    $("#embed-open").addEventListener("click", openEmbedTab);
    $("#embed-open-2").addEventListener("click", openEmbedTab);
    $("#embed-settings").addEventListener("click", function () { openConnectModal(); });

    // Ask / confirm dialog
    $("#ask-ok").addEventListener("click", acceptAsk);
    $("#ask-alt").addEventListener("click", function () { finishAsk("alt"); });
    $("#ask-cancel").addEventListener("click", function () {
      finishAsk(askPending && askPending.kind === "confirm" ? false : null);
    });
    $("#ask-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); acceptAsk(); }
    });
    $("#ask-input").addEventListener("input", function () {
      var err = $("#ask-error");
      if (!err.hidden) err.hidden = true;
    });
    $("#agent-save").addEventListener("click", function () { saveAgent(); });
    var openConn = $("#agent-open-connection");
    if (openConn) {
      openConn.addEventListener("click", function () {
        saveAgent(function (agent) { openConnectModal({ agent: agent, scope: "agent" }); });
      });
    }
    $("#settings-btn").addEventListener("click", function () { openModal("#settings-modal"); showStorageNote(); });
    $("#shortcuts-btn").addEventListener("click", function () { openModal("#shortcuts-modal"); });

    // Backup / restore
    $("#backup-export").addEventListener("click", exportWorkspace);
    $("#backup-import").addEventListener("click", function () { $("#backup-file").click(); });
    $("#backup-file").addEventListener("change", function () {
      if (this.files && this.files[0]) importWorkspace(this.files[0]);
      this.value = "";
    });

    // Connection & sign-in
    $("#connect-btn").addEventListener("click", function () { openConnectModal(); });
    $("#conn-mode").addEventListener("change", syncConnFields);
    $("#conn-target").addEventListener("change", function () {
      // Re-read the settings for whichever scope was just chosen, so the form
      // never shows one agent's values while pointed at another target.
      openConnectModal({ scope: this.value });
    });
    $("#conn-embed-edit").addEventListener("click", function () {
      closeModals();
      openAgentModal();
    });
    $("#conn-save").addEventListener("click", saveConnection);
    $("#conn-detect").addEventListener("click", detectEndpoint);
    $("#conn-string").addEventListener("change", applyConnectionString);
    $("#conn-string").addEventListener("paste", function () { setTimeout(applyConnectionString, 0); });
    $("#conn-apply-string").addEventListener("click", applyConnectionString);
    $("#conn-signin").addEventListener("click", function () { connectSignIn(false); });
    $("#conn-signin-redirect").addEventListener("click", function () { connectSignIn(true); });
    $("#conn-test").addEventListener("click", testConnection);
    $("#conn-diagnose").addEventListener("click", runDiagnostics);
    var claudeModelSel = $("#conn-claude-model");
    if (claudeModelSel) claudeModelSel.addEventListener("change", syncClaudeModelField);
    var claudeKeyToggle = $("#conn-claude-key-toggle");
    if (claudeKeyToggle) {
      claudeKeyToggle.addEventListener("click", function () {
        var input = $("#conn-claude-key");
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        this.textContent = show ? "Hide" : "Show";
      });
    }
    var claudeTest = $("#conn-claude-test");
    if (claudeTest) claudeTest.addEventListener("click", testClaudeConnection);
    var geminiModelSel = $("#conn-gemini-model");
    if (geminiModelSel) geminiModelSel.addEventListener("change", syncGeminiModelField);
    var geminiKeyToggle = $("#conn-gemini-key-toggle");
    if (geminiKeyToggle) {
      geminiKeyToggle.addEventListener("click", function () {
        var input = $("#conn-gemini-key");
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        this.textContent = show ? "Hide" : "Show";
      });
    }
    var geminiTest = $("#conn-gemini-test");
    if (geminiTest) geminiTest.addEventListener("click", testGeminiConnection);
    var openrouterModelSel = $("#conn-openrouter-model");
    if (openrouterModelSel) openrouterModelSel.addEventListener("change", syncOpenRouterModelField);
    var openrouterKeyToggle = $("#conn-openrouter-key-toggle");
    if (openrouterKeyToggle) {
      openrouterKeyToggle.addEventListener("click", function () {
        var input = $("#conn-openrouter-key");
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        this.textContent = show ? "Hide" : "Show";
      });
    }
    var openrouterTest = $("#conn-openrouter-test");
    if (openrouterTest) openrouterTest.addEventListener("click", testOpenRouterConnection);
    var openrouterLoad = $("#conn-openrouter-load-models");
    if (openrouterLoad) openrouterLoad.addEventListener("click", loadOpenRouterModels);
    ["#conn-env-id", "#conn-legacy-env-id", "#conn-schema", "#conn-cloud",
      "#conn-agent-type", "#conn-direct-url"].forEach(function (sel) {
      $(sel).addEventListener("change", syncConnFields);
    });
    // Keep the two environment ID boxes in step, so filling either one is enough.
    [["#conn-env-id", "#conn-legacy-env-id"], ["#conn-legacy-env-id", "#conn-env-id"]]
      .forEach(function (pair) {
        $(pair[0]).addEventListener("input", function () {
          $(pair[1]).value = this.value;
          syncConnFields();
        });
      });
    $$("#conn-setup").forEach(function (b) {
      b.addEventListener("click", function () { openConnectModal(); });
    });
    $("#conn-signout").addEventListener("click", function () {
      if (!global.Connect) return;
      global.Connect.signOut().then(function () {
        renderAccount();
        logEvent("Signed out", "Microsoft account", "info");
        toast("Signed out");
        connectActiveChat();
      });
    });

    // Settings switches
    $$("[data-toggle]").forEach(function (sw) {
      var key = sw.dataset.toggle;
      sw.setAttribute("aria-checked", String(!!state.settings[key]));
      sw.addEventListener("click", function () {
        state.settings[key] = !state.settings[key];
        sw.setAttribute("aria-checked", String(state.settings[key]));
        savePrefs();
      });
    });

    /* ---------------------------------------------------- appearance page */

    $("#appearance-open").addEventListener("click", openAppearance);

    $("#dark-toggle").addEventListener("click", function () {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });

    $("#slim-toggle").addEventListener("click", toggleTopbarSlim);

    // The two sidebar switches share the generic data-toggle handler above,
    // which updates state and saves. These add the redraw the generic handler
    // has no way to know is needed. Registered after it, so state is already
    // current by the time they run.
    ["#show-agents-toggle", "#show-hidden-agents-toggle"].forEach(function (sel) {
      $(sel).addEventListener("click", renderAgents);
    });

    var grid = $("#palette-grid");
    grid.addEventListener("click", function (e) {
      var card = e.target.closest("[data-palette]");
      if (!card) return;
      applyPalette(card.dataset.palette);
      toast(PALETTE_LABEL[state.palette] + " colourway applied");
    });
    // Arrow keys move within the radiogroup, which is one tab stop.
    grid.addEventListener("keydown", function (e) {
      var keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
      if (keys.indexOf(e.key) === -1) return;
      var cards = $$("[data-palette]", grid);
      if (!cards.length) return;
      var at = cards.map(function (c) { return c.dataset.palette; }).indexOf(state.palette);
      var step = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : -1;
      var next = cards[((at < 0 ? 0 : at) + step + cards.length) % cards.length];
      e.preventDefault();
      applyPalette(next.dataset.palette);
      next.focus();
    });

    /* ------------------------------------------------- agent icon uploads */

    $("#agent-form-icon-pick").addEventListener("click", function () {
      $("#agent-form-icon-file").click();
    });
    $("#agent-form-icon-file").addEventListener("change", function () {
      readAgentIcon(this.files && this.files[0]);
      // Cleared so that choosing the same file twice still fires a change.
      this.value = "";
    });
    $("#agent-form-icon-clear").addEventListener("click", function () {
      agentIconDraft = null;
      renderIconDraft();
    });
    // The preview falls back to initials, so it has to follow the name field.
    $("#agent-form-name").addEventListener("input", renderIconDraft);
    // Claude agents need no URL field; toggle it the moment the mode changes.
    var agentModeSel = $("#agent-form-mode");
    if (agentModeSel) agentModeSel.addEventListener("change", syncAgentFormMode);

    // How much of the embedded canvas's own header to hide behind our top bar.
    var crop = $("#embed-crop");
    if (crop) {
      crop.value = String(state.embedCrop);
      crop.addEventListener("change", function () {
        state.embedCrop = Number(this.value) || 0;
        applyEmbedCrop();
        savePrefs();
        // Nudge the frame so the new window takes effect immediately.
        if (!$("#embed-pane").hidden) loadEmbed();
      });
    }

    $("#clear-chats-btn").addEventListener("click", function () {
      askConfirm("Delete every conversation?", {
        body: "All chats, messages, projects and saved attachments are deleted from " +
              "this browser. Your agents, connection settings and preferences are kept.\n\n" +
              "This cannot be undone. Back up first if you might want them again.",
        ok: "Delete conversations",
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        // Preferences live in "kv", so it is deliberately not in this list.
        return Store.wipe(["chats", "messages", "projects", "blobs"]).then(function () {
          state.activeChat = null;
          return savePrefs();
        }).then(function () {
          location.reload();
        });
      });
    });

    $("#reset-btn").addEventListener("click", function () {
      askConfirm("Erase everything in this browser?", {
        body: "Deletes every chat, message, project, attachment, agent, connection " +
              "setting, saved Microsoft sign-in and preference. The app returns to a " +
              "fresh install.\n\nThis cannot be undone. Back up first if you might " +
              "want any of it again.",
        ok: "Erase everything",
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        // Best effort: forget the Microsoft account too, so the next sign-in
        // genuinely starts over rather than silently reusing a cached token.
        var signOut = global.Connect && global.Connect.forget
          ? Promise.resolve(global.Connect.forget()).catch(function () { /* not signed in */ })
          : Promise.resolve();
        return signOut
          .then(function () { return Store.destroy(); })
          .catch(function () { /* clearing is best effort; still reload */ })
          .then(function () { location.reload(); });
      });
    });

    // Palette
    $("#palette-input").addEventListener("input", function () { filterPalette(this.value); });
    $("#palette-input").addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); movePalette(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); movePalette(-1); }
      else if (e.key === "Enter") { e.preventDefault(); runPalette(); }
    });
    $("#palette-list").addEventListener("click", function (e) {
      var li = e.target.closest("[data-cmd]");
      if (!li) return;
      paletteIdx = $$("#palette-list .palette-item").indexOf(li);
      runPalette();
    });

    // Global shortcuts
    document.addEventListener("keydown", function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); newChat(); return; }
      // Shift + backslash reports as "|" on most layouts but stays "\" on a
      // few, so both spellings are accepted. Checked before the plain
      // backslash case, which would otherwise swallow it.
      if (mod && e.shiftKey && (e.key === "|" || e.key === "\\")) {
        e.preventDefault(); toggleTopbarSlim(); return;
      }
      if (mod && e.key === "\\") { e.preventDefault(); toggleSidebar(); return; }
      if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); toggleWorkbench(); return; }
      if (e.key === "Escape") {
        if ($("#scrim").classList.contains("open")) { closeModals(); return; }
        if (document.body.classList.contains("zen")) { toggleZen(); return; }
        if (window.innerWidth <= 960) $(".app").classList.remove("sidebar-open", "workbench-open");
      }
    });

    // Another tab changed the workspace: pick the change up.
    Store.onRemoteChange(function (change) {
      if (change.store === "chats" || change.store === "projects") {
        Promise.all([refreshChats(), refreshProjects()]).then(renderSidebar);
      }
    });

    setInterval(renderLog, 60000);
  }

  function onChatListClick(e) {
    var ren = e.target.closest("[data-rename]");
    if (ren) { e.stopPropagation(); renameChat(ren.dataset.rename); return; }
    var del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); deleteChat(del.dataset.del); return; }
    var item = e.target.closest("[data-chat]");
    if (item) openChat(item.dataset.chat);
  }

  function onProjectListClick(e) {
    var mk = e.target.closest("[data-projnew]");
    if (mk) { e.stopPropagation(); newChat(mk.dataset.projnew); return; }
    var rn = e.target.closest("[data-projrename]");
    if (rn) { e.stopPropagation(); renameProject(rn.dataset.projrename); return; }
    var dl = e.target.closest("[data-projdel]");
    if (dl) { e.stopPropagation(); deleteProject(dl.dataset.projdel); return; }

    var ren = e.target.closest("[data-rename]");
    if (ren) { e.stopPropagation(); renameChat(ren.dataset.rename); return; }
    var del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); deleteChat(del.dataset.del); return; }
    var item = e.target.closest("[data-chat]");
    if (item) { openChat(item.dataset.chat); return; }

    var head = e.target.closest("[data-drop]");
    if (head) toggleProject(head.dataset.drop);
  }

  function showStorageNote() {
    var note = $("#storage-note");
    Promise.all([Store.messages.countAll(), Store.usage()]).then(function (r) {
      var used = r[1] && r[1].usage ? (r[1].usage / 1048576).toFixed(1) + " MB used" : "";
      note.textContent = chats.length + " chats and " + r[0] + " messages saved" +
        (used ? " · " + used : "") +
        (Store.isFallback() ? " · limited storage mode" : " · stored in IndexedDB");
    });
  }

  function hydrateIcons() {
    $$("[data-icon]").forEach(function (el) {
      el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    });
  }

  function init() {
    // Paint the stored theme AND colourway before anything else, so there is
    // no flash. Both have to happen here: painting only the theme would show
    // the default clay surfaces for a frame before the real colourway landed,
    // which is exactly the flash this block exists to prevent.
    try {
      var t = localStorage.getItem(THEME_KEY);
      if (t) document.documentElement.setAttribute("data-theme", t);
      var p = localStorage.getItem(PALETTE_KEY);
      if (p && PALETTES.indexOf(p) !== -1) document.documentElement.setAttribute("data-palette", p);
    } catch (e) { /* ignore */ }

    Store.ready()
      .then(loadPrefs)
      .then(function () {
        // If sign-in used a full-page redirect, finish it before connecting.
        if (global.Connect && state.connection.clientId) {
          return global.Connect.resumeRedirect({
            clientId: state.connection.clientId,
            tenantId: state.connection.tenantId
          }).catch(function () { /* no redirect in flight */ });
        }
      })
      .then(function () {
        applyTheme(state.theme || "light");
        applyPalette(state.palette || "clay");
        setTopbarSlim(state.slimTopbar);
        applyEmbedCrop();
        hydrateIcons();
        renderAgentMenu();
        renderLog();
        renderFiles();

        if (state.artifact && state.artifact.source) {
          $("#artifact-title").value = state.artifact.title || "";
          $("#artifact-type").value = state.artifact.type || "markdown";
          $("#artifact-src").value = state.artifact.source;
        }

        return Chat.mount({
          hooks: {
            onStatus: function (kind, detail) { setStatus(kind, detail); },
            onTitle: function (id, title) {
              refreshChats().then(renderSidebar);
              logEvent("Chat named", title, "ok");
            },
            onToast: toast,
            onLog: function (t, d) { logEvent(t, d, "ok"); },
            onStage: function (label) {
              // Mirror what the agent is doing into the connection tooltip.
              var el = $("#conn-status");
              if (el && el.textContent === "Live") el.title = MODE_LABEL[activeMode()] + " · " + label;
            },
            onConnected: function (c) {
              logEvent(
                "Connected",
                ((currentAgent() || {}).name || "Agent") + " · " + (MODE_LABEL[activeMode()] || "") +
                  (c.resumed ? " · resumed" : " · new conversation"),
                "ok"
              );
            },
            onSendToWorkbench: function (text) {
              $("#artifact-src").value = text;
              $("#artifact-type").value = "markdown";
              renderArtifact();
              openWorkbench("artifact");
            }
          }
        });
      })
      .then(function () { return Promise.all([refreshChats(), refreshProjects()]); })
      .then(function () {
        bindEvents();
        syncSidebarBtn();
        if (!state.activeChat || !chats.some(function (c) { return c.id === state.activeChat; })) {
          state.activeChat = chats.length ? chats[0].id : null;
        }
        renderSidebar();
        // With no agent configured there is nothing to connect to, so land on
        // the welcome pane rather than opening a chat that cannot be answered.
        if (!hasAgent()) return showWelcome();
        if (!state.activeChat) return newChat();
        return connectActiveChat();
      })
      .then(function () {
        renderSidebar();
        if (state.settings.autoOpenWorkbench && window.innerWidth > 1180) openWorkbench("artifact");
        if (state.artifact && state.artifact.source) renderArtifact();
      })
      .catch(function (err) {
        /* eslint-disable no-console */
        if (global.console) console.error("BIG A failed to start:", err);
        toast("Something went wrong starting up: " + (err && err.message), "err");
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : this);
