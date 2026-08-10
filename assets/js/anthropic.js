/* ==========================================================================
   anthropic.js — BIG A transport for Claude, direct to the Anthropic API
   --------------------------------------------------------------------------
   The other two live transports (m365agents.js, directline.js) talk to a
   Copilot Studio agent that keeps its own server-side conversation. Claude's
   Messages API has no such state: every request carries the whole
   conversation again. So instead of a "conversation ID" this client keeps an
   in-memory `history` array of Claude-shaped {role, content} turns, seeded
   once from BIG A's own local transcript when the chat is opened, and grown
   turn by turn as replies come back — the durable copy already lives in
   Store, exactly as it does for the other transports.

   Requests go straight from this browser to api.anthropic.com (or a
   compatible base URL) using the API's opt-in
   "anthropic-dangerous-direct-browser-access" header. That means the API key
   travels in every request this page makes and is readable by anyone with
   access to this browser's network tab — the same trade-off BIG A already
   makes for every other credential it stores, and why the UI says so.

   Like m365agents.js, this module deliberately mirrors the surface
   (connect / sendText / upload / end) so chat.js can drive it without
   caring which transport is live.
   ========================================================================== */

(function (global) {
  "use strict";

  var API_VERSION = "2023-06-01";
  var DEFAULT_BASE = "https://api.anthropic.com";
  var DEFAULT_MAX_TOKENS = 4096;
  var MAX_TOKENS_CEILING = 128000;

  /* File types a message can carry natively. Anything else either already
     rides along as inlined text (chat.js extracts and prepends readable text
     files before handing the turn to this client) or is simply not
     attachable to a Claude request, and gets a short note instead so the
     model at least knows something was left out. */
  var IMAGE_TYPE_RE = /^image\/(png|jpe?g|gif|webp)$/i;
  var READABLE_RE = /^text\/|json|csv|xml|javascript|markdown|yaml/;
  var READABLE_EXT_RE = /\.(txt|md|csv|tsv|json|log|xml|yml|yaml|js|ts|py|sql|html|css)$/i;
  var MAX_FILE_BYTES = 5 * 1024 * 1024;

  function noop() {}

  /* ------------------------------------------------------------- settings */

  /** True once there is enough to actually call the API. */
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

  function readAsBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || "");
        var i = s.indexOf(",");
        resolve(i > -1 ? s.slice(i + 1) : s);
      };
      r.onerror = function () { reject(new Error("Could not read " + (blob.name || "the file") + ".")); };
      r.readAsDataURL(blob);
    });
  }

  function normaliseImageType(type, name) {
    var t = String(type || "").toLowerCase();
    if (/jpe?g/.test(t)) return "image/jpeg";
    if (/^image\/(png|gif|webp)$/.test(t)) return t;
    var ext = String(name || "").split(".").pop().toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    return "image/png";
  }

  /** A base64 image or PDF content block, or a plain-text stand-in if it is too large. */
  function binaryBlock(blob, name, size, isImage, mimeHint) {
    if (size && size > MAX_FILE_BYTES) {
      return Promise.resolve([{
        type: "text",
        text: "[" + (name || "file") + " was too large to send to Claude (" +
          Math.round(size / 1048576) + " MB, limit " + Math.round(MAX_FILE_BYTES / 1048576) + " MB).]"
      }]);
    }
    return readAsBase64(blob).then(function (b64) {
      if (isImage) {
        return [{ type: "image", source: { type: "base64", media_type: normaliseImageType(mimeHint, name), data: b64 } }];
      }
      return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }];
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
    if (IMAGE_TYPE_RE.test(type)) return binaryBlock(file, name, file.size, true, type);
    if (type === "application/pdf" || /\.pdf$/i.test(name)) return binaryBlock(file, name, file.size, false, type);
    if (READABLE_RE.test(type) || READABLE_EXT_RE.test(name)) return Promise.resolve(null);
    return Promise.resolve([{
      type: "text",
      text: "[Attached: " + name + " \u2014 Claude can only read images, PDFs and text-like files here, " +
        "so this one was not included.]"
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
   * same chat. Re-read so the model keeps seeing it on later turns too —
   * the same reason the official apps resend the whole conversation on
   * every request. Falls back to a short note when the bytes are gone.
   */
  function blocksFromStoredAttachment(att) {
    var Store = global.Store;
    var type = (att.type || "").toLowerCase();
    var name = att.name || "file";
    var isImage = IMAGE_TYPE_RE.test(type) || /\.(png|jpe?g|gif|webp)$/i.test(name);
    var isPdf = type === "application/pdf" || /\.pdf$/i.test(name);
    var isText = READABLE_RE.test(type) || READABLE_EXT_RE.test(name);

    if (!isImage && !isPdf && !isText) {
      return Promise.resolve([{ type: "text", text: "[Attached: " + name + " \u2014 not readable by Claude.]" }]);
    }
    if (!att.blobId || !Store) {
      return Promise.resolve([{ type: "text", text: "[Attached: " + name + "]" }]);
    }
    return Store.blobs.get(att.blobId).then(function (row) {
      var blob = row && (row.blob || (row.dataUrl ? dataUrlToBlob(row.dataUrl) : null));
      if (!blob) return [{ type: "text", text: "[Attached: " + name + " \u2014 no longer stored in this browser.]" }];
      if (isImage) return binaryBlock(blob, name, att.size || blob.size, true, type || blob.type);
      if (isPdf) return binaryBlock(blob, name, att.size || blob.size, false, "application/pdf");
      return blob.text().then(function (txt) {
        return [{ type: "text", text: "--- FILE: " + name + " ---\n" + txt.slice(0, 200000) }];
      });
    }).catch(function () {
      return [{ type: "text", text: "[Attached: " + name + "]" }];
    });
  }

  /* ------------------------------------------------------------- history */

  function apiRole(msg) { return msg.role === "assistant" ? "assistant" : "user"; }

  /** One stored BIG A message, turned into a Claude {role, content} turn. */
  function messageFromStored(msg) {
    var atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    return Promise.all(atts.map(blocksFromStoredAttachment)).then(function (groups) {
      var blocks = [];
      groups.forEach(function (g) { if (g && g.length) blocks = blocks.concat(g); });
      var text = String(msg.text || "").trim();
      if (text && text !== "(files attached)") blocks.push({ type: "text", text: text });
      if (!blocks.length) blocks.push({ type: "text", text: text || "(empty message)" });
      return { role: apiRole(msg), content: blocks };
    });
  }

  /**
   * The chat's transcript so far, as Claude turns. The API requires the
   * first turn to be from the user, so anything stranded before the first
   * user message (should not normally happen) is dropped rather than sent.
   */
  function buildHistory(chatId) {
    var Store = global.Store;
    if (!chatId || !Store) return Promise.resolve([]);
    return Store.messages.list(chatId).then(function (rows) {
      var start = 0;
      while (start < rows.length && rows[start].role !== "user") start++;
      return Promise.all(rows.slice(start).map(messageFromStored));
    });
  }

  /** Consecutive same-role turns merged into one, as the API requires. */
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

  /** A small, self-contained reader for the Messages API's SSE stream. */
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
      var name = "message";
      var dataLines = [];
      raw.split(/\r?\n/).forEach(function (line) {
        if (!line || line.charAt(0) === ":") return;
        var sep = line.indexOf(":");
        var field = sep === -1 ? line : line.slice(0, sep);
        var value = sep === -1 ? "" : line.slice(sep + 1).replace(/^ /, "");
        if (field === "event") name = value;
        else if (field === "data") dataLines.push(value);
      });
      if (!dataLines.length) return;
      var data;
      try { data = JSON.parse(dataLines.join("\n")); } catch (e) { data = null; }
      onEvent({ event: name, data: data });
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
      detail = (j.error && j.error.message) || j.message || "";
    } catch (e) { detail = (body || "").slice(0, 300); }

    var hint = "";
    if (status === 401) {
      hint = " Check that the API key is correct and still active at console.anthropic.com \u203A " +
             "Settings \u203A API keys.";
    } else if (status === 403) {
      hint = " This key does not have access to that model, or the organisation is out of credit.";
    } else if (status === 404) {
      hint = " Check the model ID in Connection settings \u2014 it may be mistyped or retired.";
    } else if (status === 429) {
      hint = " Anthropic is rate limiting this key. Wait a moment and try again.";
    } else if (status === 529 || status >= 500) {
      hint = " Anthropic's API failed to respond. This is usually temporary.";
    }

    var err = new Error("Anthropic returned HTTP " + status + "." + hint + (detail ? "\n\n" + detail : ""));
    err.status = status;
    err.handled = true;
    return err;
  }

  function configError() {
    var err = new Error(
      "This agent has no Claude API key yet. Open Connection settings and paste in a key from " +
      "console.anthropic.com \u203A Settings \u203A API keys."
    );
    err.handled = true;
    return err;
  }

  /* ------------------------------------------------------------- the client */

  /**
   * opts: { settings, chatId, agentName, onActivity, onStatus, onError }
   *
   * `onActivity` receives Bot-Framework-shaped activities, the same shape
   * the other two transports produce, so chat.js's existing streaming and
   * rendering code needs no changes to understand this transport too.
   */
  function Client(opts) {
    opts = opts || {};
    this.settings = opts.settings || {};
    this.chatId = opts.chatId || null;
    this.agentName = opts.agentName || "Claude";
    this.onActivity = opts.onActivity || noop;
    this.onStatus = opts.onStatus || noop;
    this.onError = opts.onError || noop;

    this.transport = "claude";
    this.closed = false;
    this.resumed = false;
    this.userId = "claude_" + (global.Store ? global.Store.uid() : String(Date.now()));
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
      "x-api-key": this.settings.apiKey,
      "anthropic-version": API_VERSION,
      // Opts in to CORS. The key travels with every request either way; see
      // the file header and the Connection settings hint for the trade-off.
      "anthropic-dangerous-direct-browser-access": "true"
    };
  };

  Client.prototype._request = function (messages, signal) {
    var s = this.settings;
    var body = {
      model: s.model,
      max_tokens: clampMaxTokens(s.maxTokens),
      messages: messages,
      stream: true
    };
    if (s.systemPrompt) body.system = s.systemPrompt;
    var temp = parseFloat(s.temperature);
    if (String(s.temperature || "").trim() !== "" && !isNaN(temp)) body.temperature = temp;

    return fetch(this._url("/v1/messages"), {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: signal
    });
  };

  /** One streamed content_block_delta / message_stop / error event. */
  Client.prototype._handleEvent = function (evt) {
    var self = this;
    var d = evt.data;
    if (evt.event === "error" || (d && d.type === "error")) {
      self.onError(new Error((d && d.error && d.error.message) || "The connection to Claude was interrupted."));
      return;
    }
    if (!d || typeof d !== "object") return;

    if (d.type === "content_block_start") {
      if (d.content_block && d.content_block.type === "thinking") {
        self.onActivity({ type: "typing", text: "Thinking\u2026", channelData: { streamType: "informative" } });
      }
      return;
    }
    if (d.type === "content_block_delta") {
      var delta = d.delta || {};
      if (delta.type === "text_delta" && delta.text) {
        self._gotText = true;
        self._accum += delta.text;
        self.onActivity({
          type: "typing",
          text: delta.text,
          channelData: { streamId: self.replyId, streamType: "streaming" }
        });
      }
      return;
    }
    if (d.type === "message_delta") {
      if (d.delta && d.delta.stop_reason) self._stopReason = d.delta.stop_reason;
      return;
    }
    // message_start, content_block_stop, ping: nothing this client needs.
  };

  /** Close out the live bubble, whether the turn finished cleanly or not. */
  Client.prototype._finish = function (fromError) {
    if (this._finished) return;
    this._finished = true;

    var text = this._accum || "";
    if (!text) {
      // Nothing ever streamed. If that is because the connection broke,
      // there is nothing to show and the rejection alone should explain it;
      // otherwise say so plainly rather than leaving a silent gap.
      if (fromError) return;
      text = this._stopReason === "refusal"
        ? "Claude declined to respond to this message."
        : "Claude did not return any text for this message.";
    } else if (this._stopReason === "max_tokens") {
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
  Client.prototype._send = function (contentBlocks) {
    var self = this;
    if (self.closed) return Promise.reject(new Error("This chat is no longer connected."));
    if (!isConfigured(self.settings)) return Promise.reject(configError());
    if (!contentBlocks.length) return Promise.reject(new Error("Nothing to send."));

    var attempt = self.history.concat([{ role: "user", content: contentBlocks }]);
    var payload = mergeRuns(attempt);

    self.replyId = "claude-" + (global.Store ? global.Store.uid() : String(Date.now()));
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
    var blocks = [];
    if (text) blocks.push({ type: "text", text: String(text) });
    if (!blocks.length) return Promise.reject(new Error("Nothing to send."));
    return this._send(blocks);
  };

  /**
   * Images and PDFs travel as native content blocks; readable text files are
   * already inlined into `text` by chat.js before this is called. Anything
   * else gets a short note instead of silently vanishing.
   */
  Client.prototype.upload = function (fileList, text) {
    var self = this;
    var files = Array.prototype.slice.call(fileList || []);
    return Promise.all(files.map(fileToBlocks)).then(function (groups) {
      var blocks = [];
      groups.forEach(function (g) { if (g && g.length) blocks = blocks.concat(g); });
      if (text) blocks.push({ type: "text", text: String(text) });
      if (!blocks.length) {
        return Promise.reject(new Error(
          "None of the attached file types are supported by Claude, and there is no message text to send."
        ));
      }
      return self._send(blocks);
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
    return fetch(baseUrl(settings) + "/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 1,
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }]
      })
    }).then(function (res) {
      if (res.ok) return true;
      return res.text().then(function (body) { throw httpError(res.status, body); });
    });
  }

  global.AnthropicClient = {
    connect: connect,
    isConfigured: isConfigured,
    testConnection: testConnection,
    baseUrl: baseUrl,
    Client: Client,
    API_VERSION: API_VERSION,
    DEFAULT_BASE: DEFAULT_BASE,
    DEFAULT_MAX_TOKENS: DEFAULT_MAX_TOKENS
  };
})(typeof window !== "undefined" ? window : this);
