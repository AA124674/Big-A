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

  var DEFAULT_AGENT_URL =
    "https://copilotstudio.microsoft.com/environments/Default-e0a762aa-f74f-473a-b086-4ceaefb71fbd" +
    "/bots/bgstest_claude_rxWJjM/webchat?__version__=2&enableFileAttachment=true&cliAgent=true";

  /* The agent's own name is the only label used for it anywhere in the UI:
     in the switcher, in the sidebar, and on each of its messages. */
  var DEFAULT_AGENT_NAME = "Claude";

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
    plug: '<path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0zM12 18v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
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
    agents: [],
    activeAgent: "default",
    activeChat: null,
    settings: { fileAttach: true, autoOpenWorkbench: true },
    connection: {
      // Current transport: Copilot Studio via the Microsoft 365 Agents SDK.
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
      tokenEndpoint: ""
    },
    artifact: { title: "Untitled document", type: "markdown", source: "" },
    log: []
  };

  var chats = [];       // cached from Store
  var projects = [];    // cached from Store

  function savePrefs() {
    return Promise.all([
      Store.kv.set("theme", state.theme),
      Store.kv.set("agents", state.agents),
      Store.kv.set("activeAgent", state.activeAgent),
      Store.kv.set("activeChat", state.activeChat),
      Store.kv.set("settings", state.settings),
      Store.kv.set("connection", state.connection),
      Store.kv.set("artifact", state.artifact)
    ]).catch(function () { /* storage full or blocked: keep running */ });
  }

  function loadPrefs() {
    return Store.kv.all().then(function (kv) {
      var seedAgent = {
        id: "default",
        name: DEFAULT_AGENT_NAME,
        desc: "Your Copilot Studio agent",
        url: DEFAULT_AGENT_URL,
        builtin: true
      };

      if (kv.theme) state.theme = kv.theme;
      if (kv.settings && typeof kv.settings === "object") {
        Object.keys(state.settings).forEach(function (k) {
          if (typeof kv.settings[k] === "boolean") state.settings[k] = kv.settings[k];
        });
      }
      if (kv.artifact && typeof kv.artifact === "object") state.artifact = kv.artifact;

      state.agents = Array.isArray(kv.agents) && kv.agents.length ? kv.agents : [seedAgent];
      if (!state.agents.some(function (a) { return a.id === "default"; })) state.agents.unshift(seedAgent);

      // An earlier build shipped the agent under a generic label. The agent's
      // real name is what the interface should show, so migrate it once.
      state.agents.forEach(function (a) {
        if (a.builtin && /^general assistant$/i.test(a.name || "")) a.name = DEFAULT_AGENT_NAME;
      });

      state.activeAgent = kv.activeAgent && state.agents.some(function (a) { return a.id === kv.activeAgent; })
        ? kv.activeAgent : state.agents[0].id;
      state.activeChat = kv.activeChat || null;

      var conn = kv.connection;
      if (conn && typeof conn === "object") {
        Object.keys(state.connection).forEach(function (k) {
          if (typeof conn[k] === "string") state.connection[k] = conn[k];
        });
      }
      if (["iframe", "m365", "directline", "sso"].indexOf(state.connection.mode) === -1) {
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
      var source = c.connectionString || (currentAgent() && currentAgent().url) || DEFAULT_AGENT_URL;
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

    if (!c.scope && global.Connect) c.scope = global.Connect.DEFAULT_AGENT_SCOPE;
  }

  function uid() { return Store.uid(); }

  function currentAgent() {
    return state.agents.filter(function (a) { return a.id === state.activeAgent; })[0] || state.agents[0];
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
    state.theme = t;
    document.documentElement.setAttribute("data-theme", t);
    $("#theme-btn").innerHTML = icon(t === "dark" ? "sun" : "moon");
    $("#theme-btn").setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
    Store.kv.set("theme", t);
  }

  /* ------------------------------------------------------- connection pill */

  var STATUS_TEXT = {
    connecting: ["Connecting", "warn"],
    signin: ["Signing in", "warn"],
    online: ["Live", "secure"],
    reconnecting: ["Reconnecting", "warn"],
    offline: ["Offline", "err"],
    embed: ["Legacy embed", "warn"]
  };

  var MODE_LABEL = {
    m365: "Microsoft 365 Agents SDK",
    directline: "Direct Line (legacy)",
    sso: "Direct Line + single sign-on (legacy)",
    iframe: "Legacy embed"
  };

  function setStatus(kind, detail) {
    var el = $("#conn-status");
    var map = STATUS_TEXT[kind] || ["", ""];
    el.textContent = map[0];
    el.className = "conn-pill " + map[1];
    // The tooltip carries the detail: which transport, and what went wrong.
    el.title = [MODE_LABEL[state.connection.mode] || "", detail || map[0]]
      .filter(Boolean).join(" · ");
  }

  /* ----------------------------------------------------- agent connection */

  /** Legacy path: the old embedded canvas, kept only as an escape hatch. */
  function loadEmbed() {
    var agent = currentAgent();
    var frame = $("#agent-frame");
    Chat.disconnect();
    $("#chat-surface").hidden = true;
    frame.hidden = false;
    try {
      var u = new URL(agent.url);
      u.searchParams.set("enableFileAttachment", "true");
      frame.src = u.toString();
    } catch (e) { frame.src = agent.url; }
    setStatus("embed", "Embedded canvas: messages are not stored locally");
    logEvent("Legacy embed loaded", agent.name, "warn");
  }

  /** Current path: Direct-to-Engine over the Microsoft 365 Agents SDK. */
  function connectActiveChat() {
    var agent = currentAgent();
    $("#agent-frame").hidden = true;
    $("#agent-frame").src = "about:blank";
    $("#chat-surface").hidden = false;

    Chat.setAgent(agent);
    $("#agent-name").textContent = agent.name;
    $("#wb-agent").textContent = agent.name;
    $("#chat-empty-title").textContent = "How can I help today?";
    document.title = agent.name + " · BIG A";

    if (state.connection.mode === "iframe") { loadEmbed(); return Promise.resolve(); }

    if (state.connection.mode === "m365") return connectViaAgentsSdk(agent);

    var bearerStep = state.connection.mode === "sso" && global.Connect
      ? global.Connect.acquireToken(state.connection).then(function (res) {
          renderAccount();
          return res.accessToken;
        })
      : Promise.resolve(null);

    return bearerStep.then(function (bearer) {
      return Chat.open(state.activeChat, {
        transport: "directline",
        bearer: bearer,
        tokenEndpoint: state.connection.tokenEndpoint || agent.tokenEndpoint || ""
      });
    }).catch(function (err) {
      setStatus("offline", err && err.message);
      logEvent("Connection failed", err && err.message, "err");
    });
  }

  /**
   * Agent settings for the active agent: per-agent overrides win, otherwise
   * the global connection settings apply.
   */
  function agentSettings(agent) {
    var c = state.connection;
    var s = {
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
    if (agent && agent.m365 && typeof agent.m365 === "object") {
      Object.keys(agent.m365).forEach(function (k) {
        if (agent.m365[k]) s[k] = agent.m365[k];
      });
    }
    return s;
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
        scopes: [settings.scope || global.Connect.DEFAULT_AGENT_SCOPE],
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
      $("#composer-input").focus();
      logEvent("New chat started", currentAgent().name, "ok");
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
    var name = prompt("Rename this chat", chat.title);
    if (name == null) return;
    chat.title = name.trim() || chat.title;
    Store.chats.put(chat).then(refreshChats).then(renderSidebar);
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

  function renderAgents() {
    var host = $("#agent-list");
    host.innerHTML = state.agents.map(function (a) {
      return '<li><button class="side-item' + (a.id === state.activeAgent ? " active" : "") +
        '" data-agent="' + a.id + '"><span class="dot-agent"></span><span class="txt"></span>' +
        (a.builtin ? "" : '<span class="row-acts"><span class="del" data-agentdel="' + a.id +
          '" role="button" tabindex="0" aria-label="Remove agent">' + icon("trash") + "</span></span>") +
        "</button></li>";
    }).join("");
    $$("[data-agent]", host).forEach(function (btn, i) { $(".txt", btn).textContent = state.agents[i].name; });
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
    var name = prompt("Name this project");
    if (name == null) return;
    name = name.trim();
    if (!name) return;
    var p = { id: uid(), name: name, order: projects.length, collapsed: false };
    Store.projects.put(p).then(refreshProjects).then(function () {
      renderProjects();
      toast('Created "' + name + '"');
      logEvent("Project created", name, "ok");
    });
  }

  function renameProject(id) {
    var p = projects.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var name = prompt("Rename project", p.name);
    if (name == null) return;
    p.name = name.trim() || p.name;
    Store.projects.put(p).then(refreshProjects).then(renderProjects);
  }

  function deleteProject(id) {
    var p = projects.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var kids = chats.filter(function (c) { return c.projectId === id; });
    var msg = kids.length
      ? 'Delete "' + p.name + '"? Its ' + kids.length + ' chat(s) move back to Recents.'
      : 'Delete "' + p.name + '"?';
    if (!confirm(msg)) return;

    Promise.all(kids.map(function (c) { c.projectId = null; return Store.chats.put(c); }))
      .then(function () { return Store.projects.remove(id); })
      .then(function () { return Promise.all([refreshChats(), refreshProjects()]); })
      .then(function () { renderSidebar(); toast("Project deleted"); });
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
    } else if (type === "html") {
      view.innerHTML = src;
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

      var replace = confirm(
        "Replace this workspace with the backup?\n\n" +
        "OK  = replace everything\nCancel = merge the backup into what is already here"
      );
      Store.importAll(data, { replace: replace })
        .then(function (r2) {
          return Promise.all([refreshChats(), refreshProjects(), loadPrefs()]).then(function () { return r2; });
        })
        .then(function (r2) {
          renderSidebar();
          toast("Restored " + r2.chats + " chats");
          logEvent("Workspace restored", r2.messages + " messages", "ok");
          if (chats.length) { state.activeChat = chats[0].id; savePrefs(); connectActiveChat(); }
        })
        .catch(function (err) { toast(err.message, "err"); });
    };
    r.readAsText(file);
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
    $("#scrim").classList.remove("open");
    $$(".modal").forEach(function (m) { m.classList.remove("open"); });
    $$(".menu").forEach(function (m) { m.classList.remove("open"); });
  }

  function openAgentModal() {
    $("#agent-form-name").value = "";
    $("#agent-form-url").value = "";
    $("#agent-form-desc").value = "";
    openModal("#agent-modal");
    setTimeout(function () { $("#agent-form-name").focus(); }, 40);
  }

  /* --------------------------------------------------- connection & sign-in */

  var MODE_HINTS = {
    m365: "Recommended. This page talks to the agent directly using the Microsoft 365 Agents SDK " +
          "protocol, the replacement for the retired token endpoint. Copy the connection string from " +
          "Copilot Studio → Channels, and sign in with Microsoft. Streaming replies, progress detail, " +
          "file attachments, drag and drop and local history all work.",
    directline: "Legacy. Uses a Direct Line token endpoint, which Copilot Studio no longer issues for " +
                "new agents. Keep this only for an existing agent that still has one.",
    sso: "Legacy, plus single sign-on: you sign in with Microsoft up front and BIG A answers the " +
         "agent's sign-in card for you. Requires an Entra ID app registration and a working token endpoint.",
    iframe: "Fallback. Loads the agent's own embedded canvas. It cannot be restyled, its messages " +
            "cannot be copied or stored, and files cannot be dropped into it. Use only if a direct " +
            "connection cannot be made."
  };

  function syncConnFields() {
    var mode = $("#conn-mode").value;
    $("#conn-mode-hint").textContent = MODE_HINTS[mode] || "";
    $("#conn-fields").hidden = mode === "iframe";
    $("#conn-m365-fields").hidden = mode !== "m365";
    $("#conn-legacy-fields").hidden = !(mode === "directline" || mode === "sso");
    // Entra ID details are needed by the Agents SDK and by single sign-on.
    $("#conn-sso-fields").hidden = !(mode === "m365" || mode === "sso");
    var clientHint = $("#conn-client-hint");
    if (clientHint) {
      clientHint.textContent = mode === "m365"
        ? "Required. A single-page-application registration with the delegated Power Platform API " +
          "permission CopilotStudio.Copilots.Invoke, granted admin consent."
        : "Required for single sign-on only.";
    }
    var resolved = $("#conn-resolved");
    if (resolved) resolved.textContent = describeTarget();
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

  function readConnForm() {
    return {
      connectionString: $("#conn-string").value.trim(),
      directConnectUrl: $("#conn-direct-url").value.trim(),
      environmentId: $("#conn-env-id").value.trim(),
      schemaName: $("#conn-schema").value.trim(),
      cloud: $("#conn-cloud").value,
      agentType: $("#conn-agent-type").value,
      clientId: $("#conn-client-id").value.trim(),
      tenantId: $("#conn-tenant-id").value.trim(),
      scope: $("#conn-scope").value.trim()
    };
  }

  /**
   * Copilot Studio hands out one connection string; pasting it should fill in
   * everything it contains rather than making anyone pick it apart by hand.
   */
  function applyConnectionString() {
    var raw = $("#conn-string").value.trim();
    if (!raw || !global.M365Agents) return;
    var p;
    try {
      p = global.M365Agents.parseConnection(raw);
    } catch (e) {
      toast(e.message, "err");
      return;
    }
    if (p.environmentId) $("#conn-env-id").value = p.environmentId;
    if (p.schemaName) $("#conn-schema").value = p.schemaName;
    if (p.directConnectUrl) $("#conn-direct-url").value = p.directConnectUrl;
    if (p.tenantId) $("#conn-tenant-id").value = p.tenantId;
    if (p.clientId) $("#conn-client-id").value = p.clientId;
    if (p.cloud) $("#conn-cloud").value = p.cloud;
    if (p.agentType) $("#conn-agent-type").value = p.agentType;
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

  function openConnectModal() {
    var c = state.connection;
    $("#conn-mode").value = c.mode;
    $("#conn-string").value = c.connectionString || "";
    $("#conn-direct-url").value = c.directConnectUrl || "";
    $("#conn-env-id").value = c.environmentId || "";
    $("#conn-schema").value = c.schemaName || "";
    $("#conn-cloud").value = c.cloud || "prod";
    $("#conn-agent-type").value = c.agentType || "published";
    $("#conn-token-endpoint").value = c.tokenEndpoint;
    $("#conn-client-id").value = c.clientId;
    $("#conn-tenant-id").value = c.tenantId;
    $("#conn-scope").value = c.scope || (global.Connect ? global.Connect.DEFAULT_AGENT_SCOPE : "");
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

    var scopes = [s.scope || global.Connect.DEFAULT_AGENT_SCOPE];
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
        scopes: [s.scope || global.Connect.DEFAULT_AGENT_SCOPE],
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

  /** Legacy helper. Copilot Studio no longer publishes token endpoints for new agents. */
  function detectEndpoint() {
    var btn = $("#conn-detect");
    var agent = currentAgent();
    btn.disabled = true;
    btn.textContent = "Detecting…";
    global.DirectLine.discoverTokenEndpoint(agent.url, null)
      .then(function (found) {
        $("#conn-token-endpoint").value = found.endpoint;
        toast("Found a working token endpoint");
        logEvent("Token endpoint detected", found.endpoint, "ok");
      })
      .catch(function (err) {
        toast("Could not detect it automatically — paste it from Copilot Studio.", "err");
        logEvent("Endpoint detection failed", err.message, "warn");
      })
      .then(function () { btn.disabled = false; btn.textContent = "Detect automatically"; });
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
    if (mode === "directline" && !endpoint) {
      toast("Direct Line needs a token endpoint. If Copilot Studio no longer shows one, use the Agents SDK instead.", "err");
      return;
    }

    state.connection = {
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
      scope: form.scope
    };
    savePrefs();
    closeModals();
    logEvent("Connection settings saved", mode, "ok");
    toast("Reconnecting…");
    connectActiveChat();
  }

  function saveAgent() {
    var name = $("#agent-form-name").value.trim();
    var url = $("#agent-form-url").value.trim();
    if (!name || !url) { toast("Give the agent a name and a URL.", "err"); return; }
    if (!/^https:\/\//i.test(url)) { toast("The URL must start with https://", "err"); return; }
    var a = { id: uid(), name: name, url: url, desc: $("#agent-form-desc").value.trim(), builtin: false };
    state.agents.push(a);
    state.activeAgent = a.id;
    savePrefs();
    renderAgents();
    renderAgentMenu();
    closeModals();
    toast("Added " + name);
    newChat();
  }

  function renderAgentMenu() {
    var host = $("#agent-menu");
    host.innerHTML = '<div class="menu-label">Switch agent</div>' +
      state.agents.map(function (a) {
        return '<button class="menu-item' + (a.id === state.activeAgent ? " sel" : "") + '" data-pick="' + a.id + '">' +
          icon("bot") + '<span class="body"><span class="nm"></span><span class="sub"></span></span>' +
          (a.id === state.activeAgent ? icon("check") : "") + "</button>";
      }).join("") +
      '<div class="menu-sep"></div><button class="menu-item" data-addagent="1">' + icon("plus") +
      "<span class='body'>Add an agent…</span></button>";
    $$("[data-pick]", host).forEach(function (btn, i) {
      $(".nm", btn).textContent = state.agents[i].name;
      $(".sub", btn).textContent = state.agents[i].desc || "Copilot Studio agent";
    });
  }

  /* ---------------------------------------------------------------- layout */

  function toggleSidebar() {
    var app = $(".app");
    if (window.innerWidth <= 960) app.classList.toggle("sidebar-open");
    else app.classList.toggle("sidebar-collapsed");
  }

  function toggleZen() {
    document.body.classList.toggle("zen");
    var on = document.body.classList.contains("zen");
    $("#zen-btn").setAttribute("aria-pressed", String(on));
    toast(on ? "Focus mode on — press Esc to exit" : "Focus mode off");
  }

  /* ------------------------------------------------------------------ init */

  function bindEvents() {
    $("#reload-btn").addEventListener("click", function () { connectActiveChat(); toast("Reconnecting"); });
    $("#zen-btn").addEventListener("click", toggleZen);
    $("#theme-btn").addEventListener("click", function () { applyTheme(state.theme === "dark" ? "light" : "dark"); });
    $("#wb-btn").addEventListener("click", toggleWorkbench);
    $("#wb-close").addEventListener("click", function () { $(".app").classList.remove("workbench-open"); });
    $("#sidebar-btn").addEventListener("click", toggleSidebar);
    $("#sidebar-collapse").addEventListener("click", toggleSidebar);
    $("#palette-btn").addEventListener("click", openPalette);

    // Sidebar
    $("#new-chat").addEventListener("click", function () { newChat(); });
    $("#side-search").addEventListener("input", function () { renderRecents(); renderProjects(); });
    $("#add-agent").addEventListener("click", openAgentModal);
    $("#add-project").addEventListener("click", addProject);

    $("#chat-list").addEventListener("click", onChatListClick);
    $("#project-list").addEventListener("click", onProjectListClick);

    $("#agent-list").addEventListener("click", function (e) {
      var del = e.target.closest("[data-agentdel]");
      if (del) {
        e.stopPropagation();
        state.agents = state.agents.filter(function (a) { return a.id !== del.dataset.agentdel; });
        if (state.activeAgent === del.dataset.agentdel) state.activeAgent = state.agents[0].id;
        savePrefs(); renderAgents(); renderAgentMenu(); connectActiveChat();
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
    $("#agent-save").addEventListener("click", saveAgent);
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
    $("#connect-btn").addEventListener("click", openConnectModal);
    $("#conn-mode").addEventListener("change", syncConnFields);
    $("#conn-save").addEventListener("click", saveConnection);
    $("#conn-detect").addEventListener("click", detectEndpoint);
    $("#conn-string").addEventListener("change", applyConnectionString);
    $("#conn-string").addEventListener("paste", function () { setTimeout(applyConnectionString, 0); });
    $("#conn-apply-string").addEventListener("click", applyConnectionString);
    $("#conn-signin").addEventListener("click", function () { connectSignIn(false); });
    $("#conn-signin-redirect").addEventListener("click", function () { connectSignIn(true); });
    $("#conn-test").addEventListener("click", testConnection);
    ["#conn-env-id", "#conn-schema", "#conn-cloud", "#conn-agent-type", "#conn-direct-url"].forEach(function (sel) {
      $(sel).addEventListener("change", syncConnFields);
    });
    $$("#conn-setup").forEach(function (b) { b.addEventListener("click", openConnectModal); });
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

    $("#reset-btn").addEventListener("click", function () {
      if (!confirm("Delete every saved chat, message, project and preference from this browser?\n" +
                   "Back up first if you might want them again.")) return;
      Store.wipe().then(function () {
        try { localStorage.clear(); } catch (e) { /* ignore */ }
        location.reload();
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
    // Paint the stored theme before anything else, so there is no flash.
    try {
      var t = localStorage.getItem(THEME_KEY);
      if (t) document.documentElement.setAttribute("data-theme", t);
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
              if (el && el.textContent === "Live") el.title = MODE_LABEL[state.connection.mode] + " · " + label;
            },
            onConnected: function (c) {
              logEvent(
                "Connected",
                currentAgent().name + " · " + (MODE_LABEL[state.connection.mode] || "") +
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
        if (!state.activeChat || !chats.some(function (c) { return c.id === state.activeChat; })) {
          state.activeChat = chats.length ? chats[0].id : null;
        }
        renderSidebar();
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
