/* ==========================================================================
   gemini.js — BIG A transport for Gemini, direct to Google's free API tier
   --------------------------------------------------------------------------
   Structurally this is the same idea as anthropic.js: the Gemini API is
   stateless too, so there is no server-side conversation to resume — this
   client keeps an in-memory `history` array of Gemini-shaped {role, parts}
   turns, seeded once from BIG A's local transcript when the chat opens and
   grown turn by turn as replies stream back. See anthropic.js's file header
   for the fuller rationale; it applies here unchanged.

   Two things are Gemini-specific and worth flagging for whoever touches this
   next:

   1. This deliberately calls the classic REST surface —
      POST /v1beta/models/{model}:streamGenerateContent?alt=sse — rather than
      Google's newer "Interactions API" (/v1beta/interactions). As of this
      writing the Interactions API's browser SDK sends an `Api-Revision`
      header that is not in generativelanguage.googleapis.com's CORS
      allow-list, so it fails outright from a browser. The classic endpoint
      used here has been verified to answer CORS preflights correctly for
      `content-type` and `x-goog-api-key`, which is what makes calling it
      directly from this static site possible at all.
   2. "Free" here means Google's no-credit-card Gemini API free tier, which
      only covers Flash-class models — Pro-tier models generally need a
      billed key even for light use. The model list in Connection settings
      reflects that split, and free-tier requests may be used by Google to
      improve their models, unlike the paid tier. Both are called out in the
      README and the Connection settings hint text, not just here.
   ========================================================================== */

(function (global) {
  "use strict";

  var API_VERSION = "v1beta";
  var DEFAULT_BASE = "https://generativelanguage.googleapis.com";
  var DEFAULT_MAX_TOKENS = 4096;
  var MAX_TOKENS_CEILING = 65536;   // current Gemini 3.x models cap output around 64K

  /* Same rationale as anthropic.js: readable text is inlined by chat.js
     before this client ever sees it, so it does not need its own block. */
  var IMAGE_TYPE_RE = /^image\/(png|jpe?g|gif|webp|heic|heif)/i;
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
    if (IMAGE_TYPE_RE.test(t)) return t;
    var ext = String(name || "").split(".").pop().toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    if (ext === "heic" || ext === "heif") return "image/" + ext;
    return "image/png";
  }

  /** An inline base64 part (Gemini's `inlineData`), or a text stand-in if too large. */
  function binaryBlock(blob, name, size, mimeType) {
    if (size && size > MAX_FILE_BYTES) {
      return Promise.resolve([{
        text: "[" + (name || "file") + " was too large to send to Gemini (" +
          Math.round(size / 1048576) + " MB, limit " + Math.round(MAX_FILE_BYTES / 1048576) + " MB).]"
      }]);
    }
    return readAsBase64(blob).then(function (b64) {
      return [{ inlineData: { mimeType: mimeType || "application/octet-stream", data: b64 } }];
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
    if (IMAGE_TYPE_RE.test(type)) return binaryBlock(file, name, file.size, normaliseImageType(type, name));
    if (type === "application/pdf" || /\.pdf$/i.test(name)) return binaryBlock(file, name, file.size, "application/pdf");
    if (READABLE_RE.test(type) || READABLE_EXT_RE.test(name)) return Promise.resolve(null);
    return Promise.resolve([{
      text: "[Attached: " + name + " \u2014 Gemini can only read images, PDFs and text-like files here, " +
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
    var isImage = IMAGE_TYPE_RE.test(type) || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name);
    var isPdf = type === "application/pdf" || /\.pdf$/i.test(name);
    var isText = READABLE_RE.test(type) || READABLE_EXT_RE.test(name);

    if (!isImage && !isPdf && !isText) {
      return Promise.resolve([{ text: "[Attached: " + name + " \u2014 not readable by Gemini.]" }]);
    }
    if (!att.blobId || !Store) {
      return Promise.resolve([{ text: "[Attached: " + name + "]" }]);
    }
    return Store.blobs.get(att.blobId).then(function (row) {
      var blob = row && (row.blob || (row.dataUrl ? dataUrlToBlob(row.dataUrl) : null));
      if (!blob) return [{ text: "[Attached: " + name + " \u2014 no longer stored in this browser.]" }];
      if (isImage) return binaryBlock(blob, name, att.size || blob.size, normaliseImageType(type || blob.type, name));
      if (isPdf) return binaryBlock(blob, name, att.size || blob.size, "application/pdf");
      return blob.text().then(function (txt) {
        return [{ text: "--- FILE: " + name + " ---\n" + txt.slice(0, 200000) }];
      });
    }).catch(function () {
      return [{ text: "[Attached: " + name + "]" }];
    });
  }

  /* ------------------------------------------------------------- history */

  // Gemini calls the assistant's role "model", not "assistant".
  function apiRole(msg) { return msg.role === "assistant" ? "model" : "user"; }

  /** One stored BIG A message, turned into a Gemini {role, parts} turn. */
  function messageFromStored(msg) {
    var atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    return Promise.all(atts.map(blocksFromStoredAttachment)).then(function (groups) {
      var parts = [];
      groups.forEach(function (g) { if (g && g.length) parts = parts.concat(g); });
      var text = String(msg.text || "").trim();
      if (text && text !== "(files attached)") parts.push({ text: text });
      if (!parts.length) parts.push({ text: text || "(empty message)" });
      return { role: apiRole(msg), parts: parts };
    });
  }

  /**
   * The chat's transcript so far, as Gemini turns. Gemini is more lenient
   * about turn order than some APIs, but starting from the first user
   * message keeps this consistent with how BIG A treats every transport.
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

  /** Consecutive same-role turns merged into one. */
  function mergeRuns(list) {
    var out = [];
    list.forEach(function (m) {
      if (!m || !m.parts || !m.parts.length) return;
      var last = out[out.length - 1];
      if (last && last.role === m.role) last.parts = last.parts.concat(m.parts);
      else out.push({ role: m.role, parts: m.parts.slice() });
    });
    return out;
  }

  /* ------------------------------------------------------------ SSE parser */

  /** A small, self-contained reader for the Gemini API's SSE stream. */
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
        if (!line || line.charAt(0) === ":") return;
        var sep = line.indexOf(":");
        var field = sep === -1 ? line : line.slice(0, sep);
        var value = sep === -1 ? "" : line.slice(sep + 1).replace(/^ /, "");
        if (field === "data") dataLines.push(value);
      });
      if (!dataLines.length) return;
      var data;
      try { data = JSON.parse(dataLines.join("\n")); } catch (e) { data = null; }
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
    if (status === 400) {
      hint = " Check the API key and the model ID in Connection settings.";
    } else if (status === 401 || status === 403) {
      hint = " Check that the API key is correct and still active \u2014 create or review one at " +
             "aistudio.google.com \u203A Get API key.";
    } else if (status === 404) {
      hint = " Check the model ID in Connection settings \u2014 it may be mistyped, retired, or need a " +
             "billed key rather than the free tier.";
    } else if (status === 429) {
      hint = " The free tier's rate limit was reached. Wait a bit, or switch to a lighter model such as " +
             "Flash-Lite in Connection settings.";
    } else if (status >= 500) {
      hint = " Google's API failed to respond. This is usually temporary.";
    }

    var err = new Error("Gemini returned HTTP " + status + "." + hint + (detail ? "\n\n" + detail : ""));
    err.status = status;
    err.handled = true;
    return err;
  }

  function configError() {
    var err = new Error(
      "This agent has no Gemini API key yet. Open Connection settings and paste in a free key from " +
      "aistudio.google.com \u203A Get API key."
    );
    err.handled = true;
    return err;
  }

  /* ------------------------------------------------------------- the client */

  /**
   * opts: { settings, chatId, agentName, onActivity, onStatus, onError }
   * Same shape as anthropic.js's Client — see that file for what each
   * callback is for.
   */
  function Client(opts) {
    opts = opts || {};
    this.settings = opts.settings || {};
    this.chatId = opts.chatId || null;
    this.agentName = opts.agentName || "Gemini";
    this.onActivity = opts.onActivity || noop;
    this.onStatus = opts.onStatus || noop;
    this.onError = opts.onError || noop;

    this.transport = "gemini";
    this.closed = false;
    this.resumed = false;
    this.userId = "gemini_" + (global.Store ? global.Store.uid() : String(Date.now()));
    this.conversationId = null;   // unused; kept so saveResumePoint() stays uniform across transports
    this.watermark = null;
    this.domain = baseUrl(this.settings);
    this.history = [];
  }

  Client.prototype._url = function (method) {
    return baseUrl(this.settings) + "/" + API_VERSION + "/models/" +
      encodeURIComponent(this.settings.model) + ":" + method;
  };

  Client.prototype._headers = function () {
    return {
      "content-type": "application/json",
      "x-goog-api-key": this.settings.apiKey
    };
  };

  Client.prototype._request = function (contents, signal) {
    var s = this.settings;
    var generationConfig = { maxOutputTokens: clampMaxTokens(s.maxTokens) };
    var temp = parseFloat(s.temperature);
    if (String(s.temperature || "").trim() !== "" && !isNaN(temp)) generationConfig.temperature = temp;

    var body = { contents: contents, generationConfig: generationConfig };
    if (s.systemPrompt) body.systemInstruction = { parts: [{ text: s.systemPrompt }] };

    return fetch(this._url("streamGenerateContent") + "?alt=sse", {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: signal
    });
  };

  /** One streamed GenerateContentResponse chunk, or an error payload. */
  Client.prototype._handleEvent = function (evt) {
    var self = this;
    var d = evt.data;
    if (!d || typeof d !== "object") return;

    if (d.error) {
      self.onError(new Error((d.error && d.error.message) || "The connection to Gemini was interrupted."));
      return;
    }
    if (d.promptFeedback && d.promptFeedback.blockReason) {
      self._blockReason = d.promptFeedback.blockReason;
      return;
    }

    var cand = d.candidates && d.candidates[0];
    if (!cand) return;

    var parts = (cand.content && cand.content.parts) || [];
    parts.forEach(function (p) {
      if (typeof p.text === "string" && p.text) {
        self._gotText = true;
        self._accum += p.text;
        self.onActivity({
          type: "typing",
          text: p.text,
          channelData: { streamId: self.replyId, streamType: "streaming" }
        });
      }
    });
    if (cand.finishReason && cand.finishReason !== "STOP") self._stopReason = cand.finishReason;
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
      if (this._blockReason) {
        text = "Gemini declined to respond to this message (" +
          String(this._blockReason).toLowerCase().replace(/_/g, " ") + ").";
      } else if (this._stopReason) {
        text = "Gemini did not return text for this message (" +
          String(this._stopReason).toLowerCase().replace(/_/g, " ") + ").";
      } else {
        text = "Gemini did not return any text for this message.";
      }
    } else if (this._stopReason === "MAX_TOKENS") {
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

    var attempt = self.history.concat([{ role: "user", parts: contentParts }]);
    var payload = mergeRuns(attempt);

    self.replyId = "gemini-" + (global.Store ? global.Store.uid() : String(Date.now()));
    self._accum = "";
    self._gotText = false;
    self._stopReason = null;
    self._blockReason = null;
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
      self.history = attempt.concat([{ role: "model", parts: [{ text: self._accum || "" }] }]);
      return self;
    }).catch(function (err) {
      self._finish(true);
      throw err;
    });
  };

  Client.prototype.sendText = function (text) {
    var parts = [];
    if (text) parts.push({ text: String(text) });
    if (!parts.length) return Promise.reject(new Error("Nothing to send."));
    return this._send(parts);
  };

  /**
   * Images and PDFs travel as native inline parts; readable text files are
   * already inlined into `text` by chat.js before this is called. Anything
   * else gets a short note instead of silently vanishing.
   */
  Client.prototype.upload = function (fileList, text) {
    var self = this;
    var files = Array.prototype.slice.call(fileList || []);
    return Promise.all(files.map(fileToBlocks)).then(function (groups) {
      var parts = [];
      groups.forEach(function (g) { if (g && g.length) parts = parts.concat(g); });
      if (text) parts.push({ text: String(text) });
      if (!parts.length) {
        return Promise.reject(new Error(
          "None of the attached file types are supported by Gemini, and there is no message text to send."
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
    var url = baseUrl(settings) + "/" + API_VERSION + "/models/" +
      encodeURIComponent(settings.model) + ":generateContent";
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": settings.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        generationConfig: { maxOutputTokens: 1 }
      })
    }).then(function (res) {
      if (res.ok) return true;
      return res.text().then(function (body) { throw httpError(res.status, body); });
    });
  }

  global.GeminiClient = {
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
