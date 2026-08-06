/* ==========================================================================
   store.js — BIG A durable storage
   --------------------------------------------------------------------------
   Everything the workspace knows lives here: chats, the full message
   transcript of every chat, projects, attachments and preferences.

   Storage strategy, in order of preference:

     1. IndexedDB  — the real store. Survives page closure, browser restart
                     and machine shutdown, holds binary attachments, and has
                     no practical size ceiling.
     2. localStorage — automatic fallback when IndexedDB is unavailable
                     (private windows, hardened browsers). Text only.

   `navigator.storage.persist()` is requested on start so the browser marks
   the origin as persistent and stops evicting it under disk pressure.

   Writes broadcast on a BroadcastChannel, so two tabs of the same workspace
   stay in step.
   ========================================================================== */

(function (global) {
  "use strict";

  var DB_NAME = "biga";
  var DB_VERSION = 1;
  var STORES = ["chats", "messages", "projects", "kv", "blobs"];
  var LS_PREFIX = "biga.fallback.";

  var db = null;
  var usingFallback = false;
  var readyPromise = null;
  var channel = null;
  var listeners = [];

  /* ------------------------------------------------------------ utilities */

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function noop() {}

  /* --------------------------------------------------------- localStorage */
  /* A minimal object-store emulation so the rest of the file has one shape
     to talk to regardless of which backend is live.                        */

  var fallback = {
    read: function (name) {
      try { return JSON.parse(localStorage.getItem(LS_PREFIX + name) || "{}"); }
      catch (e) { return {}; }
    },
    write: function (name, obj) {
      try { localStorage.setItem(LS_PREFIX + name, JSON.stringify(obj)); return true; }
      catch (e) { return false; }
    },
    put: function (name, key, value) {
      var all = fallback.read(name);
      all[key] = value;
      return fallback.write(name, all);
    },
    get: function (name, key) {
      var all = fallback.read(name);
      return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : undefined;
    },
    del: function (name, key) {
      var all = fallback.read(name);
      delete all[key];
      fallback.write(name, all);
    },
    all: function (name) {
      var obj = fallback.read(name);
      return Object.keys(obj).map(function (k) { return obj[k]; });
    },
    clear: function (name) {
      try { localStorage.removeItem(LS_PREFIX + name); } catch (e) { noop(); }
    }
  };

  /* --------------------------------------------------------------- open */

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }

      var req;
      try { req = global.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }

      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains("chats")) {
          d.createObjectStore("chats", { keyPath: "id" }).createIndex("updated", "updated");
        }
        if (!d.objectStoreNames.contains("messages")) {
          var ms = d.createObjectStore("messages", { keyPath: "id" });
          ms.createIndex("chatId", "chatId");
          ms.createIndex("chat_time", ["chatId", "t"]);
        }
        if (!d.objectStoreNames.contains("projects")) {
          d.createObjectStore("projects", { keyPath: "id" });
        }
        if (!d.objectStoreNames.contains("kv")) {
          d.createObjectStore("kv", { keyPath: "k" });
        }
        if (!d.objectStoreNames.contains("blobs")) {
          d.createObjectStore("blobs", { keyPath: "id" });
        }
      };

      req.onsuccess = function () {
        var d = req.result;
        d.onversionchange = function () { try { d.close(); } catch (e) { noop(); } };
        resolve(d);
      };
      req.onerror = function () { reject(req.error || new Error("Could not open IndexedDB")); };
      req.onblocked = function () { reject(new Error("IndexedDB blocked by another tab")); };

      // Safari occasionally never fires any handler in private mode.
      setTimeout(function () { reject(new Error("IndexedDB open timed out")); }, 4000);
    });
  }

  function ready() {
    if (readyPromise) return readyPromise;

    readyPromise = openDB()
      .then(function (d) { db = d; usingFallback = false; })
      .catch(function () { usingFallback = true; })
      .then(function () {
        // Ask the browser not to evict us. Best effort; never fatal.
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persisted()
            .then(function (already) { return already ? true : navigator.storage.persist(); })
            .catch(noop);
        }
        try {
          if (global.BroadcastChannel) {
            channel = new global.BroadcastChannel("biga-store");
            channel.onmessage = function (e) {
              listeners.forEach(function (fn) { try { fn(e.data); } catch (err) { noop(); } });
            };
          }
        } catch (e) { noop(); }
        return { fallback: usingFallback };
      });

    return readyPromise;
  }

  function announce(storeName, action, id) {
    if (channel) { try { channel.postMessage({ store: storeName, action: action, id: id }); } catch (e) { noop(); } }
  }

  function onRemoteChange(fn) { listeners.push(fn); }

  /* ------------------------------------------------------- generic access */

  function tx(name, mode) {
    return db.transaction(name, mode).objectStore(name);
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function put(storeName, value) {
    return ready().then(function () {
      if (usingFallback) {
        var key = value.id || value.k;
        fallback.put(storeName, key, value);
        announce(storeName, "put", key);
        return value;
      }
      return wrap(tx(storeName, "readwrite").put(value)).then(function () {
        announce(storeName, "put", value.id || value.k);
        return value;
      });
    });
  }

  function get(storeName, key) {
    return ready().then(function () {
      if (usingFallback) return fallback.get(storeName, key);
      return wrap(tx(storeName, "readonly").get(key));
    });
  }

  function del(storeName, key) {
    return ready().then(function () {
      if (usingFallback) { fallback.del(storeName, key); announce(storeName, "delete", key); return; }
      return wrap(tx(storeName, "readwrite").delete(key)).then(function () {
        announce(storeName, "delete", key);
      });
    });
  }

  function all(storeName) {
    return ready().then(function () {
      if (usingFallback) return fallback.all(storeName);
      var store = tx(storeName, "readonly");
      if (store.getAll) return wrap(store.getAll());
      return new Promise(function (resolve) {
        var out = [];
        store.openCursor().onsuccess = function (e) {
          var cur = e.target.result;
          if (!cur) { resolve(out); return; }
          out.push(cur.value);
          cur.continue();
        };
      });
    });
  }

  function clearStore(storeName) {
    return ready().then(function () {
      if (usingFallback) { fallback.clear(storeName); announce(storeName, "clear"); return; }
      return wrap(tx(storeName, "readwrite").clear()).then(function () { announce(storeName, "clear"); });
    });
  }

  /* ---------------------------------------------------------------- chats */

  var chats = {
    list: function () {
      return all("chats").then(function (rows) {
        return rows.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
      });
    },
    get: function (id) { return get("chats", id); },
    put: function (chat) {
      chat.updated = chat.updated || Date.now();
      return put("chats", chat);
    },
    remove: function (id) {
      return messages.clear(id).then(function () { return del("chats", id); });
    }
  };

  /* ------------------------------------------------------------- messages */

  var messages = {
    list: function (chatId) {
      return ready().then(function () {
        if (usingFallback) {
          return fallback.all("messages")
            .filter(function (m) { return m.chatId === chatId; })
            .sort(function (a, b) { return a.t - b.t; });
        }
        var idx = tx("messages", "readonly").index("chatId");
        if (idx.getAll) {
          return wrap(idx.getAll(chatId)).then(function (rows) {
            return rows.sort(function (a, b) { return a.t - b.t; });
          });
        }
        return new Promise(function (resolve) {
          var out = [];
          idx.openCursor(IDBKeyRange.only(chatId)).onsuccess = function (e) {
            var cur = e.target.result;
            if (!cur) { resolve(out.sort(function (a, b) { return a.t - b.t; })); return; }
            out.push(cur.value);
            cur.continue();
          };
        });
      });
    },
    add: function (msg) {
      if (!msg.id) msg.id = uid();
      if (!msg.t) msg.t = Date.now();
      return put("messages", msg).then(function () { return msg; });
    },
    update: function (msg) { return put("messages", msg); },
    remove: function (id) { return del("messages", id); },
    clear: function (chatId) {
      return messages.list(chatId).then(function (rows) {
        return Promise.all(rows.map(function (m) { return del("messages", m.id); }));
      });
    },
    countAll: function () { return all("messages").then(function (r) { return r.length; }); }
  };

  /* ------------------------------------------------------------- projects */

  var projects = {
    list: function () {
      return all("projects").then(function (rows) {
        return rows.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      });
    },
    put: function (p) { return put("projects", p); },
    remove: function (id) { return del("projects", id); }
  };

  /* -------------------------------------------------------------- kv pairs */

  var kv = {
    get: function (key, dflt) {
      return get("kv", key).then(function (row) {
        return row && "v" in row ? row.v : dflt;
      });
    },
    set: function (key, value) { return put("kv", { k: key, v: value }); },
    remove: function (key) { return del("kv", key); },
    all: function () {
      return all("kv").then(function (rows) {
        var out = {};
        rows.forEach(function (r) { out[r.k] = r.v; });
        return out;
      });
    }
  };

  /* ---------------------------------------------------------------- blobs */
  /* Attachments are kept as real Blobs in IndexedDB. The fallback keeps a
     data URL instead, which is bulkier but still works.                    */

  var blobs = {
    put: function (id, blob) {
      return ready().then(function () {
        if (usingFallback) {
          return new Promise(function (resolve) {
            var r = new FileReader();
            r.onload = function () {
              fallback.put("blobs", id, { id: id, dataUrl: r.result });
              resolve(id);
            };
            r.onerror = function () { resolve(id); };
            r.readAsDataURL(blob);
          });
        }
        return put("blobs", { id: id, blob: blob }).then(function () { return id; });
      });
    },
    url: function (id) {
      return get("blobs", id).then(function (row) {
        if (!row) return null;
        if (row.dataUrl) return row.dataUrl;
        if (row.blob) return URL.createObjectURL(row.blob);
        return null;
      });
    },
    get: function (id) { return get("blobs", id); },
    remove: function (id) { return del("blobs", id); }
  };

  /* -------------------------------------------------------- backup / wipe */

  /** A complete, portable snapshot. Lets a workspace move between machines. */
  function exportAll() {
    return Promise.all([chats.list(), all("messages"), projects.list(), kv.all()])
      .then(function (r) {
        return {
          format: "biga-workspace",
          version: 1,
          exported: new Date().toISOString(),
          chats: r[0],
          messages: r[1],
          projects: r[2],
          settings: r[3]
        };
      });
  }

  function importAll(data, opts) {
    opts = opts || {};
    if (!data || data.format !== "biga-workspace") {
      return Promise.reject(new Error("That file is not a BIG A workspace backup."));
    }
    var step = opts.replace
      ? Promise.all(["chats", "messages", "projects"].map(clearStore))
      : Promise.resolve();

    return step.then(function () {
      var jobs = [];
      (data.chats || []).forEach(function (c) { jobs.push(put("chats", c)); });
      (data.messages || []).forEach(function (m) { jobs.push(put("messages", m)); });
      (data.projects || []).forEach(function (p) { jobs.push(put("projects", p)); });
      Object.keys(data.settings || {}).forEach(function (k) { jobs.push(kv.set(k, data.settings[k])); });
      return Promise.all(jobs);
    }).then(function () {
      return { chats: (data.chats || []).length, messages: (data.messages || []).length };
    });
  }

  function wipe() {
    return Promise.all(STORES.map(clearStore));
  }

  function usage() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().catch(function () { return {}; });
    }
    return Promise.resolve({});
  }

  global.Store = {
    ready: ready,
    uid: uid,
    chats: chats,
    messages: messages,
    projects: projects,
    kv: kv,
    blobs: blobs,
    exportAll: exportAll,
    importAll: importAll,
    wipe: wipe,
    usage: usage,
    onRemoteChange: onRemoteChange,
    isFallback: function () { return usingFallback; }
  };
})(typeof window !== "undefined" ? window : this);
