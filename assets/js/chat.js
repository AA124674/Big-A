/* ==========================================================================
   chat.js — BIG A native chat surface
   --------------------------------------------------------------------------
   Renders the conversation as ordinary DOM in our own page, so it inherits
   the workspace's design system, its text can be selected and copied, files
   can be dropped straight onto it, and every message is written to durable
   storage the instant it appears.
   ========================================================================== */

(function (global) {
  "use strict";

  var A = global.Artifacts;
  var Store = global.Store;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var IMG_RE = /^image\//;
  var MAX_INLINE_TEXT = 2 * 1024 * 1024;

  var els = {};
  var hooks = {};
  var client = null;          // live transport client (Direct Line or Agents SDK)
  var chatId = null;          // active chat
  var agent = null;           // active agent record
  var pending = [];           // staged attachments, not yet sent
  var messages = [];          // rendered transcript for the active chat
  var awaiting = false;       // agent is composing
  var typingTimer = null;
  var objectUrls = [];
  var lastConnectOpts = null; // so "Try again" can repeat the real attempt

  /* A reply that is still arriving. Copilot Studio streams an answer as a
     run of activities, so the bubble is built up in place rather than
     appearing all at once at the end. */
  var stream = { key: null, msg: null, node: null, body: null, started: 0 };

  function noop() {}

  /* ------------------------------------------------------------- utilities */

  function fmtSize(b) {
    if (b == null) return "";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }

  function fmtTime(t) {
    try {
      return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function scrollToEnd(smooth) {
    if (!els.scroll) return;
    els.scroll.scrollTo({ top: els.scroll.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function nearBottom() {
    if (!els.scroll) return true;
    return els.scroll.scrollHeight - els.scroll.scrollTop - els.scroll.clientHeight < 140;
  }

  function releaseUrls() {
    objectUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { noop(); } });
    objectUrls = [];
  }

  /* --------------------------------------------------------- message store */

  function persist(msg) {
    msg.chatId = chatId;
    return Store.messages.add(msg).then(function (saved) {
      return Store.chats.get(chatId).then(function (c) {
        if (!c) return saved;
        c.updated = Date.now();
        c.preview = (msg.text || "").slice(0, 120);
        if (c.title === "New chat" && msg.role === "user" && msg.text) {
          c.title = msg.text.replace(/\s+/g, " ").trim().slice(0, 48) || "New chat";
          if (hooks.onTitle) hooks.onTitle(chatId, c.title);
        }
        return Store.chats.put(c).then(function () { return saved; });
      });
    });
  }

  /* ------------------------------------------------------------- rendering */

  function iconSvg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + "</svg>";
  }

  var I = {
    copy: '<rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    check: '<path d="m4 12 5 5L20 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    retry: '<path d="M20 11a8 8 0 1 0-.6 4M20 5v6h-6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    x: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    send: '<path d="M4 12 20 4l-3.4 8L20 20z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
    clip: '<path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.9-7.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    down: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>'
  };

  /* ------------------------------------------------------------- previews */

  var PREVIEW_TEXT_RE = /^text\/|json|csv|xml|javascript|markdown|yaml/;

  function previewable(att) {
    return IMG_RE.test(att.type || "") ||
      PREVIEW_TEXT_RE.test(att.type || "") ||
      /\.(txt|md|csv|tsv|json|log|xml|yml|yaml|js|ts|py|sql|html|css|svg)$/i.test(att.name || "") ||
      /pdf$/i.test(att.type || "");
  }

  /** Resolve an attachment to something the browser can display. */
  function attachmentUrl(att) {
    if (att.url) {
      try {
        var protocol = new URL(String(att.url), location.href).protocol.toLowerCase();
        // Plain http is accepted only when the page itself is http, i.e. local
        // development. On the deployed https site it is mixed content the
        // browser would block anyway, so refusing it here gives the user the
        // honest "cannot be previewed" message instead of a silent failure.
        var httpOk = protocol === "http:" && location.protocol === "http:";
        if (protocol === "https:" || protocol === "blob:" || httpOk) {
          return Promise.resolve(att.url);
        }
      } catch (e) { /* unsafe or malformed agent URL */ }
      return Promise.resolve(null);
    }
    if (att.blobId) {
      return Store.blobs.url(att.blobId).then(function (u) {
        if (u && u.indexOf("blob:") === 0) objectUrls.push(u);
        return u || null;
      });
    }
    return Promise.resolve(null);
  }

  var currentPreview = null;
  var previewReturnFocus = null;

  /** Full-size preview: images, PDFs and text open in place, not in a new tab. */
  function openPreview(att) {
    var modal = $("#preview-modal");
    if (!modal) { downloadAttachment(att); return; }

    currentPreview = att;
    previewReturnFocus = document.activeElement;
    $("#preview-name").textContent = att.name || "Attachment";
    $("#preview-meta").textContent =
      [(att.type || "").split(";")[0], fmtSize(att.size)].filter(Boolean).join(" · ");
    var body = $("#preview-body");
    body.innerHTML = '<p class="preview-wait">Loading preview…</p>';
    modal.classList.add("open");
    $("#scrim").classList.add("open");

    bindPreviewModal();
    var closeBtn = $("#preview-close");
    if (closeBtn) closeBtn.focus();

    attachmentUrl(att).then(function (url) {
      if (!url) { body.innerHTML = '<p class="preview-wait">This file is no longer stored in this browser.</p>'; return; }

      if (IMG_RE.test(att.type || "") || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(att.name || "")) {
        body.innerHTML = "";
        var img = document.createElement("img");
        img.className = "preview-img";
        img.alt = att.name || "Attachment";
        img.src = url;
        body.appendChild(img);
        return;
      }

      if (/pdf/i.test(att.type || "") || /\.pdf$/i.test(att.name || "")) {
        body.innerHTML = "";
        var frame = document.createElement("iframe");
        frame.className = "preview-frame";
        frame.title = att.name || "PDF preview";
        frame.setAttribute("sandbox", "allow-downloads");
        frame.src = url;
        body.appendChild(frame);
        return;
      }

      // Everything else that is readable: show the text itself.
      fetch(url).then(function (r) { return r.text(); }).then(function (text) {
        body.innerHTML = "";
        var pre = document.createElement("pre");
        pre.className = "preview-text";
        pre.textContent = text.slice(0, 400000);
        body.appendChild(pre);
      }).catch(function () {
        body.innerHTML = '<p class="preview-wait">This file type cannot be previewed. Use Download instead.</p>';
      });
    });
  }

  function closePreview() {
    var modal = $("#preview-modal");
    if (!modal) return;
    modal.classList.remove("open");
    var scrim = $("#scrim");
    // The scrim is shared with the app's other modals; only clear it if
    // nothing else is using it.
    if (scrim && !document.querySelector(".modal.open")) scrim.classList.remove("open");
    var body = $("#preview-body");
    if (body) body.innerHTML = "";
    currentPreview = null;
    if (previewReturnFocus && previewReturnFocus.focus) previewReturnFocus.focus();
    previewReturnFocus = null;
  }

  function downloadAttachment(att) {
    attachmentUrl(att).then(function (u) {
      if (!u) return;
      var a = document.createElement("a");
      a.href = u;
      a.download = att.name || "file";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  function attachmentNode(att) {
    var wrap = document.createElement("div");
    wrap.className = "att-card" + (IMG_RE.test(att.type || "") ? " att-img" : "");

    if (previewable(att)) {
      wrap.classList.add("att-open");
      wrap.tabIndex = 0;
      wrap.title = "Preview " + (att.name || "attachment");
      wrap.addEventListener("click", function (e) {
        if (e.target.closest(".att-act")) return;
        openPreview(att);
      });
      wrap.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPreview(att); }
      });
    }

    if (IMG_RE.test(att.type || "")) {
      var img = document.createElement("img");
      img.alt = att.name || "Attached image";
      img.loading = "lazy";
      wrap.appendChild(img);
      attachmentUrl(att).then(function (u) {
        if (!u) { wrap.classList.add("att-missing"); return; }
        img.src = u;
      });
      var cap = document.createElement("span");
      cap.className = "att-cap";
      cap.textContent = att.name || "image";
      wrap.appendChild(cap);
      return wrap;
    }

    wrap.innerHTML = '<span class="att-ico">' + iconSvg(I.doc) + "</span>" +
      '<span class="att-meta"><strong></strong><span></span></span>';
    $("strong", wrap).textContent = att.name || "file";
    $(".att-meta span", wrap).textContent =
      [(att.name || "").split(".").pop().toUpperCase(), fmtSize(att.size)].filter(Boolean).join(" · ");

    if (att.blobId || att.url) {
      var dl = document.createElement("button");
      dl.className = "att-act";
      dl.type = "button";
      dl.title = "Download";
      dl.setAttribute("aria-label", "Download " + (att.name || "file"));
      dl.innerHTML = iconSvg(I.down);
      dl.addEventListener("click", function (e) {
        e.stopPropagation();
        downloadAttachment(att);
      });
      wrap.appendChild(dl);
    }
    return wrap;
  }

  function messageNode(msg) {
    var row = document.createElement("article");
    row.className = "msg msg-" + msg.role + (msg.error ? " msg-error" : "");
    row.dataset.id = msg.id;

    var head = document.createElement("header");
    head.className = "msg-head";

    var name = msg.role === "user" ? "You" : (msg.agentName || (agent && agent.name) || "Assistant");

    // The agent's mark sits beside its name, so with more than one agent in
    // the workspace it is obvious which one produced a given reply.
    if (msg.role !== "user" && A.avatar) {
      head.appendChild(A.avatar({ name: name, icon: agent && agent.icon }, "sm"));
    }

    var who = document.createElement("span");
    who.className = "msg-who";
    who.textContent = name;
    head.appendChild(who);
    var time = document.createElement("time");
    time.className = "msg-time";
    time.dateTime = new Date(msg.t).toISOString();
    time.textContent = fmtTime(msg.t);
    head.appendChild(time);
    row.appendChild(head);

    var body = document.createElement("div");
    body.className = "msg-body md";
    if (msg.role === "assistant") body.innerHTML = A.markdown(msg.text || "");
    else {
      var p = document.createElement("p");
      p.textContent = msg.text || "";
      body.appendChild(p);
    }
    row.appendChild(body);

    if (msg.attachments && msg.attachments.length) {
      var tray = document.createElement("div");
      tray.className = "msg-atts";
      msg.attachments.forEach(function (a) { tray.appendChild(attachmentNode(a)); });
      row.appendChild(tray);
    }

    if (msg.citations && msg.citations.length) {
      row.appendChild(citationNode(msg.citations));
    }

    if (msg.suggested && msg.suggested.length) {
      var sug = document.createElement("div");
      sug.className = "msg-suggested";
      msg.suggested.forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sug-btn";
        b.textContent = s.title || s.value;
        b.addEventListener("click", function () { send(s.value || s.title); });
        sug.appendChild(b);
      });
      row.appendChild(sug);
    }

    // Every message carries its own copy control — the thing the framed
    // build made impossible.
    var acts = document.createElement("div");
    acts.className = "msg-acts";

    acts.appendChild(actionBtn("Copy", I.copy, function (btn) {
      copyToClipboard(msg.text || "");
      flash(btn, "Copied");
    }));

    if (msg.role === "assistant") {
      acts.appendChild(actionBtn("Copy as Markdown", I.doc, function (btn) {
        copyToClipboard(msg.text || "");
        flash(btn, "Copied");
      }));
      acts.appendChild(actionBtn("Send to workbench", I.down, function (btn) {
        if (hooks.onSendToWorkbench) hooks.onSendToWorkbench(msg.text || "");
        flash(btn, "Sent");
      }));
      acts.appendChild(actionBtn("Retry", I.retry, function () { retryFrom(msg); }));
    }

    acts.appendChild(actionBtn("Delete", I.trash, function () {
      Store.messages.remove(msg.id).then(function () {
        messages = messages.filter(function (m) { return m.id !== msg.id; });
        row.remove();
      });
    }));

    row.appendChild(acts);
    return row;
  }

  /** Sources the agent used, when it reports them (web search, files, KB). */
  function citationNode(list) {
    var box = document.createElement("details");
    box.className = "msg-cites";
    var sum = document.createElement("summary");
    sum.textContent = list.length === 1 ? "1 source" : list.length + " sources";
    box.appendChild(sum);

    var ol = document.createElement("ol");
    list.forEach(function (c) {
      var li = document.createElement("li");
      var safeUrl = c.url && Artifacts.safeUrl(c.url, false);
      if (safeUrl) {
        var a = document.createElement("a");
        a.href = safeUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = c.title || safeUrl;
        li.appendChild(a);
      } else {
        li.textContent = c.title || "Source";
      }
      if (c.snippet) {
        var s = document.createElement("span");
        s.textContent = c.snippet;
        li.appendChild(s);
      }
      ol.appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }

  /**
   * Copilot Studio reports what it consulted in the activity's entities,
   * following the schema.org Message shape used by Bot Framework.
   */
  function readCitations(act) {
    var out = [];
    var seen = Object.create(null);

    function push(url, title, snippet) {
      var key = (url || "") + "|" + (title || "");
      if (!url && !title) return;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ url: url || "", title: title || url || "Source", snippet: snippet || "" });
    }

    (act.entities || []).forEach(function (e) {
      var claims = e.citation || (e.usageInfo && [e.usageInfo]) || [];
      if (!Array.isArray(claims)) claims = [claims];
      claims.forEach(function (c) {
        if (!c) return;
        var appearance = c.appearance || c;
        push(appearance.url || c.url, appearance.name || appearance.text || c.name, appearance.abstract);
      });
      if (e.type === "https://schema.org/Message" && Array.isArray(e.citation) === false && e.url) {
        push(e.url, e.name);
      }
    });

    (act.attachments || []).forEach(function (a) {
      var c = a.content;
      if (c && Array.isArray(c.citations)) {
        c.citations.forEach(function (x) { push(x.url, x.title || x.name, x.excerpt); });
      }
    });

    return out;
  }

  function actionBtn(label, path, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "msg-act";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = iconSvg(path) + "<span>" + label + "</span>";
    b.addEventListener("click", function () { fn(b); });
    return b;
  }

  function flash(btn, text) {
    var span = $("span", btn);
    if (!span) return;
    var old = span.textContent;
    span.textContent = text;
    btn.classList.add("done");
    setTimeout(function () { span.textContent = old; btn.classList.remove("done"); }, 1400);
  }

  function copyToClipboard(text) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) { noop(); }
      ta.remove();
    }
    if (navigator.clipboard && global.isSecureContext) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else { fallback(); }
    if (hooks.onLog) hooks.onLog("Message copied", text.length + " characters");
  }

  function appendMessage(msg, animate) {
    var node = messageNode(msg);
    if (animate) node.classList.add("msg-in");
    els.list.appendChild(node);
    return node;
  }

  function renderAll() {
    releaseUrls();
    els.list.innerHTML = "";
    if (!messages.length) {
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;
    messages.forEach(function (m) { appendMessage(m, false); });
    scrollToEnd(false);
  }

  /* --------------------------------------------------------------- typing */

  var STAGE_DEFAULT = "Thinking\u2026";
  var stageLabel = STAGE_DEFAULT;
  var stageSince = 0;
  var stageTicker = null;

  function showTyping(on, label) {
    awaiting = on;
    els.typing.hidden = !on;
    els.send.classList.toggle("is-busy", on);
    els.send.innerHTML = iconSvg(on ? I.stop : I.send);
    els.send.setAttribute("aria-label", on ? "Stop" : "Send message");

    if (on) {
      if (!stageSince) stageSince = Date.now();
      setStage(label || stageLabel);
      if (!stageTicker) stageTicker = setInterval(paintStage, 1000);
    } else {
      stageSince = 0;
      stageLabel = STAGE_DEFAULT;
      clearInterval(stageTicker);
      stageTicker = null;
      if (els.typingElapsed) els.typingElapsed.textContent = "";
    }

    if (on && nearBottom()) scrollToEnd(true);
    clearTimeout(typingTimer);
    if (on) {
      // Never leave the indicator spinning forever if a reply is lost.
      typingTimer = setTimeout(function () {
        showTyping(false);
        if (hooks.onToast) hooks.onToast("The agent stopped responding before it finished.", "err");
      }, 180000);
    }
  }

  /**
   * The single most useful thing a chat client can tell you is what the agent
   * is *doing*. Copilot Studio sends that as informative messages ahead of
   * the answer, so they are surfaced verbatim rather than hidden behind a
   * generic spinner.
   */
  function setStage(label) {
    stageLabel = label || STAGE_DEFAULT;
    if (els.typingLabel) els.typingLabel.textContent = stageLabel;
    paintStage();
    if (hooks.onStage) hooks.onStage(stageLabel);
  }

  function paintStage() {
    if (!els.typingElapsed || !stageSince) return;
    var s = Math.round((Date.now() - stageSince) / 1000);
    els.typingElapsed.textContent = s >= 1 ? s + "s" : "";
  }

  /* --------------------------------------------------------- staged files */

  function stageFiles(list) {
    if (!list || !list.length) return;
    Array.prototype.forEach.call(list, function (f) {
      var item = {
        key: Store.uid(),
        file: f,
        name: f.name,
        size: f.size,
        type: f.type || "",
        previewUrl: null,
        text: null
      };
      if (IMG_RE.test(item.type)) {
        item.previewUrl = URL.createObjectURL(f);
        objectUrls.push(item.previewUrl);
      }
      var readable = /^text\/|json|csv|xml|javascript|markdown/.test(item.type) ||
        /\.(txt|md|csv|tsv|json|log|xml|yml|yaml|js|ts|py|sql|html|css)$/i.test(item.name);
      if (readable && f.size < MAX_INLINE_TEXT) {
        var r = new FileReader();
        r.onload = function () { item.text = r.result; renderStaged(); };
        r.readAsText(f);
      }
      pending.push(item);
    });
    renderStaged();
    if (hooks.onLog) hooks.onLog("Files staged", list.length + " file(s) ready to send");
  }

  /** Names, sizes and thumbnails, visible before anything is sent. */
  function renderStaged() {
    var host = els.staged;
    host.innerHTML = "";
    host.hidden = pending.length === 0;
    if (!pending.length) return;

    pending.forEach(function (item) {
      var chip = document.createElement("div");
      chip.className = "stage-chip" + (item.previewUrl ? " has-thumb" : "");

      if (item.previewUrl) {
        var img = document.createElement("img");
        img.src = item.previewUrl;
        img.alt = item.name;
        chip.appendChild(img);
      } else {
        var ic = document.createElement("span");
        ic.className = "stage-ico";
        ic.innerHTML = iconSvg(I.doc);
        chip.appendChild(ic);
      }

      var meta = document.createElement("span");
      meta.className = "stage-meta";
      var nm = document.createElement("strong");
      nm.textContent = item.name;
      nm.title = item.name;
      var sz = document.createElement("span");
      sz.textContent = fmtSize(item.size) + (item.text != null ? " · text read" : "");
      meta.appendChild(nm);
      meta.appendChild(sz);
      chip.appendChild(meta);

      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "stage-rm";
      rm.title = "Remove " + item.name;
      rm.setAttribute("aria-label", "Remove " + item.name);
      rm.innerHTML = iconSvg(I.x);
      rm.addEventListener("click", function () {
        pending = pending.filter(function (p) { return p.key !== item.key; });
        renderStaged();
      });
      chip.appendChild(rm);

      host.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------ connection */

  function setStatus(state, detail) {
    if (hooks.onStatus) hooks.onStatus(state, detail);
  }

  /* ------------------------------------------------------- activity intake */

  function activityAttachments(act) {
    return (act.attachments || []).filter(function (a) {
      return a.contentType !== "application/vnd.microsoft.card.oauth";
    }).map(function (a) {
      return {
        name: a.name || (a.content && (a.content.title || a.content.name)) || "attachment",
        type: a.contentType || "",
        size: a.contentLength || null,
        url: a.contentUrl || null
      };
    });
  }

  function activityText(act) {
    var text = act.text || "";
    if (!text && act.attachments && act.attachments.length) {
      // Adaptive cards without text still carry readable content.
      var card = act.attachments[0];
      if (card.content && typeof card.content.text === "string") text = card.content.text;
    }
    return text;
  }

  function suggestedFrom(act) {
    return act.suggestedActions && act.suggestedActions.actions
      ? act.suggestedActions.actions.map(function (s) { return { title: s.title, value: s.value || s.title }; })
      : null;
  }

  function streamInfoEntity(act) {
    var entities = act && Array.isArray(act.entities) ? act.entities : [];
    return entities.filter(function (e) {
      return e && String(e.type || "").toLowerCase() === "streaminfo";
    })[0] || {};
  }

  /** Which streamed reply an activity belongs to. */
  function streamKey(act) {
    var cd = act.channelData || {};
    var info = streamInfoEntity(act);
    return info.streamId || cd.streamId || (act.replyToId ? "reply:" + act.replyToId : null) || act.id || null;
  }

  function streamType(act) {
    var cd = act.channelData || {};
    var info = streamInfoEntity(act);
    var t = (info.streamType || cd.streamType || "").toLowerCase();
    if (t) return t;
    if (act.type === "typing" && act.text) return "streaming";
    if (act.type === "message") return "final";
    return "";
  }

  /** Start or update the in-place bubble for a reply that is still arriving. */
  function pushStream(act, text) {
    var key = streamKey(act) || "live";

    if (!stream.msg || stream.key !== key) {
      finishStream();
      stream.key = key;
      stream.started = Date.now();
      stream.msg = {
        id: Store.uid(),
        chatId: chatId,
        role: "assistant",
        text: text,
        attachments: [],
        agentName: (agent && agent.name) || (act.from && act.from.name) || "Assistant",
        t: Date.now(),
        activityId: act.id,
        streaming: true
      };
      els.empty.hidden = true;
      var stick = nearBottom();
      stream.node = appendMessage(stream.msg, true);
      stream.node.classList.add("msg-streaming");
      stream.body = $(".msg-body", stream.node);
      if (stick) scrollToEnd(true);
    } else {
      // Chunks may be cumulative or incremental; both are handled.
      var prev = stream.msg.text || "";
      if (text.length >= prev.length && text.indexOf(prev) === 0) stream.msg.text = text;
      else if (prev.indexOf(text) === 0) { /* a repeat of what we already have */ }
      else stream.msg.text = prev + text;
    }

    if (stream.body) stream.body.innerHTML = A.markdown(stream.msg.text || "");
    if (nearBottom()) scrollToEnd(false);
  }

  /** Turn the live bubble into a normal, stored message. */
  function finishStream(act) {
    if (!stream.msg) return null;

    var msg = stream.msg;
    delete msg.streaming;

    if (act) {
      var finalText = activityText(act);
      if (finalText && finalText.length >= (msg.text || "").length) msg.text = finalText;
      msg.attachments = activityAttachments(act);
      msg.suggested = suggestedFrom(act);
      var cites = readCitations(act);
      if (cites.length) msg.citations = cites;
      msg.activityId = act.id || msg.activityId;
    }

    messages.push(msg);
    persist(msg);

    // Re-render the finished message so actions, attachments and sources appear.
    var fresh = messageNode(msg);
    if (stream.node && stream.node.parentNode) stream.node.replaceWith(fresh);
    else els.list.appendChild(fresh);

    stream = { key: null, msg: null, node: null, body: null, started: 0 };
    saveResumePoint();
    return msg;
  }

  function handleActivity(act) {
    if (!act) return;

    if (act.from && act.from.role === "user") return;          // our own echo
    if (client && act.from && act.from.id === client.userId) return;

    /* --- progress and streaming ------------------------------------- */

    if (act.type === "typing") {
      var kind = streamType(act);
      var t = act.text || "";

      if (kind === "informative" || (t && !act.channelData)) {
        // "Searching the web", "Looking through your files", and friends.
        if (t && kind === "informative") { showTyping(true, t.replace(/\s+$/, "")); return; }
      }
      if (t && (kind === "streaming" || kind === "informative")) {
        if (kind === "informative") { showTyping(true, t); return; }
        showTyping(true, "Responding\u2026");
        pushStream(act, t);
        return;
      }
      showTyping(true, stageLabel === STAGE_DEFAULT ? STAGE_DEFAULT : stageLabel);
      return;
    }

    if (act.type === "event") {
      var name = act.name || "";
      if (/search/i.test(name)) showTyping(true, "Searching\u2026");
      else if (/tool|action|flow/i.test(name)) showTyping(true, "Running a tool\u2026");
      return;
    }

    if (act.type === "endOfConversation") {
      finishStream();
      showTyping(false);
      setStatus("online", "The agent ended the conversation.");
      return;
    }

    if (act.type !== "message") return;

    var text = activityText(act);
    var atts = activityAttachments(act);

    /* A final chunk of a streamed reply closes the live bubble. */
    if (stream.msg && (streamType(act) === "final" || streamKey(act) === stream.key || text)) {
      showTyping(false);
      finishStream(act);
      return;
    }

    if (!text && !atts.length) return;

    showTyping(false);

    var msg = {
      id: Store.uid(),
      chatId: chatId,
      role: "assistant",
      text: text,
      attachments: atts,
      agentName: (agent && agent.name) || (act.from && act.from.name) || "Assistant",
      t: Date.now(),
      activityId: act.id,
      suggested: suggestedFrom(act)
    };

    var cites = readCitations(act);
    if (cites.length) msg.citations = cites;

    messages.push(msg);
    els.empty.hidden = true;
    var stick = nearBottom();
    appendMessage(msg, true);
    if (stick) scrollToEnd(true);
    persist(msg);

    // Remember where we are so the same conversation can be resumed.
    saveResumePoint();
  }

  function saveResumePoint() {
    if (!client || !chatId) return;
    Store.chats.get(chatId).then(function (c) {
      if (!c) return;
      c.transport = client.transport || "directline";
      c.conversationId = client.conversationId;
      c.watermark = client.watermark;
      c.domain = client.domain;
      c.userId = client.userId;
      c.tokenEndpoint = client.tokenEndpoint;
      return Store.chats.put(c);
    });
  }

  /**
   * Open a live channel for the active chat, resuming the previous Direct
   * Line conversation when the service still has it.
   */
  function connect(opts) {
    opts = opts || {};
    lastConnectOpts = opts;
    var chat = opts.chat || {};
    var transport = opts.transport === "directline" ? "directline" : "m365";

    if (client) { try { client.end(); } catch (e) { noop(); } client = null; }
    finishStream();
    showTyping(false);

    setStatus("connecting");
    els.error.hidden = true;

    var attempt = transport === "m365"
      ? connectM365(opts, chat)
      : connectDirectLine(opts, chat);

    return attempt.then(function (c) {
      client = c;
      setStatus("online", transport === "m365"
        ? "Microsoft 365 Agents SDK · Direct-to-Engine"
        : "Direct Line 3.0");
      els.composer.classList.remove("disabled");
      els.input.disabled = false;
      saveResumePoint();
      // Only trigger the greeting on a genuinely new conversation, so
      // resuming does not replay it.
      if (!c.resumed && !c.greetingSentOnStart && !messages.length && c.sendGreetingTrigger) c.sendGreetingTrigger();
      if (hooks.onConnected) hooks.onConnected(c);
      return c;
    }).catch(function (err) {
      setStatus("offline", err && err.message);
      showError(err);
      throw err;
    });
  }

  /** Current protocol: Copilot Studio over the Microsoft 365 Agents SDK. */
  function connectM365(opts, chat) {
    if (!global.M365Agents) {
      return Promise.reject(new Error("The Agents SDK transport failed to load."));
    }
    var settings = opts.settings || {};
    var resumable = chat.transport === "m365" ? chat.conversationId : null;

    return global.M365Agents.connect({
      settings: settings,
      getToken: opts.getToken,
      conversationId: resumable || null,
      userId: chat.userId || null,
      greeting: !messages.length,
      onActivity: handleActivity,
      onStatus: function (s) {
        if (s === "online") setStatus("online");
        else if (s === "idle") { showTyping(false); setStatus("online"); }
        else if (s === "reconnecting") setStatus("reconnecting");
        else setStatus("connecting");
      },
      onError: function (e) { if (hooks.onToast) hooks.onToast(e.message, "err"); }
    });
  }

  /** Legacy path, for agents that still publish a Direct Line token endpoint. */
  function connectDirectLine(opts, chat) {
    return global.DirectLine.connect({
      agentUrl: agent && agent.url,
      tokenEndpoint: opts.tokenEndpoint || chat.tokenEndpoint || (agent && agent.tokenEndpoint) || "",
      envId: opts.envId || (agent && agent.environmentId) || "",
      bearer: opts.bearer || null,
      conversationId: chat.transport === "directline" ? chat.conversationId : null,
      watermark: chat.transport === "directline" ? chat.watermark : null,
      userId: chat.userId || null,
      onActivity: handleActivity,
      onStatus: function (s) {
        if (s === "online") setStatus("online");
        else if (s === "reconnecting") setStatus("reconnecting");
        else setStatus("connecting");
      }
    }).then(function (c) {
      c.transport = "directline";
      return c;
    });
  }

  function showError(err) {
    els.error.hidden = false;
    var msg = err && err.message ? err.message : String(err);

    // When endpoint discovery failed, the single headline status code is not
    // enough to act on. List what was actually tried, so the difference
    // between "wrong address" and "agent needs sign-in" is visible.
    if (err && err.attempts && err.attempts.length) {
      msg += "\n\nTried " + err.attempts.length +
        (err.attempts.length === 1 ? " address:" : " addresses:");
      err.attempts.forEach(function (a) {
        var host = a.endpoint;
        try { host = new URL(a.endpoint).host; } catch (e) { /* keep it raw */ }
        msg += "\n  " + host + " — " + (a.status ? "HTTP " + a.status : "unreachable");
      });
    }

    $("#chat-error-msg").textContent = msg;
  }

  /** Shown before any connection exists, so the composer is not a dead end. */
  function showSetupNeeded(message) {
    if (client) { try { client.end(); } catch (e) { noop(); } client = null; }
    showTyping(false);
    els.composer.classList.add("disabled");
    els.input.disabled = true;
    showError(new Error(message));
  }

  /* ------------------------------------------------------------- outbound */

  function send(text) {
    text = (text != null ? text : els.input.value).trim();
    var hasFiles = pending.length > 0;
    if (!text && !hasFiles) return;

    if (!client) {
      showError(new Error("Not connected yet. Check the connection settings, then try again."));
      return;
    }

    // Text extracted from readable attachments rides along with the prompt so
    // the agent can actually use it, even when it has no file handling.
    var context = pending.filter(function (p) { return p.text != null; })
      .map(function (p) { return "--- FILE: " + p.name + " (" + fmtSize(p.size) + ") ---\n" + p.text; })
      .join("\n\n");

    var outbound = context ? (context + "\n--- END OF FILES ---\n\n" + (text || "Please review the files above.")) : text;

    var staged = pending.slice();
    var msg = {
      id: Store.uid(),
      chatId: chatId,
      role: "user",
      text: text || "(files attached)",
      attachments: staged.map(function (p) {
        return { name: p.name, size: p.size, type: p.type, blobId: p.key };
      }),
      t: Date.now()
    };

    // Keep the actual bytes so previews survive a reload.
    staged.forEach(function (p) { Store.blobs.put(p.key, p.file); });

    messages.push(msg);
    els.empty.hidden = true;
    appendMessage(msg, true);
    scrollToEnd(true);
    persist(msg);

    els.input.value = "";
    autoGrow();
    pending = [];
    renderStaged();
    showTyping(true, staged.length ? "Uploading " + staged.length + (staged.length === 1 ? " file\u2026" : " files\u2026") : STAGE_DEFAULT);

    var job = staged.length
      ? client.upload(staged.map(function (p) { return p.file; }), outbound)
          .then(function (r) { setStage(STAGE_DEFAULT); return r; })
          .catch(function (err) {
            // Fall back to text-only so the turn is not lost; the extracted
            // text is already in the prompt.
            if (hooks.onToast) hooks.onToast("Files could not be sent to the agent (" + err.message + "). Sending the text instead.", "err");
            setStage(STAGE_DEFAULT);
            return client.sendText(outbound);
          })
      : client.sendText(outbound);

    job.then(function () { saveResumePoint(); })
      .catch(function (err) {
        showTyping(false);
        msg.error = true;
        var node = els.list.querySelector('[data-id="' + msg.id + '"]');
        if (node) node.classList.add("msg-error");
        Store.messages.update(msg);
        if (hooks.onToast) hooks.onToast(err.message, "err");
      });
  }

  function retryFrom(assistantMsg) {
    // Find the user turn that produced this reply and send it again.
    var idx = messages.findIndex(function (m) { return m.id === assistantMsg.id; });
    for (var i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        var t = messages[i].text;
        if (client) { showTyping(true); client.sendText(t).catch(noop); }
        return;
      }
    }
  }

  /* ---------------------------------------------------------------- input */

  function autoGrow() {
    var ta = els.input;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }

  /* ------------------------------------------------------------ drag/drop */

  function bindDropzone() {
    var depth = 0;
    var surface = els.surface;

    ["dragenter", "dragover", "dragleave", "drop"].forEach(function (ev) {
      surface.addEventListener(ev, function (e) {
        if (ev === "dragenter" || ev === "dragover") {
          if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") === -1) return;
        }
        e.preventDefault();
        e.stopPropagation();
      });
    });

    surface.addEventListener("dragenter", function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") === -1) return;
      depth++;
      surface.classList.add("dropping");
    });
    surface.addEventListener("dragleave", function () {
      depth = Math.max(0, depth - 1);
      if (!depth) surface.classList.remove("dropping");
    });
    surface.addEventListener("drop", function (e) {
      depth = 0;
      surface.classList.remove("dropping");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        stageFiles(e.dataTransfer.files);
        els.input.focus();
      }
    });

    // Dropping anywhere else in the window should not navigate away from
    // the app — a classic way to lose an unsent message.
    ["dragover", "drop"].forEach(function (ev) {
      global.addEventListener(ev, function (e) {
        if (surface.contains(e.target)) return;
        e.preventDefault();
      });
    });
  }

  /* ------------------------------------------------------------------ API */

  function mount(config) {
    hooks = config.hooks || {};

    els.surface = $("#chat-surface");
    els.scroll = $("#chat-scroll");
    els.list = $("#chat-list-msgs");
    els.empty = $("#chat-empty");
    els.typing = $("#chat-typing");
    els.typingLabel = $("#chat-typing-label");
    els.typingElapsed = $("#chat-typing-elapsed");
    els.error = $("#chat-error");
    els.composer = $("#composer");
    els.input = $("#composer-input");
    els.send = $("#composer-send");
    els.attach = $("#composer-attach");
    els.file = $("#composer-file");
    els.staged = $("#composer-staged");
    els.drop = $("#chat-drop");

    els.send.innerHTML = iconSvg(I.send);
    els.attach.innerHTML = iconSvg(I.clip);

    els.send.addEventListener("click", function () {
      if (awaiting) { showTyping(false); return; }
      send();
    });
    els.attach.addEventListener("click", function () { els.file.click(); });
    els.file.addEventListener("change", function () {
      stageFiles(els.file.files);
      els.file.value = "";
    });

    els.input.addEventListener("input", autoGrow);
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    els.input.addEventListener("paste", function (e) {
      var items = e.clipboardData && e.clipboardData.files;
      if (items && items.length) { e.preventDefault(); stageFiles(items); }
    });

    bindDropzone();

    $("#chat-retry").addEventListener("click", function () {
      // Reuse whatever settings got us here, refreshed with the stored chat.
      Store.chats.get(chatId).then(function (c) {
        var opts = {};
        for (var k in lastConnectOpts) if (Object.prototype.hasOwnProperty.call(lastConnectOpts, k)) opts[k] = lastConnectOpts[k];
        opts.chat = c || {};
        connect(opts).catch(noop);
      });
    });

    bindPreviewModal();

    return Promise.resolve();
  }

  function setAgent(a) { agent = a; }

  /** Swap to another chat: load its transcript, then reattach the channel. */
  function open(id, opts) {
    opts = opts || {};
    chatId = id;
    showTyping(false);
    pending = [];
    renderStaged();

    return Store.messages.list(id).then(function (rows) {
      messages = rows;
      renderAll();
      return Store.chats.get(id);
    }).then(function (chat) {
      if (opts.connect === false) return null;
      return connect({
        chat: chat || {},
        transport: opts.transport,
        settings: opts.settings,
        getToken: opts.getToken,
        bearer: opts.bearer,
        tokenEndpoint: opts.tokenEndpoint
      }).catch(noop);
    });
  }

  /**
   * A readable Markdown export: who said what, when, with the files that
   * travelled along and any sources the agent cited.
   */
  function transcript(opts) {
    opts = opts || {};
    var out = [];

    if (opts.title !== false) {
      out.push("# " + ((agent && agent.name) || "Copilot") + " conversation");
      out.push("_Exported " + new Date().toLocaleString() + "_");
      out.push("");
    }

    messages.forEach(function (m) {
      var who = m.role === "user" ? "You" : (m.agentName || "Assistant");
      var when = m.t ? new Date(m.t).toLocaleString() : "";
      out.push("### " + who + (when ? "  \n_" + when + "_" : ""));
      if (m.text) out.push(m.text);

      if (m.attachments && m.attachments.length) {
        out.push(m.attachments.map(function (a) {
          return "- Attachment: " + (a.name || "file") +
            (a.size ? " (" + fmtSize(a.size) + ")" : "") +
            (a.url ? " — " + a.url : "");
        }).join("\n"));
      }

      if (m.citations && m.citations.length) {
        out.push("Sources:");
        out.push(m.citations.map(function (c, i) {
          return (i + 1) + ". " + (c.title || c.url) + (c.url ? " — " + c.url : "");
        }).join("\n"));
      }

      out.push("");
    });

    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /** Copy the whole conversation, with a plain-text fallback for old browsers. */
  function copyConversation() {
    return copyToClipboard(transcript());
  }

  /* --------------------------------------------------------- preview modal */

  function bindPreviewModal() {
    var modal = $("#preview-modal");
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = "1";

    var closeBtn = $("#preview-close");
    if (closeBtn) closeBtn.addEventListener("click", closePreview);
    modal.addEventListener("click", function (e) { if (e.target === modal) closePreview(); });
    global.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("open")) closePreview();
    });
    var scrim = $("#scrim");
    if (scrim) scrim.addEventListener("click", function () {
      if (modal.classList.contains("open")) closePreview();
    });

    var dl = $("#preview-download");
    if (dl) {
      dl.addEventListener("click", function () {
        if (currentPreview) downloadAttachment(currentPreview);
      });
    }
  }

  function disconnect() {
    if (client) { try { client.end(); } catch (e) { noop(); } client = null; }
  }

  global.Chat = {
    mount: mount,
    open: open,
    connect: connect,
    setAgent: setAgent,
    send: send,
    stageFiles: stageFiles,
    transcript: transcript,
    copyConversation: copyConversation,
    showSetupNeeded: showSetupNeeded,
    disconnect: disconnect,
    copyToClipboard: copyToClipboard,
    activeId: function () { return chatId; },
    isConnected: function () { return !!client; },
    reRenderTheme: function () { /* CSS variables handle theming */ }
  };
})(typeof window !== "undefined" ? window : this);
