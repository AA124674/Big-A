/* ==========================================================================
   openrouter.js — BIG A transport for OpenRouter's unified, OpenAI-compatible API
   --------------------------------------------------------------------------
   Same idea as anthropic.js and gemini.js: stateless API, so this client
   keeps an in-memory `history` array of {role, content} turns seeded from
   BIG A's local transcript and grown as replies stream back. See
   anthropic.js's file header for the fuller rationale.

   Two things set OpenRouter apart from the other two transports:

   1. It fronts hundreds of models from dozens of providers, many of them
      genuinely free (a "0 price" catalog that OpenRouter itself calls
      volatile — models rotate in and out with little notice). Hardcoding a
      list of "current free models" here would go stale within days, so this
      client instead exposes fetchModels(), which reads OpenRouter's own
      public GET /api/v1/models catalog live and lets the UI populate the
      free-model list from real, current data. A plain "Custom model ID"
      field is always available as a fallback regardless.
   2. It speaks the OpenAI Chat Completions wire format, not a bespoke one:
      a `messages` array with an optional leading {role:"system"} entry
      (rather than a separate top-level system field), and multimodal
      content as {type:"image_url", image_url:{url: "data:...;base64,..."}}
      parts. Only images are attached natively here — unlike Claude and
      Gemini, there is no single standard way to attach a PDF across every
      provider OpenRouter proxies to, so PDFs fall back to a text note like
      any other unsupported type.
   ========================================================================== */

(function (global) {
  "use strict";

  var DEFAULT_BASE = "https://openrouter.ai";
  var APP_TITLE = "BIG A";
  var DEFAULT_MAX_TOKENS = 4096;
  var MAX_TOKENS_CEILING = 65536;

  /* Readable text is inlined by chat.js before this client ever sees it, so
     it does not need its own block — same rationale as the other two
     transports. PDFs are deliberately absent from the native list; see the
     file header. */
  var IMAGE_TYPE_RE = /^image\/(png|jpe?g|gif|webp)/i;
  var READABLE_RE = /^text\/|json|csv|xml|javascript|markdown|yaml/;
  var READABLE_EXT_RE = /\.(txt|md|csv|tsv|json|log|xml|yml|yaml|js|ts|py|sql|html|css)$/i;
  var MAX_FILE_BYTES = 5 * 1024 * 1024;

  function noop() {}

  /* ------------------------------------------------------------- settings */

  function isConfigured(settings) {
    return !!(settings && String(settings.apiKey || "").trim() && String(settings.model || "").trim());
  }

  function baseUrl(settings) {
    return String((settings && settings.baseUrl) || DEFAULT_BASE).trim().replace(/\/+$/, "") || DEFAULT_BASE;
  }

  function clampMaxTokens(v) {
    var n = parseInt(v, 10);
    if (!n || n < 1) return DEFAULT_MAX_TOKENS;
    return Math.min(n, MAX_TOKENS_CEILING);
  }

  /* ---------------------------------------------------------------- files */

  function readAsDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || "")); };
      r.onerror = function () { reject(new Error("Could not read " + (blob.name || "the file") + ".")); };
      r.readAsDataURL(blob);
    });
  }

  /** An {type:"image_url"} part, or a text stand-in if the file is too large. */
  function imageBlock(blob, name, size) {
    if (size && size > MAX_FILE_BYTES) {
      return Promise.resolve([{
        type: "text",
        text: "[" + (name || "file") + " was too large to send (" +
          Math.round(size / 1048576) + " MB, limit " + Math.round(MAX_FILE_BYTES / 1048576) + " MB).]"
      }]);
    }
    return readAsDataUrl(blob).then(function (dataUrl) {
      return [{ type: "image_url", image_url: { url: dataUrl } }];
    });
  }

  /**
   * A freshly-picked File for the turn being sent right now.
   * Readable text files return null on purpose: chat.js already extracted
   * and inlined their contents into the message text, so a second copy here
   * would just be a duplicate.
   */
  function fileToBlocks(file) {
    var type = (file.type || "").toLowerCase();
    var name = file.name || "";
    if (IMAGE_TYPE_RE.test(type)) return imageBlock(file, name, file.size);
    if (READABLE_RE.test(type) || READABLE_EXT_RE.test(name)) return Promise.resolve(null);
    return Promise.resolve([{
      type: "text",
      text: "[Attached: " + name + " \u2014 this connector only attaches images directly; PDFs and other " +
        "file types are not sent, only noted by name.]"
    }]);
  }

  function dataUrlToBlob(dataUrl) {
    try {
      var parts = String(dataUrl).split(",");
      var mime = (parts[0].match(/data:([^;]+);base64/) || [null, "application/octet-stream"])[1];
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) { return null; }
  }

  /**
   * An attachment already sitting in Store, from an earlier turn of this
   * same chat. Re-read so the model keeps seeing it on later turns too.
   */
  function blocksFromStoredAttachment(att) {
    var Store = global.Store;
    var type = (att.type || "").toLowerCase();
    var name = att.name || "file";
    var isImage = IMAGE_TYPE_RE.test(type) || /\.(png|jpe?g|gif|webp)$/i.test(name);
    var isText = READABLE_RE.test(type) || READABLE_EXT_RE.test(name);

    if (!isImage && !isText) {
      return Promise.resolve([{ type: "text", text: "[Attached: " + name + " \u2014 not readable here.]" }]);
    }
    if (!att.blobId || !Store) {
      return Promise.resolve([{ type: "text", text: "[Attached: " + name + "]" }]);
    }
    return Store.blobs.get(att.blobId).then(function (row) {
      var blob = row && (row.blob || (row.dataUrl ? dataUrlToBlob(row.dataUrl) : null));
      if (!blob) return [{ type: "text", text: "[Attached: " + name + " \u2014 no longer stored in this browser.]" }];
      if (isImage) return imageBlock(blob, name, att.size || blob.size);
      return blob.text().then(function (txt) {
        return [{ type: "text", text: "--- FILE: " + name + " ---\n" + txt.slice(0, 200000) }];
      });
    }).catch(function () {
      return [{ type: "text", text: "[Attached: " + name + "]" }];
    });
  }

  /* ------------------------------------------------------------- history */

  function apiRole(msg) { return msg.role === "assistant" ? "assistant" : "user"; }

  /** One stored BIG A message, turned into an OpenAI-style {role, content} turn. */
  function messageFromStored(msg) {
    var atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    return Promise.all(atts.map(blocksFromStoredAttachment)).then(function (groups) {
      var parts = [];
      groups.forEach(function (g) { if (g && g.length) parts = parts.concat(g); });
      var text = String(msg.text || "").trim();
      if (text && text !== "(files attached)") parts.push({ type: "text", text: text });
      if (!parts.length) parts.push({ type: "text", text: text || "(empty message)" });
      return { role: apiRole(msg), content: parts };
    });
  }

  /** The chat's transcript so far, starting from the first user turn. */
  function buildHistory(chatId) {
    var Store = global.Store;
    if (!chatId || !Store) return Promise.resolve([]);
    return Store.messages.list(chatId).then(function (rows) {
      var start = 0;
      while (start < rows.length && rows[start].role !== "user") start++;
      return Promise.all(rows.slice(start).map(messageFromStored));
    });
  }

  /** Consecutive same-role turns merged into one. */
  function mergeRuns(list) {
    var out = [];
    list.forEach(function (m) {
      if (!m || !m.content || !m.content.length) return;
      var last = out[out.length - 1];
      if (last && last.role === m.role) last.content = last.content.concat(m.content);
      else out.push({ role: m.role, content: m.content.slice() });
    });
    return out;
  }

  /* ------------------------------------------------------------ SSE parser */

  /** A small, self-contained reader for OpenRouter's SSE stream, including
      its periodic ": OPENROUTER PROCESSING" keep-alive comments. */
  function readSSE(res, onEvent) {
    if (!res.body || !res.body.getReader) {
      return res.text().then(function (body) {
        if (!body) return;
        try { onEvent({ event: "message", data: JSON.parse(body) }); } catch (e) { /* nothing usable */ }
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    function handleRecord(raw) {
      if (!raw || !raw.trim()) return;
      var dataLines = [];
      raw.split(/\r?\n/).forEach(function (line) {
        // A comment (keep-alive) line — never valid JSON, must be skipped
        // before it is ever handed to JSON.parse.
        if (!line || line.charAt(0) === ":") return;
        var sep = line.indexOf(":");
        var field = sep === -1 ? line : line.slice(0, sep);
        var value = sep === -1 ? "" : line.slice(sep + 1).replace(/^ /, "");
        if (field === "data") dataLines.push(value);
      });
      if (!dataLines.length) return;
      var payload = dataLines.join("\n");
      if (payload === "[DONE]") return;
      var data;
      try { data = JSON.parse(payload); } catch (e) { data = null; }
      onEvent({ event: "message", data: data });
    }

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          if (buffer.trim()) handleRecord(buffer);
          return;
        }
        buffer += decoder.decode(r.value, { stream: true });
        var idx;
        while ((idx = buffer.search(/\r?\n\r?\n/)) > -1) {
          handleRecord(buffer.slice(0, idx));
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
        }
        return pump();
      });
    }
    return pump();
  }

  /* ---------------------------------------------------------------- errors */

  function httpError(status, body) {
    var detail = "";
    try {
      var j = JSON.parse(body);
      detail = (j.error && j.error.message) || "";
    } catch (e) { detail = (body || "").slice(0, 300); }

    var hint = "";
    if (status === 401) {
      hint = " Check that the API key is correct and still active \u2014 review it at openrouter.ai \u203A Keys.";
    } else if (status === 402) {
      hint = " This key is out of credit. Free (\":free\") models still work at $0 balance; a paid model " +
             "needs credit added at openrouter.ai \u203A Credits.";
    } else if (status === 403) {
      hint = " The request was blocked \u2014 often a moderation flag, or a model this key cannot access.";
    } else if (status === 404) {
      hint = " Check the model ID in Connection settings \u2014 it may be mistyped or no longer listed.";
    } else if (status === 408) {
      hint = " The request timed out. Try again, or a shorter message.";
    } else if (status === 429) {
      hint = " Rate limited \u2014 free models are capped fairly low. Wait a moment, try again, or switch models.";
    } else if (status === 502) {
      hint = " The upstream provider for this model failed. Try again, or pick a different model.";
    } else if (status === 503) {
      hint = " No provider is currently available for this model. Try again shortly, or pick a different model.";
    } else if (status >= 500) {
      hint = " OpenRouter failed to respond. This is usually temporary.";
    }

    var err = new Error("OpenRouter returned HTTP " + status + "." + hint + (detail ? "\n\n" + detail : ""));
    err.status = status;
    err.handled = true;
    return err;
  }

  function configError() {
    var err = new Error(
      "This agent has no OpenRouter API key yet. Open Connection settings and paste in a key from " +
      "openrouter.ai \u203A Keys."
    );
    err.handled = true;
    return err;
  }

  /* ------------------------------------------------------------- the client */

  /**
   * opts: { settings, chatId, agentName, onActivity, onStatus, onError }
   * Same shape as anthropic.js's and gemini.js's clients.
   */
  function Client(opts) {
    opts = opts || {};
    this.settings = opts.settings || {};
    this.chatId = opts.chatId || null;
    this.agentName = opts.agentName || "OpenRouter";
    this.onActivity = opts.onActivity || noop;
    this.onStatus = opts.onStatus || noop;
    this.onError = opts.onError || noop;

    this.transport = "openrouter";
    this.closed = false;
    this.resumed = false;
    this.userId = "openrouter_" + (global.Store ? global.Store.uid() : String(Date.now()));
    this.conversationId = null;   // unused; kept so saveResumePoint() stays uniform across transports
    this.watermark = null;
    this.domain = baseUrl(this.settings);
    this.history = [];
  }

  Client.prototype._url = function (path) {
    return baseUrl(this.settings) + path;
  };

  Client.prototype._headers = function () {
    return {
      "content-type": "application/json",
      "authorization": "Bearer " + this.settings.apiKey,
      // Purely attribution for OpenRouter's own leaderboard — a fixed,
      // generic string, not this deployment's actual address, so nothing
      // about where this page is hosted is disclosed to them.
      "x-openrouter-title": APP_TITLE
    };
  };

  Client.prototype._request = function (messages, signal) {
    var s = this.settings;
    var body = {
      model: s.model,
      messages: messages,
      stream: true,
      max_tokens: clampMaxTokens(s.maxTokens)
    };
    var temp = parseFloat(s.temperature);
    if (String(s.temperature || "").trim() !== "" && !isNaN(temp)) body.temperature = temp;

    return fetch(this._url("/api/v1/chat/completions"), {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: signal
    });
  };

  /** One streamed chat-completion-chunk, or a mid-stream error payload. */
  Client.prototype._handleEvent = function (evt) {
    var self = this;
    var d = evt.data;
    if (!d || typeof d !== "object") return;

    // Mid-stream errors sit at the top level, alongside `choices`, per
    // OpenRouter's streaming-error contract — not nested inside a choice.
    if (d.error) {
      self.onError(new Error((d.error && d.error.message) || "The connection to OpenRouter was interrupted."));
      return;
    }

    var choice = d.choices && d.choices[0];
    if (!choice) return;
    var delta = choice.delta || {};
    if (typeof delta.content === "string" && delta.content) {
      self._gotText = true;
      self._accum += delta.content;
      self.onActivity({
        type: "typing",
        text: delta.content,
        channelData: { streamId: self.replyId, streamType: "streaming" }
      });
    }
    if (choice.finish_reason && choice.finish_reason !== "stop") self._stopReason = choice.finish_reason;
  };

  /** Close out the live bubble, whether the turn finished cleanly or not. */
  Client.prototype._finish = function (fromError) {
    if (this._finished) return;
    this._finished = true;

    var text = this._accum || "";
    if (!text) {
      if (fromError) return;
      if (this._stopReason === "content_filter") {
        text = "The model declined to respond to this message.";
      } else if (this._stopReason === "error") {
        text = "OpenRouter reported an error partway through the response.";
      } else {
        text = "OpenRouter did not return any text for this message.";
      }
    } else if (this._stopReason === "length") {
      text += "\n\n*(Stopped: reached the max output tokens limit. Raise it in Connection settings \u2014 " +
              "Optional settings \u2014 for longer replies.)*";
    }

    this.onActivity({
      type: "message",
      id: this.replyId,
      channelData: { streamId: this.replyId },
      text: text,
      from: { name: this.agentName }
    });
  };

  /** Shared by sendText and upload: run one turn against the API. */
  Client.prototype._send = function (contentParts) {
    var self = this;
    if (self.closed) return Promise.reject(new Error("This chat is no longer connected."));
    if (!isConfigured(self.settings)) return Promise.reject(configError());
    if (!contentParts.length) return Promise.reject(new Error("Nothing to send."));

    var attempt = self.history.concat([{ role: "user", content: contentParts }]);
    var payload = mergeRuns(attempt);
    // Unlike Claude's top-level `system` or Gemini's `systemInstruction`,
    // OpenAI-style APIs carry the system prompt as an ordinary leading
    // message instead of a separate field.
    if (self.settings.systemPrompt) {
      payload = [{ role: "system", content: self.settings.systemPrompt }].concat(payload);
    }

    self.replyId = "openrouter-" + (global.Store ? global.Store.uid() : String(Date.now()));
    self._accum = "";
    self._gotText = false;
    self._stopReason = null;
    self._finished = false;

    self.onStatus("connecting");
    self._abort = (global.AbortController ? new global.AbortController() : null);

    return self._request(payload, self._abort && self._abort.signal).then(function (res) {
      if (!res.ok) return res.text().then(function (body) { throw httpError(res.status, body); });
      self.onStatus("online");
      return readSSE(res, function (evt) {
        if (!self.closed) self._handleEvent(evt);
      });
    }).then(function () {
      self._finish();
      // Only commit the turn to history once it actually succeeded, so a
      // failed attempt can be retried without leaving a stray duplicate.
      self.history = attempt.concat([{ role: "assistant", content: [{ type: "text", text: self._accum || "" }] }]);
      return self;
    }).catch(function (err) {
      self._finish(true);
      throw err;
    });
  };

  Client.prototype.sendText = function (text) {
    var parts = [];
    if (text) parts.push({ type: "text", text: String(text) });
    if (!parts.length) return Promise.reject(new Error("Nothing to send."));
    return this._send(parts);
  };

  /**
   * Images travel as native {type:"image_url"} parts; readable text files
   * are already inlined into `text` by chat.js before this is called.
   * Anything else gets a short note instead of silently vanishing.
   */
  Client.prototype.upload = function (fileList, text) {
    var self = this;
    var files = Array.prototype.slice.call(fileList || []);
    return Promise.all(files.map(fileToBlocks)).then(function (groups) {
      var parts = [];
      groups.forEach(function (g) { if (g && g.length) parts = parts.concat(g); });
      if (text) parts.push({ type: "text", text: String(text) });
      if (!parts.length) {
        return Promise.reject(new Error(
          "None of the attached file types are supported here, and there is no message text to send."
        ));
      }
      return self._send(parts);
    });
  };

  Client.prototype.end = function () {
    this.closed = true;
    if (this._abort) { try { this._abort.abort(); } catch (e) { /* already settled */ } }
  };

  /* ---------------------------------------------------------------- facade */

  function connect(opts) {
    opts = opts || {};
    var client = new Client(opts);
    if (!isConfigured(client.settings)) return Promise.reject(configError());
    return buildHistory(opts.chatId).then(function (history) {
      client.history = history;
      client.resumed = true;   // nothing is ever lost on reconnect: history is rebuilt from Store every time
      client.onStatus("online");
      return client;
    });
  }

  /** A cheap, real round trip: confirms the key and model actually work. */
  function testConnection(settings) {
    if (!isConfigured(settings)) return Promise.reject(new Error("Add an API key and choose a model first."));
    return fetch(baseUrl(settings) + "/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + settings.apiKey,
        "x-openrouter-title": APP_TITLE
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        max_tokens: 1
      })
    }).then(function (res) {
      if (res.ok) return true;
      return res.text().then(function (body) { throw httpError(res.status, body); });
    });
  }

  /**
   * OpenRouter's own public model catalog (no API key required to read it).
   * Returns [{id, name, free}], letting the UI show what is free *today*
   * instead of a list hardcoded here that would drift out of date.
   */
  function fetchModels(settings) {
    var headers = { "content-type": "application/json" };
    if (settings && settings.apiKey) headers.authorization = "Bearer " + settings.apiKey;
    return fetch(baseUrl(settings) + "/api/v1/models", { headers: headers }).then(function (res) {
      if (!res.ok) return res.text().then(function (body) { throw httpError(res.status, body); });
      return res.json();
    }).then(function (json) {
      var rows = (json && json.data) || [];
      return rows.map(function (m) {
        var p = m.pricing || {};
        var free = (Number(p.prompt) === 0) && (Number(p.completion) === 0);
        return { id: m.id, name: m.name || m.id, free: !!free };
      }).filter(function (m) { return m.id; });
    });
  }

  global.OpenRouterClient = {
    connect: connect,
    isConfigured: isConfigured,
    testConnection: testConnection,
    fetchModels: fetchModels,
    baseUrl: baseUrl,
    Client: Client,
    DEFAULT_BASE: DEFAULT_BASE,
    DEFAULT_MAX_TOKENS: DEFAULT_MAX_TOKENS
  };
})(typeof window !== "undefined" ? window : this);
