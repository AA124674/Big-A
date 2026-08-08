/* ==========================================================================
   m365agents.js — BIG A transport for the Microsoft 365 Agents SDK
   --------------------------------------------------------------------------
   Copilot Studio has retired the "Token endpoint" that older custom canvases
   relied on. Agents created or republished now expose a **Microsoft 365
   Agents SDK connection string** instead, and are reached over the
   Direct-to-Engine protocol:

     POST {base}/conversations?api-version=2022-03-01-preview
     POST {base}/conversations/{conversationId}?api-version=2022-03-01-preview

   where {base} is

     https://{env}.environment.api.powerplatform.com
       /copilotstudio/dataverse-backed/authenticated/bots/{schemaName}

   Both calls answer with a Server-Sent Events stream of Bot Framework
   activities, which is what lets this client show partial answers, tool
   progress and "searching the web" notices while the agent is still working.

   Authentication is an Entra ID user token (MSAL, delegated permission
   Power Platform API → CopilotStudio.Copilots.Invoke). There is no anonymous
   mode on this protocol — that is the deliberate trade for the retired
   token endpoint.

   This module deliberately mirrors the surface of directline.js
   (start / post / sendText / upload / sendGreetingTrigger / end) so the chat
   surface can drive either transport without caring which is in use.
   ========================================================================== */

(function (global) {
  "use strict";

  var API_VERSION = "2022-03-01-preview";

  /* Endpoint patterns per Power Platform cloud. `idSuffix` is how many
     characters of the environment ID are split off as the DNS label. */
  var CLOUDS = {
    prod:     { host: "environment.api.powerplatform.com",                  idSuffix: 2, scopeHost: "https://api.powerplatform.com" },
    preprod:  { host: "environment.api.preprod.powerplatform.com",          idSuffix: 1, scopeHost: "https://api.preprod.powerplatform.com" },
    gov:      { host: "environment.api.gov.powerplatform.microsoft.us",     idSuffix: 1, scopeHost: "https://api.gov.powerplatform.microsoft.us" },
    high:     { host: "environment.api.high.powerplatform.microsoft.us",    idSuffix: 1, scopeHost: "https://api.high.powerplatform.microsoft.us" },
    dod:      { host: "environment.api.appsplatform.us",                    idSuffix: 1, scopeHost: "https://api.appsplatform.us" },
    mooncake: { host: "environment.api.powerplatform.partner.microsoftonline.cn", idSuffix: 1, scopeHost: "https://api.powerplatform.partner.microsoftonline.cn" }
  };

  var INVOKE_SCOPE = "CopilotStudio.Copilots.Invoke";

  function noop() {}

  function cloudInfo(cloud) {
    return CLOUDS[String(cloud || "prod").toLowerCase()] || CLOUDS.prod;
  }

  /** The delegated scope MSAL must ask for, for a given cloud. */
  function scopeForCloud(cloud) {
    return cloudInfo(cloud).scopeHost + "/" + INVOKE_SCOPE;
  }

  /* ------------------------------------------------------- settings input */

  /**
   * Turn an environment ID into the environment's API hostname.
   * "00000000-1111-2222-3333-444444444444" becomes
   * "0000000011112222333344444444.44.environment.api.powerplatform.com":
   * the dashes are stripped and the last few characters become the sub-domain.
   */
  function environmentHost(environmentId, cloud) {
    var info = cloudInfo(cloud);
    var hex = String(environmentId || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
    if (hex.length < 8) return null;
    var prefix = hex.slice(0, hex.length - info.idSuffix);
    var suffix = hex.slice(hex.length - info.idSuffix);
    return "https://" + prefix + "." + suffix + "." + info.host;
  }

  /**
   * Build the Direct-to-Engine base URL.
   * settings: { directConnectUrl, environmentId, schemaName, cloud, agentType }
   */
  function baseUrl(settings) {
    settings = settings || {};

    if (settings.directConnectUrl) {
      var raw = String(settings.directConnectUrl).trim();
      var u;
      try { u = new URL(raw); } catch (e) { return null; }
      // Never send an Entra bearer token to an arbitrary pasted origin.
      // Direct-connect URLs issued by Copilot Studio always use a Power
      // Platform environment API host, including sovereign-cloud variants.
      var approvedHost = Object.keys(CLOUDS).some(function (name) {
        var suffix = "." + CLOUDS[name].host.toLowerCase();
        return u.hostname.toLowerCase().slice(-suffix.length) === suffix;
      });
      if (u.protocol !== "https:" || !approvedHost) return null;
      // Accept a full conversations URL too, and trim back to the bot root.
      var path = u.pathname.replace(/\/+$/, "");
      path = path.replace(/\/conversations(\/[^/]*)?$/i, "");
      if (!/\/copilotstudio\/(dataverse-backed|prebuilt)\/authenticated\/bots\/[^/]+$/i.test(path)) return null;
      return u.origin + path;
    }

    var host = environmentHost(settings.environmentId, settings.cloud);
    var schema = String(settings.schemaName || settings.agentIdentifier || "").trim();
    if (!host || !schema) return null;

    var kind = /prebuilt/i.test(settings.agentType || "") ? "prebuilt" : "dataverse-backed";
    return host + "/copilotstudio/" + kind + "/authenticated/bots/" + encodeURIComponent(schema);
  }

  /**
   * Read whatever the user pasted from Copilot Studio → Channels →
   * Web app / Native app → "Microsoft 365 Agents SDK".
   *
   * Microsoft has shipped that value in more than one shape, so this is
   * deliberately tolerant: it accepts a semicolon-delimited connection
   * string, a JSON object, a bare Direct-to-Engine URL, or a legacy
   * Copilot Studio webchat/embed URL, and returns whatever it could work out.
   */
  function parseConnection(input) {
    var out = { directConnectUrl: "", environmentId: "", schemaName: "", tenantId: "", clientId: "", cloud: "", agentType: "" };
    var text = String(input || "").trim();
    if (!text) return out;

    /* An HTML snippet — the "Embed code" from Channels arrives as a whole
       <iframe src="..."> block, or even a full page. Pull the URLs out of it
       and treat those as the input, so the user can paste what they copied
       rather than surgically extracting the address first. */
    if (/<\s*(iframe|html|body|script)\b/i.test(text) || /src\s*=\s*["']https?:/i.test(text)) {
      var urls = text.match(/https?:\/\/[^\s"'<>()]+/gi) || [];
      var picked = urls.filter(function (u) {
        return /copilotstudio|powerplatform|powervirtualagents/i.test(u);
      })[0] || urls[0];
      if (picked) return normalise(fromUrl(out, picked.replace(/&amp;/gi, "&")));
    }

    /* A pasted "Session details" panel, or any block of "Label: value" lines.
       Copilot Studio's own diagnostics page reports the tenant, environment
       and route this way, and it is the quickest thing to hand for most
       people, so it is accepted verbatim. */
    if (/^\s*[A-Za-z][A-Za-z0-9 ()/.-]{2,40}:\s*\S/m.test(text) && !/^[A-Za-z]+=/.test(text)) {
      var labelled = readLabelledBlock(text, out);
      if (labelled) return normalise(out);
    }

    /* JSON object */
    if (/^[[{]/.test(text)) {
      try {
        var obj = JSON.parse(text);
        Object.keys(obj || {}).forEach(function (k) { assign(out, k, obj[k]); });
        return normalise(out);
      } catch (e) { /* fall through to the other parsers */ }
    }

    /* A bare URL. Tested before key=value parsing because a URL's own query
       string contains "=" and would otherwise be shredded into nonsense
       pairs — which is exactly how an existing agent URL is recognised. */
    if (/^https?:\/\/\S+$/i.test(text) && !/\s/.test(text)) {
      return normalise(fromUrl(out, text));
    }

    /* key=value pairs, separated by ; or newlines */
    var pairs = text.split(/[;\n\r]+/);
    var sawPair = false;
    pairs.forEach(function (chunk) {
      var i = chunk.indexOf("=");
      if (i === -1) return;
      // Do not mistake a URL value's query string for another pair.
      if (/^\s*https?:\/\//i.test(chunk)) { fromUrl(out, chunk.trim()); sawPair = true; return; }
      sawPair = true;
      assign(out, chunk.slice(0, i), chunk.slice(i + 1));
    });

    if (!sawPair && /^https?:\/\//i.test(text)) fromUrl(out, text);
    return normalise(out);
  }

  /**
   * Read "Label: value" lines (the shape of Copilot Studio's Session details
   * panel). Returns true when something usable was found, so the caller knows
   * not to fall through to the key=value parser.
   */
  function readLabelledBlock(text, out) {
    var found = false;
    String(text).split(/[\r\n]+/).forEach(function (line) {
      var m = /^\s*([A-Za-z][A-Za-z0-9 ()/._-]{2,40}?)\s*:\s*(.+?)\s*$/.exec(line);
      if (!m) return;
      var label = m[1].trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      var value = m[2].trim();
      if (!value || /^not available$/i.test(value)) return;

      // A route or instance URL carries the identifiers in its path.
      if (label === "route" || label === "uiorigin" || label === "instanceurl" ||
          label === "apilocation" || label === "hostname") {
        if (/^\/?environments\//i.test(value)) {
          fromUrl(out, "https://copilotstudio.microsoft.com" + (value.charAt(0) === "/" ? "" : "/") + value);
          found = true;
        }
        return;
      }
      if (label === "environment" || label === "environmentname" || label === "username" ||
          label === "sessionid" || label === "objectid" || label === "useragent" ||
          label === "timestamp" || label === "theme") return;

      if (label === "environmentid") {
        out.environmentId = value.replace(/^Default-/i, "");
        found = true;
        return;
      }
      if (label === "tenantid") { out.tenantId = value; found = true; return; }
      if (label === "schemaname" || label === "agentschemaname" || label === "botschemaname") {
        out.schemaName = value; found = true; return;
      }
      if (label === "clusterenvironment" || label === "clustercategory") {
        if (/preprod|test/i.test(value)) { out.cloud = "preprod"; found = true; }
        return;
      }
      if (label === "connectionstring") {
        var inner = parseConnection(value);
        Object.keys(inner).forEach(function (k) { if (inner[k] && !out[k]) out[k] = inner[k]; });
        found = true;
      }
    });
    return found;
  }

  function assign(out, key, value) {
    var k = String(key || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    var v = String(value == null ? "" : value).trim().replace(/^["']|["']$/g, "");
    if (!v) return;

    if (k === "directconnecturl" || k === "connecturl" || k === "endpoint" || k === "url") {
      // A legacy webchat URL sometimes arrives under these keys.
      if (/copilotstudio\.microsoft\.com/i.test(v)) { fromUrl(out, v); return; }
      out.directConnectUrl = v;
      return;
    }
    if (k === "environmentid" || k === "envid") { out.environmentId = v; return; }
    if (k === "schemaname" || k === "agentidentifier" || k === "botidentifier" ||
        k === "botschema" || k === "schema") { out.schemaName = v; return; }
    if (k === "tenantid" || k === "directorytenantid") { out.tenantId = v; return; }
    if (k === "appclientid" || k === "clientid" || k === "agentappid" || k === "applicationid") { out.clientId = v; return; }
    if (k === "cloud" || k === "powerplatformcloud") { out.cloud = v; return; }
    if (k === "copilotagenttype" || k === "agenttype") { out.agentType = v; return; }
    if (k === "authorityendpoint" || k === "authority") { out.authority = v; return; }
  }

  /** Pull environment + schema out of any Copilot Studio URL shape. */
  function fromUrl(out, url) {
    var u;
    try { u = new URL(url); } catch (e) { return out; }

    if (/environment\.api\./i.test(u.hostname) || /\/copilotstudio\//i.test(u.pathname)) {
      out.directConnectUrl = u.origin + u.pathname.replace(/\/+$/, "").replace(/\/conversations(\/[^/]*)?$/i, "");
      return out;
    }

    var parts = u.pathname.split("/").filter(Boolean);
    var envIdx = parts.indexOf("environments");
    var botIdx = parts.indexOf("bots");
    if (envIdx > -1 && parts[envIdx + 1]) {
      out.environmentId = decodeURIComponent(parts[envIdx + 1]).replace(/^Default-/i, "");
    }
    if (botIdx > -1 && parts[botIdx + 1]) {
      out.schemaName = decodeURIComponent(parts[botIdx + 1]);
    }
    // Some embed URLs carry the identifiers as query parameters instead.
    ["environmentId", "envId"].forEach(function (q) {
      var v = u.searchParams.get(q);
      if (v && !out.environmentId) out.environmentId = v.replace(/^Default-/i, "");
    });
    ["botSchema", "schemaName", "agentIdentifier"].forEach(function (q) {
      var v = u.searchParams.get(q);
      if (v && !out.schemaName) out.schemaName = v;
    });
    return out;
  }

  function normalise(out) {
    if (out.environmentId) out.environmentId = out.environmentId.replace(/^Default-/i, "").trim();
    if (out.cloud) out.cloud = out.cloud.toLowerCase();
    // Copilot Studio writes "Published"/"Prebuilt"; the form and the URL
    // builder both work in lower case.
    if (out.agentType) out.agentType = out.agentType.toLowerCase();
    return out;
  }

  /** True when we have enough to build a base URL. */
  function isConfigured(settings) {
    return !!baseUrl(settings);
  }

  /* ------------------------------------------------------- legacy embed URL */

  /**
   * Normalise any Copilot Studio address into the *custom website* web chat
   * canvas — the one meant for embedding.
   *
   * This matters because the two URLs look almost identical but behave very
   * differently. The demo/test site (".../canvas", ".../demo",
   * ".../webchat/demo", or a webchat URL missing cliAgent) renders Copilot
   * Studio's marketing splash: the "I'm your new agent" hero, the prompt
   * cards and a floating chat box. The custom-website canvas
   * (".../bots/{schema}/webchat?__version__=2&cliAgent=true") renders only
   * the conversation, which is what belongs inside this app.
   *
   * Anything that is not a recognisable Copilot Studio address is returned
   * untouched, so Azure Bot Service and third-party canvases still work.
   *
   * opts: { fileAttachment: boolean }
   */
  function webChatUrl(input, opts) {
    opts = opts || {};
    var raw = String(input || "").trim();
    if (!raw) return "";

    var u;
    try { u = new URL(raw); } catch (e) { return raw; }
    // Copilot Studio has been through several hostnames: powerva and
    // powervirtualagents URLs are still handed out by older agents and are the
    // same canvas underneath, so normalise those too.
    if (!/copilotstudio|powerva|powervirtualagents/i.test(u.hostname)) {
      return raw;
    }

    var parts = u.pathname.split("/").filter(Boolean);
    var envIdx = parts.indexOf("environments");
    var botIdx = parts.indexOf("bots");
    if (envIdx === -1 || botIdx === -1 || !parts[envIdx + 1] || !parts[botIdx + 1]) {
      return raw; // an unfamiliar shape: leave it exactly as the user gave it
    }

    var env = parts[envIdx + 1];
    var schema = parts[botIdx + 1];

    // Everything after ".../bots/{schema}" is the canvas selector. Replace it
    // with "webchat" so /canvas, /demo and /webchat/demo all land on the
    // embeddable canvas.
    u.pathname = "/" + parts.slice(0, envIdx).concat(["environments", env, "bots", schema, "webchat"]).join("/");

    // Query parameters the user added (agent variables, locale) are kept;
    // only the ones that select the canvas mode are forced.
    u.searchParams.set("__version__", "2");
    u.searchParams.set("cliAgent", "true");
    u.searchParams.set("enableFileAttachment", opts.fileAttachment ? "true" : "false");
    ["demo", "isDemo", "demoWebsite", "showSplash", "welcome"].forEach(function (k) {
      u.searchParams.delete(k);
    });

    return u.toString();
  }

  /** True when the given URL is Copilot Studio's demo/test website. */
  function isDemoUrl(input) {
    var u;
    try { u = new URL(String(input || "")); } catch (e) { return false; }
    if (!/copilotstudio|powerva|powervirtualagents/i.test(u.hostname)) return false;
    return /\/(canvas|demo)(\/|$)/i.test(u.pathname) ||
           (/\/webchat(\/|$)/i.test(u.pathname) && u.searchParams.get("cliAgent") !== "true");
  }

  /* ------------------------------------------------------------ SSE parser */

  /**
   * Consume a Server-Sent Events body. Calls onEvent({ event, data }) for
   * every complete record. Falls back to whole-body JSON when the service
   * answers with application/json instead of a stream.
   */
  function readStream(res, onEvent) {
    var ctype = (res.headers.get("content-type") || "").toLowerCase();

    if (ctype.indexOf("text/event-stream") === -1 || !res.body || !res.body.getReader) {
      return res.text().then(function (body) {
        if (!body) return;
        if (ctype.indexOf("json") > -1 || /^\s*[[{]/.test(body)) {
          var parsed;
          try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
          if (!parsed) return;
          var list = Array.isArray(parsed) ? parsed
            : (parsed.activities || parsed.value || (parsed.activity ? [parsed.activity] : [parsed]));
          list.forEach(function (a) { onEvent({ event: "activity", data: a }); });
          return;
        }
        // A non-streaming SSE payload delivered in one go.
        parseChunks(body, onEvent);
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          if (buffer.trim()) parseChunks(buffer + "\n\n", onEvent);
          return;
        }
        buffer += decoder.decode(r.value, { stream: true });
        var idx;
        while ((idx = buffer.search(/\r?\n\r?\n/)) > -1) {
          var raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
          handleRecord(raw, onEvent);
        }
        return pump();
      });
    }
    return pump();
  }

  function parseChunks(text, onEvent) {
    text.split(/\r?\n\r?\n/).forEach(function (rec) { handleRecord(rec, onEvent); });
  }

  function handleRecord(raw, onEvent) {
    if (!raw || !raw.trim()) return;
    var name = "message";
    var dataLines = [];

    raw.split(/\r?\n/).forEach(function (line) {
      if (!line || line.charAt(0) === ":") return;             // comment / keep-alive
      var sep = line.indexOf(":");
      var field = sep === -1 ? line : line.slice(0, sep);
      var value = sep === -1 ? "" : line.slice(sep + 1).replace(/^ /, "");
      if (field === "event") name = value;
      else if (field === "data") dataLines.push(value);
    });

    if (!dataLines.length) { onEvent({ event: name, data: null }); return; }
    var payload = dataLines.join("\n");
    if (payload === "[DONE]") { onEvent({ event: "end", data: null }); return; }

    var data;
    try { data = JSON.parse(payload); } catch (e) { data = payload; }
    onEvent({ event: name, data: data });
  }

  /* ------------------------------------------------------------- the client */

  /**
   * opts: { settings, getToken, conversationId, userId,
   *         onActivity, onStatus, onError, useExperimentalEndpoint }
   *
   * `getToken({ forceRefresh })` returns a Promise for a bearer token, so an
   * expired token is renewed transparently rather than dropping the chat.
   */
  function Client(opts) {
    opts = opts || {};
    this.settings = opts.settings || {};
    this.base = baseUrl(this.settings);
    this.getToken = opts.getToken || function () { return Promise.resolve(opts.token || ""); };
    this.conversationId = opts.conversationId || null;
    this.userId = opts.userId || ("m365_" + (global.Store ? global.Store.uid() : Date.now()));
    this.onActivity = opts.onActivity || noop;
    this.onStatus = opts.onStatus || noop;
    this.onError = opts.onError || noop;
    this.useExperimentalEndpoint = !!opts.useExperimentalEndpoint;

    this.transport = "m365";
    this.closed = false;
    this.inFlight = 0;
    this.watermark = null;      // unused here; kept so callers stay uniform
    this.domain = this.base;
    this.resumed = false;
    this.seen = Object.create(null);
    this.streams = Object.create(null);
    this.greetingSentOnStart = false;
  }

  Client.prototype._url = function (path) {
    var base = this.experimentalBase || this.base;
    return base + path + (path.indexOf("?") > -1 ? "&" : "?") + "api-version=" + API_VERSION;
  };

  Client.prototype._headers = function (token) {
    return {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      "x-ms-client-request-id": (global.Store ? global.Store.uid() : String(Date.now())),
      "x-ms-user-agent": "BIGA/2.0 (copilotstudio-client)"
    };
  };

  /** POST a Direct-to-Engine request and stream the activities back. */
  Client.prototype._post = function (path, body, retry) {
    var self = this;
    if (!self.base) {
      return Promise.reject(configError());
    }

    return self.getToken({ forceRefresh: !!retry }).then(function (token) {
      if (!token) throw signInError();
      var headers = self._headers(token);
      if (self.conversationId) headers["x-ms-conversationid"] = self.conversationId;

      return fetch(self._url(path), {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body || {})
      }).then(function (res) {
        if (res.status === 401 && !retry) return self._post(path, body, true);
        if (!res.ok) return res.text().then(function (t) { throw httpError(res.status, t); });

        var convId = res.headers.get("x-ms-conversationid");
        if (convId) self.conversationId = convId;

        // The service can hand back a region-specific host to use from here on.
        if (self.useExperimentalEndpoint) {
          var alt = res.headers.get("x-ms-d2e-experimental");
          if (alt) { try { self.experimentalBase = new URL(alt).origin + new URL(alt).pathname.replace(/\/+$/, ""); } catch (e) { noop(); } }
        }

        self.inFlight += 1;
        self.onStatus("online");

        return readStream(res, function (rec) {
          if (self.closed) return;
          if (rec.event === "end") return;
          var act = rec.data;
          if (!act || typeof act !== "object") return;
          if (act.conversation && act.conversation.id && !self.conversationId) {
            self.conversationId = act.conversation.id;
          }
          self._accumulateStream(act);
          self._emit(act);
        }).then(function () {
          self.inFlight = Math.max(0, self.inFlight - 1);
          if (!self.inFlight) self.onStatus("idle");
        }, function (err) {
          self.inFlight = Math.max(0, self.inFlight - 1);
          throw err;
        });
      });
    });
  };

  function streamInfo(activity) {
    var entities = activity && Array.isArray(activity.entities) ? activity.entities : [];
    var entity = entities.filter(function (e) {
      return e && String(e.type || "").toLowerCase() === "streaminfo";
    })[0] || {};
    var cd = (activity && activity.channelData) || {};
    return {
      type: String(entity.streamType || cd.streamType || "").toLowerCase(),
      id: entity.streamId || cd.streamId || "",
      sequence: Number(entity.streamSequence || cd.streamSequence || 0)
    };
  }

  /**
   * The current SDK sends partial answer chunks as typing activities carrying
   * a streaminfo entity. Accumulate them by sequence before handing them to the
   * canvas, matching the official client rather than displaying raw fragments.
   */
  Client.prototype._accumulateStream = function (activity) {
    if (!activity || activity.type !== "typing") return;
    var info = streamInfo(activity);
    if (info.type !== "streaming" || !info.id || !info.sequence) return;
    var parts = this.streams[info.id] || [];
    var replaced = false;
    parts = parts.map(function (part) {
      if (part.sequence !== info.sequence) return part;
      replaced = true;
      return { sequence: info.sequence, text: activity.text || "" };
    });
    if (!replaced) parts.push({ sequence: info.sequence, text: activity.text || "" });
    parts.sort(function (a, b) { return a.sequence - b.sequence; });
    this.streams[info.id] = parts;
    activity.text = parts.map(function (part) { return part.text; }).join("");
  };

  /** Streamed activities repeat IDs; only suppress byte-for-byte duplicates. */
  Client.prototype._emit = function (activity) {
    var info = streamInfo(activity);
    var key = (activity.id || activity.timestamp || "") + "|" +
      (activity.type || "") + "|" + info.id + "|" + info.sequence + "|" +
      (activity.text || "");
    if (this.seen[key]) return;
    this.seen[key] = 1;
    this.onActivity(activity);
  };

  /** Open (or re-open) the conversation. */
  Client.prototype.start = function (opts) {
    var self = this;
    opts = opts || {};
    self.onStatus("connecting");

    if (self.conversationId && opts.resume !== false) {
      // Direct-to-Engine has no explicit "reattach" call: the conversation ID
      // is simply reused on the next turn. Verify it lazily instead of
      // burning a round trip here, so resuming is instant.
      self.resumed = true;
      self.onStatus("online");
      return Promise.resolve(self);
    }

    self.greetingSentOnStart = opts.greeting !== false;
    return self._post("/conversations", {
      emitStartConversationEvent: self.greetingSentOnStart
    }).then(function () {
      if (!self.conversationId) throw new Error("Copilot Studio opened a stream but returned no conversation ID.");
      self.resumed = false;
      self.onStatus("online");
      return self;
    });
  };

  /** Send an activity and stream the agent's reply. */
  Client.prototype.post = function (activity) {
    var self = this;
    var payload = Object.assign({
      type: "message",
      from: { id: self.userId, role: "user" },
      locale: (global.navigator && global.navigator.language) || "en-GB",
      textFormat: "plain"
    }, activity);

    if (self.conversationId) payload.conversation = { id: self.conversationId };

    var send = function () {
      return self._post("/conversations/" + encodeURIComponent(self.conversationId), { activity: payload });
    };

    if (!self.conversationId) {
      return self.start({ greeting: false }).then(send);
    }
    return send().catch(function (err) {
      // An expired conversation is the one error worth recovering from
      // automatically: open a new one and replay the turn.
      if (err && (err.status === 404 || err.status === 400 || err.status === 410)) {
        self.conversationId = null;
        self.seen = Object.create(null);
        self.streams = Object.create(null);
        return self.start({ greeting: false }).then(function () {
          payload.conversation = { id: self.conversationId };
          return send();
        });
      }
      throw err;
    });
  };

  Client.prototype.sendText = function (text, attachments) {
    var a = { type: "message", text: text || "" };
    if (attachments && attachments.length) a.attachments = attachments;
    return this.post(a);
  };

  /**
   * Direct-to-Engine has no multipart upload endpoint. Files travel as
   * activity attachments with an inline data URL, which is what Copilot
   * Studio's own file-upload capability consumes.
   */
  Client.prototype.upload = function (fileList, text) {
    var self = this;
    var files = Array.prototype.slice.call(fileList || []);
    var MAX = 4 * 1024 * 1024;   // keep the request body sane

    return Promise.all(files.map(function (f) {
      if (f.size > MAX) {
        return Promise.resolve({
          name: f.name,
          contentType: "text/plain",
          content: "[" + f.name + " was too large to inline (" + Math.round(f.size / 1048576) + " MB).]"
        });
      }
      return new Promise(function (resolve) {
        var r = new FileReader();
        r.onload = function () {
          resolve({
            name: f.name,
            contentType: f.type || "application/octet-stream",
            contentUrl: r.result
          });
        };
        r.onerror = function () { resolve(null); };
        r.readAsDataURL(f);
      });
    })).then(function (atts) {
      return self.sendText(text, atts.filter(Boolean));
    });
  };

  /** Copilot Studio greets on conversation start; this is the manual nudge. */
  Client.prototype.sendGreetingTrigger = function () {
    return this.post({
      type: "event",
      name: "startConversation",
      value: { text: "hello" }
    }).catch(noop);
  };

  Client.prototype.end = function () {
    this.closed = true;
  };

  /* ---------------------------------------------------------------- errors */

  function tag(err, extra) {
    err.handled = true;
    Object.keys(extra || {}).forEach(function (k) { err[k] = extra[k]; });
    return err;
  }

  function configError() {
    return tag(new Error(
      "This agent has no Microsoft 365 Agents SDK connection details yet. Open Connection " +
      "settings and paste the connection string from Copilot Studio \u203A Channels \u203A Web app."
    ));
  }

  function signInError() {
    return tag(new Error(
      "Sign-in is required. The Agents SDK protocol only accepts Entra ID user tokens, so " +
      "BIG A needs an app registration client ID before it can reach the agent."
    ));
  }

  function httpError(status, body) {
    var detail = "";
    try {
      var j = JSON.parse(body);
      detail = (j.error && (j.error.message || j.error.code)) || j.message || "";
    } catch (e) { detail = (body || "").slice(0, 240); }

    var hint = "";
    if (status === 401) {
      hint = " The token was rejected. Check that the app registration has the Power Platform API " +
             "delegated permission CopilotStudio.Copilots.Invoke, with admin consent granted.";
    } else if (status === 403) {
      hint = " Access was refused. The signed-in user needs access to the agent's environment, " +
             "and the agent must be published.";
    } else if (status === 404) {
      hint = " The agent could not be found at that address. Re-copy the connection string, or " +
             "check the environment ID and schema name in Copilot Studio \u203A Settings \u203A Advanced \u203A Metadata.";
    } else if (status === 429) {
      hint = " The service is rate limiting this agent. Wait a moment and try again.";
    } else if (status >= 500) {
      hint = " Copilot Studio failed to respond. This is usually temporary.";
    }

    return tag(new Error("Copilot Studio returned HTTP " + status + "." + hint + (detail ? "\n\n" + detail : "")),
               { status: status });
  }

  /* ---------------------------------------------------------------- facade */

  /**
   * opts: { settings, getToken, conversationId, userId, greeting,
   *         onActivity, onStatus, onError }
   */
  function connect(opts) {
    opts = opts || {};
    var client = new Client(opts);
    if (!client.base) return Promise.reject(configError());
    return client.start({ greeting: opts.greeting !== false }).then(function () { return client; });
  }

  global.M365Agents = {
    connect: connect,
    Client: Client,
    parseConnection: parseConnection,
    baseUrl: baseUrl,
    environmentHost: environmentHost,
    isConfigured: isConfigured,
    webChatUrl: webChatUrl,
    isDemoUrl: isDemoUrl,
    scopeForCloud: scopeForCloud,
    CLOUDS: CLOUDS,
    API_VERSION: API_VERSION
  };
})(typeof window !== "undefined" ? window : this);
