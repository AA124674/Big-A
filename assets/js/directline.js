/* ==========================================================================
   directline.js — BIG A native transport
   --------------------------------------------------------------------------
   The previous build put the agent inside a cross-origin <iframe> pointed at
   the Copilot Studio hosted canvas. That single decision caused most of the
   product's problems:

     * the teal header bar with the agent's name is Microsoft's own chrome
       INSIDE the frame, and cannot be removed or restyled from outside;
     * the transcript lives on Microsoft's servers, so it vanished on reload;
     * nothing in the frame could be selected, copied, dropped on, or themed,
       because the browser forbids reaching across an origin boundary.

   This module removes the frame. It speaks Direct Line 3.0 directly over
   REST + WebSocket, so every message is an ordinary DOM node in our page:
   copyable, styleable, persistable, and droppable.
   ========================================================================== */

(function (global) {
  "use strict";

  var DEFAULT_DOMAIN = "https://directline.botframework.com/v3/directline";
  var DEFAULT_API_VERSION = "2022-03-01-preview";

  function noop() {}

  /* --------------------------------------------------------- endpoint work */

  /**
   * Work out a Direct Line token endpoint from a Copilot Studio embed URL.
   *
   * The embed URL looks like:
   *   https://copilotstudio.microsoft.com/environments/{env}/bots/{schema}/webchat
   *
   * Copilot Studio's real token endpoint lives on the Power Platform
   * environment API, whose hostname is a hex slice of the environment ID.
   * That derivation is what Microsoft's own tooling does, but it is not
   * guaranteed for every environment, so this returns a LIST of candidates.
   * `discoverTokenEndpoint` tries each one and keeps the first that works.
   * If none do, the UI asks for the endpoint directly — a one-time step.
   */
  /** True when an environment segment is the "Default-{tenantId}" alias. */
  function isDefaultAlias(envRaw) {
    return /^Default-/i.test(String(envRaw || ""));
  }

  /**
   * Read the environment segment out of a Copilot Studio URL, if present.
   * Exposed so the UI can warn about the default-environment alias below.
   */
  function environmentSegment(embedUrl) {
    var u;
    try { u = new URL(embedUrl); } catch (e) { return ""; }
    var parts = u.pathname.split("/").filter(Boolean);
    var i = parts.indexOf("environments");
    return i === -1 ? "" : decodeURIComponent(parts[i + 1] || "");
  }

  function candidateEndpoints(embedUrl, envIdOverride) {
    var out = [];
    var u;
    try { u = new URL(embedUrl); } catch (e) { return out; }

    var parts = u.pathname.split("/").filter(Boolean);
    var envIdx = parts.indexOf("environments");
    var botIdx = parts.indexOf("bots");
    if (envIdx === -1 || botIdx === -1) return out;

    var envRaw = decodeURIComponent(parts[envIdx + 1] || "");
    var schema = decodeURIComponent(parts[botIdx + 1] || "");
    if (!envRaw || !schema) return out;

    var envIds = [];

    // An explicitly supplied environment ID always wins. This is not a nicety:
    // for the DEFAULT environment the URL reads "Default-{tenantId}", and the
    // tenant ID is NOT the environment ID. Stripping the prefix therefore
    // yields a GUID of the right shape that maps to a host which simply does
    // not exist, so the request fails with no useful explanation. The only
    // reliable source is Copilot Studio, Settings > Advanced > Metadata.
    if (envIdOverride) envIds.push(String(envIdOverride).trim());

    envIds.push(envRaw);
    if (isDefaultAlias(envRaw)) envIds.push(envRaw.replace(/^Default-/i, ""));

    envIds.forEach(function (id) {
      var hex = id.replace(/-/g, "").toLowerCase();
      // Only a real environment GUID maps to a hostname. Anything else (for
      // example the literal "Default-" prefix) would produce a host that
      // cannot resolve, so it is not worth a network round trip.
      if (!/^[0-9a-f]{32}$/.test(hex)) return;
      var prefix = hex.slice(0, hex.length - 2);
      var suffix = hex.slice(-2);
      var host = "https://" + prefix + "." + suffix + ".environment.api.powerplatform.com";
      if (out.indexOf(host) > -1) return;
      out.push(
        host +
        "/powervirtualagents/botsbyschema/" + encodeURIComponent(schema) +
        "/directline/token?api-version=" + DEFAULT_API_VERSION
      );
    });

    // Legacy host, still live for older agents.
    out.push(
      "https://powerva.microsoft.com/api/botmanagement/v1/directline/directlinetoken" +
      "?botSchema=" + encodeURIComponent(schema)
    );

    return out;
  }

  /** Pull a Direct Line token out of whatever shape the endpoint returns. */
  function readToken(data) {
    if (!data) return null;
    return data.token || data.accessToken || data.access_token ||
      (data.value && (data.value.token || data.value.accessToken)) || null;
  }

  function fetchToken(endpoint, bearer) {
    var opts = { method: "GET", headers: {} };
    if (bearer) opts.headers.Authorization = "Bearer " + bearer;

    return fetch(endpoint, opts).catch(function (netErr) {
      // fetch() rejects (rather than resolving with !ok) for DNS failures and
      // for CORS rejections. The browser deliberately hides which, so say so
      // instead of pretending it was an HTTP error.
      var e = new Error("Could not reach the token endpoint. The host may not exist, " +
        "or the browser blocked the request (CORS).");
      e.handled = true;
      e.network = true;
      e.cause = netErr;
      throw e;
    }).then(function (res) {
      if (!res.ok) {
        var hint = "";
        if (res.status === 400) {
          // The overwhelmingly common cause: this endpoint exists but does not
          // know this agent, because the agent lives on the newer service and
          // this was the older host (or vice versa). It is a "wrong door"
          // answer, not a problem with the agent.
          hint = " That endpoint does not recognise this agent, which usually means the " +
                 "address was guessed wrongly rather than anything being wrong with the agent.";
        } else if (res.status === 401 || res.status === 403) {
          hint = " The agent requires sign-in. Either set its security to " +
                 "\u201CNo authentication\u201D in Copilot Studio, or switch this agent to the " +
                 "Microsoft 365 Agents SDK mode.";
        } else if (res.status === 404) {
          hint = " No such token endpoint. If you have one, copy it from Copilot Studio: " +
                 "Settings \u203A Channels \u203A Mobile app \u203A Token Endpoint.";
        } else if (res.status >= 500) {
          hint = " The service failed to respond. This is usually temporary.";
        }
        var e = new Error("Token endpoint returned HTTP " + res.status + "." + hint);
        e.handled = true;
        e.status = res.status;
        throw e;
      }
      return res.json();
    }).then(function (data) {
      var token = readToken(data);
      if (!token) {
        var e = new Error("The endpoint replied, but with no Direct Line token in it.");
        e.handled = true;
        throw e;
      }
      return token;
    });
  }

  /**
   * Try each candidate endpoint in turn. Resolves with the endpoint that
   * produced a token, so it can be remembered and reused.
   */
  /**
   * How much a failure tells us, so the reported error is the informative one.
   *
   * This matters more than it looks. The candidates are tried newest host
   * first, legacy host last, and the legacy host answers 400 for any agent it
   * does not host. Reporting the LAST error therefore buried the real answer
   * under a meaningless "HTTP 400" every single time a modern agent was used.
   */
  function errorRank(err) {
    var s = err && err.status;
    if (s === 401 || s === 403) return 5;  // definitive: it exists, sign in
    if (s === 404) return 4;               // definitive: wrong address
    if (s >= 500) return 3;                // definitive: their fault
    if (err && err.network) return 2;      // could not even ask
    if (s === 400) return 1;               // "wrong door", least informative
    return 2;
  }

  function discoverTokenEndpoint(embedUrl, bearer, envId) {
    var list = candidateEndpoints(embedUrl, envId);
    if (!list.length) return Promise.reject(new Error("No token endpoint could be derived from that agent URL."));

    // Said up front, because it is the single most common reason discovery
    // fails and it is invisible from the error the network returns.
    var defaultEnvHint = !envId && isDefaultAlias(environmentSegment(embedUrl))
      ? " This agent is in the DEFAULT environment, whose URL shows \u201CDefault-\u201D followed by " +
        "your tenant ID rather than the environment ID, so the address cannot be worked out from " +
        "the URL alone. Paste the Environment ID from Copilot Studio: Settings \u203A Advanced \u203A " +
        "Metadata."
      : "";

    var best = null;
    var attempts = [];
    return list.reduce(function (chain, endpoint) {
      return chain.then(function (found) {
        if (found) return found;
        return fetchToken(endpoint, bearer)
          .then(function (token) { return { endpoint: endpoint, token: token }; })
          .catch(function (err) {
            attempts.push({ endpoint: endpoint, error: err.message, status: err.status || 0 });
            if (!best || errorRank(err) > errorRank(best)) best = err;
            return null;
          });
      });
    }, Promise.resolve(null)).then(function (found) {
      if (found) return found;
      var e = best || new Error("Could not reach any Direct Line token endpoint.");
      if (defaultEnvHint && e.message.indexOf("Environment ID") === -1) {
        e.message += defaultEnvHint;
        e.needsEnvId = true;
      }
      // Carry the full picture so the UI can show what was actually tried,
      // rather than a single status code with no context.
      e.attempts = attempts;
      e.handled = true;
      throw e;
    });
  }

  /**
   * Copilot Studio agents are deployed regionally. Never hard-code the global
   * Direct Line host; ask the environment which one this agent lives on.
   */
  function regionalDomain(tokenEndpoint) {
    var api, url;
    try {
      var u = new URL(tokenEndpoint);
      api = u.searchParams.get("api-version") || DEFAULT_API_VERSION;
      url = new URL("/powervirtualagents/regionalchannelsettings?api-version=" + api, u).toString();
    } catch (e) {
      return Promise.resolve(DEFAULT_DOMAIN);
    }
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var base = d && d.channelUrlsById && d.channelUrlsById.directline;
        return base ? new URL("v3/directline", base).toString() : DEFAULT_DOMAIN;
      })
      .catch(function () { return DEFAULT_DOMAIN; });
  }

  /* ------------------------------------------------------------- the client */

  /**
   * A single Direct Line conversation.
   *
   * opts: { domain, token, conversationId, watermark, userId, onActivity,
   *         onStatus, onError }
   *
   * `conversationId` + `watermark` let us RESUME a conversation the agent
   * still remembers after a reload, instead of starting from nothing.
   */
  function Client(opts) {
    this.domain = opts.domain || DEFAULT_DOMAIN;
    this.token = opts.token;
    this.conversationId = opts.conversationId || null;
    this.watermark = opts.watermark || null;
    this.userId = opts.userId || ("dl_" + (global.Store ? global.Store.uid() : Date.now()));
    this.onActivity = opts.onActivity || noop;
    this.onStatus = opts.onStatus || noop;
    this.onError = opts.onError || noop;

    this.socket = null;
    this.closed = false;
    this.retries = 0;
    this.pollTimer = null;
    this.seen = Object.create(null);
  }

  Client.prototype._headers = function (extra) {
    var h = { Authorization: "Bearer " + this.token };
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    return h;
  };

  /** Start a fresh conversation, or reattach to an existing one. */
  Client.prototype.start = function () {
    var self = this;
    self.onStatus("connecting");

    var req = self.conversationId
      ? fetch(self.domain + "/conversations/" + encodeURIComponent(self.conversationId) +
              (self.watermark ? "?watermark=" + encodeURIComponent(self.watermark) : ""),
              { headers: self._headers() })
      : fetch(self.domain + "/conversations", { method: "POST", headers: self._headers() });

    return req.then(function (res) {
      if (!res.ok) {
        // A resumed conversation may have expired server-side. Start clean.
        if (self.conversationId && (res.status === 403 || res.status === 404 || res.status === 400)) {
          self.conversationId = null;
          self.watermark = null;
          self.resumed = false;
          return fetch(self.domain + "/conversations", { method: "POST", headers: self._headers() })
            .then(function (r2) {
              if (!r2.ok) throw new Error("Direct Line refused to open a conversation (HTTP " + r2.status + ").");
              return r2.json();
            });
        }
        throw new Error("Direct Line refused the connection (HTTP " + res.status + ").");
      }
      self.resumed = !!self.conversationId;
      return res.json();
    }).then(function (conv) {
      self.conversationId = conv.conversationId;
      if (conv.token) self.token = conv.token;
      self.streamUrl = conv.streamUrl;
      self._openSocket();
      return conv;
    });
  };

  Client.prototype._openSocket = function () {
    var self = this;
    if (!self.streamUrl) { self._startPolling(); return; }

    var ws;
    try { ws = new WebSocket(self.streamUrl); }
    catch (e) { self._startPolling(); return; }

    self.socket = ws;

    ws.onopen = function () {
      self.retries = 0;
      self._stopPolling();
      self.onStatus("online");
    };

    ws.onmessage = function (ev) {
      if (!ev.data) return;           // keep-alive frame
      var payload;
      try { payload = JSON.parse(ev.data); } catch (e) { return; }
      if (payload.watermark) self.watermark = payload.watermark;
      (payload.activities || []).forEach(function (a) { self._emit(a); });
    };

    ws.onerror = function () { /* onclose always follows; handle it there */ };

    ws.onclose = function () {
      self.socket = null;
      if (self.closed) return;
      self.onStatus("reconnecting");
      self._reconnect();
    };
  };

  /** Exponential backoff, then fall back to polling so chat still works. */
  Client.prototype._reconnect = function () {
    var self = this;
    if (self.closed) return;
    self.retries += 1;

    if (self.retries > 5) { self._startPolling(); return; }

    var wait = Math.min(1000 * Math.pow(2, self.retries - 1), 15000);
    setTimeout(function () {
      if (self.closed) return;
      fetch(self.domain + "/conversations/" + encodeURIComponent(self.conversationId) +
            (self.watermark ? "?watermark=" + encodeURIComponent(self.watermark) : ""),
            { headers: self._headers() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (conv) {
          if (!conv) throw new Error("reconnect refused");
          if (conv.token) self.token = conv.token;
          self.streamUrl = conv.streamUrl;
          self._openSocket();
        })
        .catch(function () { self._reconnect(); });
    }, wait);
  };

  /* --- polling fallback, for networks that block or drop WebSockets ------ */

  Client.prototype._startPolling = function () {
    var self = this;
    if (self.pollTimer || self.closed) return;
    self.onStatus("online");
    self.pollTimer = setInterval(function () { self._poll(); }, 1400);
    self._poll();
  };

  Client.prototype._stopPolling = function () {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  };

  Client.prototype._poll = function () {
    var self = this;
    if (!self.conversationId || self.closed) return;
    fetch(self.domain + "/conversations/" + encodeURIComponent(self.conversationId) + "/activities" +
          (self.watermark ? "?watermark=" + encodeURIComponent(self.watermark) : ""),
          { headers: self._headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        if (d.watermark) self.watermark = d.watermark;
        (d.activities || []).forEach(function (a) { self._emit(a); });
      })
      .catch(noop);
  };

  /** De-duplicate: sockets and polling can both deliver the same activity. */
  Client.prototype._emit = function (activity) {
    if (!activity) return;
    var key = activity.id || (activity.timestamp + "|" + (activity.text || ""));
    if (this.seen[key]) return;
    this.seen[key] = 1;
    this.onActivity(activity);
  };

  /* ------------------------------------------------------------- outbound */

  Client.prototype.post = function (activity) {
    var self = this;
    var body = Object.assign({
      from: { id: self.userId, role: "user" },
      locale: (global.navigator && global.navigator.language) || "en-GB"
    }, activity);

    return fetch(self.domain + "/conversations/" + encodeURIComponent(self.conversationId) + "/activities", {
      method: "POST",
      headers: self._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("The message could not be delivered (HTTP " + res.status + ").");
      return res.json();
    });
  };

  Client.prototype.sendText = function (text, attachments) {
    var a = { type: "message", text: text };
    if (attachments && attachments.length) a.attachments = attachments;
    return this.post(a);
  };

  /** Fire the event Copilot Studio waits for before it will greet you. */
  Client.prototype.sendGreetingTrigger = function () {
    return this.post({
      type: "event",
      name: "startConversation",
      value: { text: "hello" }
    }).catch(noop);
  };

  /**
   * Upload real files to the conversation. Direct Line accepts multipart
   * form data on /upload and turns each part into an attachment.
   */
  Client.prototype.upload = function (fileList, text) {
    var self = this;
    var form = new FormData();

    if (text) {
      form.append("activity", new Blob([JSON.stringify({
        type: "message",
        text: text,
        from: { id: self.userId, role: "user" }
      })], { type: "application/vnd.microsoft.activity" }));
    }
    Array.prototype.forEach.call(fileList, function (f) { form.append("file", f, f.name); });

    return fetch(self.domain + "/conversations/" + encodeURIComponent(self.conversationId) +
                 "/upload?userId=" + encodeURIComponent(self.userId), {
      method: "POST",
      headers: self._headers(),
      body: form
    }).then(function (res) {
      if (!res.ok) throw new Error("The attachment upload was rejected (HTTP " + res.status + ").");
      return res.json().catch(function () { return {}; });
    });
  };

  Client.prototype.end = function () {
    this.closed = true;
    this._stopPolling();
    if (this.socket) { try { this.socket.close(); } catch (e) { noop(); } }
    this.socket = null;
  };

  /* ---------------------------------------------------------------- facade */

  /**
   * Everything needed to get talking, in one call.
   * opts: { agentUrl, tokenEndpoint, bearer, conversationId, watermark,
   *         userId, onActivity, onStatus, onError }
   */
  function connect(opts) {
    // A configured endpoint is tried first, but is not allowed to be the only
    // attempt. Endpoints get saved once and then go stale when an agent is
    // republished, and previously that left the agent permanently unreachable
    // with no way to recover short of clearing the setting by hand.
    var endpointStep = opts.tokenEndpoint
      ? fetchToken(opts.tokenEndpoint, opts.bearer)
          .then(function (token) { return { endpoint: opts.tokenEndpoint, token: token }; })
          .catch(function (err) {
            if (!opts.agentUrl) throw err;
            return discoverTokenEndpoint(opts.agentUrl, opts.bearer, opts.envId)
              .catch(function () { throw err; });
          })
      : discoverTokenEndpoint(opts.agentUrl, opts.bearer, opts.envId);

    return endpointStep.then(function (found) {
      return regionalDomain(found.endpoint).then(function (domain) {
        var client = new Client({
          domain: domain,
          token: found.token,
          conversationId: opts.conversationId,
          watermark: opts.watermark,
          userId: opts.userId,
          onActivity: opts.onActivity,
          onStatus: opts.onStatus,
          onError: opts.onError
        });
        return client.start().then(function () {
          client.tokenEndpoint = found.endpoint;
          return client;
        });
      });
    });
  }

  global.DirectLine = {
    connect: connect,
    Client: Client,
    fetchToken: fetchToken,
    discoverTokenEndpoint: discoverTokenEndpoint,
    candidateEndpoints: candidateEndpoints,
    environmentSegment: environmentSegment,
    isDefaultAlias: isDefaultAlias,
    regionalDomain: regionalDomain,
    DEFAULT_DOMAIN: DEFAULT_DOMAIN
  };
})(typeof window !== "undefined" ? window : this);
