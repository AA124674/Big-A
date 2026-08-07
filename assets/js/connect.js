/* ==========================================================================
   connect.js — BIG A transport layer
   --------------------------------------------------------------------------
   Copilot Studio agents can be reached three ways. Each has different
   authentication behaviour, which is the whole reason this file exists.

     1. "iframe"     The hosted web-chat canvas in an <iframe>.
                     Zero setup. But if the agent has authentication turned
                     on, the sign-in card tries to open a popup from inside a
                     cross-origin frame and the flow dies. This is the mode
                     that "doesn't work with authentication enabled".

     2. "directline" We fetch a Direct Line token from the agent's own token
                     endpoint and render the conversation ourselves with Bot
                     Framework WebChat. The sign-in card now lives in OUR
                     page, so its popup is same-origin and completes normally.
                     The user clicks "Sign in" once per session.

     3. "sso"        As above, plus MSAL. We hold an Entra ID token for the
                     signed-in user, watch for the agent's OAuth card, and
                     answer it automatically. The user never sees a sign-in
                     prompt inside the chat.

   Modes 2 and 3 need two scripts that only exist on Microsoft/Bot Framework
   CDNs. They are fetched lazily, and only when one of those modes is actually
   selected, so the default install stays completely dependency-free.
   ========================================================================== */

(function (global) {
  "use strict";

  /* Each library is listed with fallbacks. Microsoft's own CDNs are tried
     first, but alcdn.msauth.net in particular is blocked by a fair number of
     school and corporate web filters, which are less likely to have heard of
     the public package mirrors. The libraries are byte-identical either way:
     the mirrors serve the same published npm artefact. */
  var WEBCHAT_CDN = [
    "assets/vendor/webchat.js",
    "https://cdn.botframework.com/botframework-webchat/latest/webchat.js",
    "https://unpkg.com/botframework-webchat@latest/dist/webchat.js"
  ];
  var MSAL_VERSION = "2.38.3";

  /* A self-hosted copy is tried before any CDN. It is not shipped, because the
     licence is Microsoft's to redistribute and the file would go stale; but if
     a network filter blocks every CDN, dropping the file at this path is the
     one fix that cannot be blocked, since it is same-origin. When it is absent
     the 404 is immediate and the CDNs are used as normal. */
  var MSAL_CDN = [
    "assets/vendor/msal-browser.min.js",
    "https://alcdn.msauth.net/browser/" + MSAL_VERSION + "/js/msal-browser.min.js",
    "https://cdn.jsdelivr.net/npm/@azure/msal-browser@" + MSAL_VERSION + "/lib/msal-browser.min.js",
    "https://unpkg.com/@azure/msal-browser@" + MSAL_VERSION + "/lib/msal-browser.min.js"
  ];
  var DEFAULT_DIRECTLINE = "https://directline.botframework.com/v3/directline";

  var loaded = {};

  /** Inject one <script> and resolve when the global it defines appears. */
  function injectScript(url, globalName) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.async = true;
      // No crossOrigin: it buys nothing without integrity hashes, and it turns
      // an otherwise-fine response missing CORS headers into a hard failure.
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        s.parentNode && s.parentNode.removeChild(s);
        reject(new Error("Timed out loading " + url));
      }, 15000);

      s.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (globalName && !global[globalName]) {
          reject(new Error("Loaded " + url + " but window." + globalName + " is missing."));
          return;
        }
        resolve(globalName ? global[globalName] : true);
      };
      s.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        s.parentNode && s.parentNode.removeChild(s);
        reject(new Error("Could not load " + url));
      };
      document.head.appendChild(s);
    });
  }

  /**
   * Load a library, trying each mirror in turn. A failure is deliberately not
   * cached, so pressing Sign in again after fixing the network actually
   * retries rather than replaying the old error forever.
   */
  function loadScript(urls, globalName) {
    var list = [].concat(urls);
    var key = globalName || list[0];

    if (globalName && global[globalName]) return Promise.resolve(global[globalName]);
    if (loaded[key]) return loaded[key];

    var attempt = function (i, errs) {
      if (i >= list.length) {
        var remote = list.filter(function (u) { return /^https?:/i.test(u); });
        return Promise.reject(new Error(
          "Could not load the Microsoft sign-in library from any of " + remote.length +
          " sources.\n\n" +
          "This is a network problem, not a problem with your Azure setup: the sign-in never " +
          "reached Microsoft. Open Connection settings and press \u201cCheck network access\u201d " +
          "to see which sources are blocked.\n\n" +
          "Details: " + errs.join(" | ")
        ));
      }
      return injectScript(list[i], globalName).catch(function (e) {
        return attempt(i + 1, errs.concat([e.message]));
      });
    };

    loaded[key] = attempt(0, []).catch(function (e) {
      delete loaded[key];
      throw e;
    });
    return loaded[key];
  }

  /**
   * Try every source in turn and report what happened to each, so a blocked
   * CDN can be told apart from a wrong client ID, a dead connection or an
   * extension. Uses fetch(no-cors) purely as a reachability probe: an opaque
   * response still proves the request left the browser and something answered.
   */
  function diagnose() {
    var targets = [
      { label: "Self-hosted copy", url: MSAL_CDN[0], optional: true },
      { label: "Microsoft CDN", url: MSAL_CDN[1] },
      { label: "jsDelivr mirror", url: MSAL_CDN[2] },
      { label: "unpkg mirror", url: MSAL_CDN[3] },
      { label: "Microsoft sign-in", url: "https://login.microsoftonline.com/common/discovery/keys" }
    ];

    return Promise.all(targets.map(function (t) {
      var started = Date.now();
      return Promise.race([
        fetch(t.url, { method: "GET", mode: "no-cors", cache: "no-store" })
          .then(function () { return { ok: true }; })
          .catch(function (e) { return { ok: false, why: e.message || "blocked" }; }),
        new Promise(function (res) {
          setTimeout(function () { res({ ok: false, why: "timed out" }); }, 8000);
        })
      ]).then(function (r) {
        return {
          label: t.label, url: t.url, optional: !!t.optional,
          ok: r.ok, why: r.why || "", ms: Date.now() - started
        };
      });
    })).then(function (rows) {
      var usable = rows.filter(function (r) { return r.ok && r.label !== "Microsoft sign-in"; });
      var login = rows.filter(function (r) { return r.label === "Microsoft sign-in"; })[0];
      return {
        rows: rows,
        canLoadLibrary: usable.length > 0,
        canReachMicrosoft: !!(login && login.ok),
        summary: summarise(rows, usable, login)
      };
    });
  }

  function summarise(rows, usable, login) {
    if (usable.length && login && login.ok) {
      return "Everything needed is reachable. If sign-in still fails, the problem is in the " +
             "app registration rather than the network.";
    }
    if (!usable.length && login && !login.ok) {
      return "Nothing Microsoft-related is reachable from this browser. That points at a network " +
             "filter or a proxy covering the whole site, not at one blocked CDN.";
    }
    if (!usable.length) {
      return "Every source for the sign-in library is blocked, though Microsoft itself is " +
             "reachable. Ask for alcdn.msauth.net to be allowed, or place a copy of " +
             "msal-browser.min.js at assets/vendor/ in the repository, which cannot be blocked " +
             "because it is served from this same site.";
    }
    return "The sign-in library can be loaded, but login.microsoftonline.com is not reachable. " +
           "Sign-in cannot work until that domain is allowed.";
  }

  /* ---------------------------------------------------------------- helpers */

  /** Pull the Direct Line token out of whatever shape the endpoint returns. */
  function readToken(data) {
    if (!data) return null;
    return data.token || data.accessToken || data.access_token ||
      (data.value && (data.value.token || data.value.accessToken)) || null;
  }

  /**
   * Copilot Studio agents are deployed regionally, so the Direct Line host
   * varies by environment. The default (directline.botframework.com) is wrong
   * for most tenants, so the correct host is discovered from the same origin
   * as the token endpoint. Falls back to the default if discovery fails.
   */
  function fetchRegionalDirectLineURL(endpoint) {
    var api, base;
    try {
      var u = new URL(endpoint);
      api = u.searchParams.get("api-version") || "2022-03-01-preview";
      base = new URL("/powervirtualagents/regionalchannelsettings?api-version=" + api, u).toString();
    } catch (e) {
      return Promise.resolve(DEFAULT_DIRECTLINE);
    }
    return fetch(base)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var url = data && data.channelUrlsById && data.channelUrlsById.directline;
        if (!url) return DEFAULT_DIRECTLINE;
        return new URL("v3/directline", url).toString();
      })
      .catch(function () { return DEFAULT_DIRECTLINE; });
  }

  /**
   * Copilot Studio hands you a "Token Endpoint" URL in
   * Settings -> Channels -> Mobile app. Hitting it returns a short-lived
   * Direct Line token scoped to this agent.
   */
  function fetchDirectLineToken(endpoint, bearer) {
    var opts = { method: "GET", headers: {} };
    if (bearer) opts.headers.Authorization = "Bearer " + bearer;

    // Errors we raise deliberately are tagged, so the catch below can tell them
    // apart from fetch's own rejection without relying on `instanceof`, which is
    // unreliable across realms (iframes, test sandboxes).
    function fail(msg) {
      var e = new Error(msg);
      e.handled = true;
      return e;
    }

    return fetch(endpoint, opts).then(function (res) {
      if (!res.ok) {
        var hint = "";
        if (res.status === 401 || res.status === 403) {
          hint = "\nThe endpoint rejected the request (HTTP " + res.status + "). If your agent " +
                 "requires sign-in, choose SSO mode and supply a valid Entra ID client ID.";
        } else if (res.status === 404) {
          hint = "\nThat token endpoint was not found. Copy it again from Copilot Studio " +
                 "(Settings -> Channels -> Mobile app -> Token Endpoint).";
        } else if (res.status >= 500) {
          hint = "\nThe server failed to respond correctly. This is usually temporary - try again shortly.";
        }
        throw fail("Token endpoint returned HTTP " + res.status + "." + hint);
      }
      return res.json().catch(function () {
        throw fail("The token endpoint did not return valid JSON. Check that the URL is the " +
                   "Direct Line token endpoint and not the web chat page.");
      });
    }).then(function (data) {
      var token = readToken(data);
      if (!token) {
        throw fail("The token endpoint responded, but the reply contained no Direct Line token.");
      }
      return token;
    }).catch(function (err) {
      if (err && err.handled) throw err;
      // fetch() rejects with a TypeError for network and CORS failures.
      throw new Error(
        "Could not reach the token endpoint.\n" +
        "This is usually a CORS or network problem: the page's domain must be allowed to " +
        "call it. Confirm the URL is correct and that you are serving this site over HTTPS." +
        (err && err.message ? "\n\nDetails: " + err.message : "")
      );
    });
  }

  /* ------------------------------------------------------------------ MSAL */

  var msalApp = null;
  var msalKey = "";

  /* The delegated scope the Microsoft 365 Agents SDK protocol expects.
     Kept here so both transports agree on a default. */
  var DEFAULT_AGENT_SCOPE = "https://api.powerplatform.com/CopilotStudio.Copilots.Invoke";

  function initMsal(cfg) {
    var key = (cfg.clientId || "") + "|" + (cfg.tenantId || "common") + "|" + (cfg.authority || "");
    // A changed client or tenant must build a new instance, not reuse the old.
    if (msalApp && key === msalKey) return Promise.resolve(msalApp);
    if (!cfg.clientId) {
      return Promise.reject(new Error(
        "No Entra ID application (client) ID has been set. Add one in Connection settings."
      ));
    }

    return loadScript(MSAL_CDN, "msal").then(function (msal) {
      var redirect = global.location.origin + global.location.pathname;
      var authorityHost = (cfg.authority || "https://login.microsoftonline.com").replace(/\/+$/, "");
      msalApp = new msal.PublicClientApplication({
        auth: {
          clientId: cfg.clientId,
          authority: authorityHost + "/" + (cfg.tenantId || "common"),
          redirectUri: redirect,
          navigateToLoginRequestUrl: true
        },
        cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
        system: { allowNativeBroker: false }
      });
      msalKey = key;
      // MSAL v3 requires an explicit async initialize(); v2 does not have it.
      return msalApp.initialize ? msalApp.initialize().then(function () { return msalApp; }) : msalApp;
    });
  }

  /** Normalise whatever scope form the caller supplied into an array. */
  function scopeList(cfg) {
    if (cfg && Array.isArray(cfg.scopes) && cfg.scopes.length) return cfg.scopes;
    var raw = (cfg && cfg.scope ? String(cfg.scope) : "").trim();
    if (raw) return raw.split(/[\s,]+/).filter(Boolean);
    return [DEFAULT_AGENT_SCOPE];
  }

  /**
   * Get an access token, prompting only if it cannot be done silently.
   * cfg: { clientId, tenantId, scope | scopes, authority, forceRefresh, silentOnly }
   */
  function acquireToken(cfg) {
    cfg = cfg || {};
    var scopes = scopeList(cfg);

    return initMsal(cfg).then(function (app) {
      return app.handleRedirectPromise().then(function (redirectResult) {
        if (redirectResult && redirectResult.account) app.setActiveAccount(redirectResult.account);

        var account = app.getActiveAccount() || (app.getAllAccounts() || [])[0];
        if (account) {
          app.setActiveAccount(account);
          return app.acquireTokenSilent({
            scopes: scopes,
            account: account,
            forceRefresh: !!cfg.forceRefresh
          }).catch(function (err) {
            if (cfg.silentOnly) throw err;
            return interactive(app, scopes);
          });
        }
        if (cfg.silentOnly) throw new Error("No signed-in account.");
        return interactive(app, scopes);
      });
    }).then(function (res) {
      if (!res || !res.accessToken) throw new Error("Sign-in completed but returned no access token.");
      return res;
    }).catch(function (err) {
      var m = err && err.message ? err.message : String(err);
      if (/popup_window_error|popup blocked|BrowserAuthError.*popup/i.test(m)) {
        throw new Error(
          "The sign-in popup was blocked. Allow pop-ups for this site, or use the redirect " +
          "sign-in button in Connection settings."
        );
      }
      if (/user_cancelled|user_canceled/i.test(m)) throw new Error("Sign-in was cancelled.");
      if (/AADSTS65001|consent/i.test(m)) {
        throw new Error(
          "Consent has not been granted. An administrator must approve the Power Platform API " +
          "permission CopilotStudio.Copilots.Invoke for this app registration.\n\n" + m
        );
      }
      if (/AADSTS50011|redirect_uri/i.test(m)) {
        throw new Error(
          "The redirect URI does not match. Add this exact address as a Single-page application " +
          "redirect URI on the app registration:\n" + global.location.origin + global.location.pathname +
          "\n\n" + m
        );
      }
      throw new Error("Microsoft sign-in failed.\n" + m);
    });
  }

  function interactive(app, scopes) {
    return app.loginPopup({ scopes: scopes }).then(function (res) {
      if (res && res.account) app.setActiveAccount(res.account);
      return app.acquireTokenSilent({ scopes: scopes, account: app.getActiveAccount() })
        .catch(function () { return res; });
    });
  }

  /** Full-page sign-in, for browsers or policies that block popups outright. */
  function signInRedirect(cfg) {
    return initMsal(cfg || {}).then(function (app) {
      return app.loginRedirect({ scopes: scopeList(cfg) });
    });
  }

  /**
   * Complete a redirect sign-in if the page was just returned to.
   * Safe to call on every start; resolves with the account or null.
   */
  function resumeRedirect(cfg) {
    if (!cfg || !cfg.clientId) return Promise.resolve(null);
    return initMsal(cfg)
      .then(function (app) { return app.handleRedirectPromise(); })
      .then(function (res) {
        if (res && res.account && msalApp) msalApp.setActiveAccount(res.account);
        return res && res.account ? res.account : null;
      })
      .catch(function () { return null; });
  }

  /** Who is signed in right now, if anyone. */
  function currentAccount() {
    if (!msalApp) return null;
    var a = msalApp.getActiveAccount() || (msalApp.getAllAccounts() || [])[0];
    return a ? { name: a.name || a.username, username: a.username } : null;
  }

  function signOut() {
    if (!msalApp) return Promise.resolve();
    var a = msalApp.getActiveAccount() || (msalApp.getAllAccounts() || [])[0];
    if (!a) return Promise.resolve();
    return msalApp.logoutPopup({ account: a }).catch(function () {});
  }

  /**
   * Drop the cached account and tokens from THIS browser only.
   *
   * Deliberately not `signOut`: that opens a popup and ends the session at
   * Microsoft, which is wrong for "erase local data" and, worse, would race
   * the page reload that follows it. This only forgets what we stored.
   */
  function forget() {
    if (!msalApp) return Promise.resolve();
    try {
      msalApp.setActiveAccount(null);
      (msalApp.getAllAccounts() || []).forEach(function (a) {
        // Not present in every MSAL build, so it is guarded rather than assumed.
        if (typeof msalApp.clearCache === "function") return;
        try { msalApp.getTokenCache().removeAccount(a); } catch (e) { /* older build */ }
      });
      if (typeof msalApp.clearCache === "function") return Promise.resolve(msalApp.clearCache());
    } catch (e) { /* nothing cached */ }
    return Promise.resolve();
  }

  /* -------------------------------------------------------------- WebChat */

  /** Map the BIG A palette onto WebChat so the canvas matches the page. */
  function styleOptions(dark) {
    var paper = dark ? "#262624" : "#F0EEE6";
    var surface = dark ? "#30302E" : "#FFFFFF";
    var ink = dark ? "#F5F4EF" : "#141413";
    var line = dark ? "#3E3E3B" : "#E3E1D9";
    var clay = dark ? "#D97757" : "#C96442";

    return {
      // Canvas
      backgroundColor: "transparent",
      rootHeight: "100%",
      rootWidth: "100%",
      paddingRegular: 14,
      paddingWide: 20,

      // Typography — mirrors the page's system stack
      fontSizeSmall: "80%",
      primaryFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',

      // Bubbles
      bubbleBackground: surface,
      bubbleTextColor: ink,
      bubbleBorderColor: line,
      bubbleBorderWidth: 1,
      bubbleBorderRadius: 14,
      bubbleFromUserBackground: clay,
      bubbleFromUserTextColor: "#FFFFFF",
      bubbleFromUserBorderColor: clay,
      bubbleFromUserBorderWidth: 1,
      bubbleFromUserBorderRadius: 14,
      bubbleMinWidth: 60,
      bubbleMaxWidth: 720,

      // Avatars off — the page already identifies the agent in the topbar
      botAvatarInitials: "",
      userAvatarInitials: "",
      avatarSize: 0,

      // Composer
      sendBoxBackground: surface,
      sendBoxTextColor: ink,
      sendBoxBorderTop: "solid 1px " + line,
      sendBoxBorderBottom: "solid 0px " + line,
      sendBoxButtonColor: clay,
      sendBoxButtonColorOnHover: clay,
      sendBoxHeight: 48,
      sendBoxPlaceholderColor: dark ? "#9A968C" : "#8A8578",
      hideUploadButton: false,

      // Suggested actions styled as quiet pills
      suggestedActionBackgroundColor: surface,
      suggestedActionBorderColor: line,
      suggestedActionBorderRadius: 999,
      suggestedActionBorderWidth: 1,
      suggestedActionTextColor: clay,
      suggestedActionLayout: "flow",

      // Chrome
      accent: clay,
      subtle: dark ? "#9A968C" : "#8A8578",
      timestampColor: dark ? "#9A968C" : "#8A8578",
      transcriptOverlayButtonBackground: clay,
      transcriptOverlayButtonColor: "#FFFFFF",
      transcriptTerminatorBackgroundColor: paper,
      groupTimestamp: 60000
    };
  }

  /**
   * Build the redux middleware that drives the conversation.
   * When `ssoToken` is supplied we intercept the agent's OAuth card and answer
   * it with the token, so the user is never asked to sign in a second time.
   */
  function buildStore(WebChat, ssoToken, hooks) {
    return WebChat.createStore({}, function (_ref) {
      var dispatch = _ref.dispatch;
      return function (next) {
        return function (action) {
          if (action.type === "DIRECT_LINE/CONNECT_FULFILLED") {
            if (hooks.onConnected) hooks.onConnected();
            // Copilot Studio agents wait for this event before greeting.
            dispatch({
              type: "WEB_CHAT/SEND_EVENT",
              payload: { name: "startConversation", type: "event", value: { text: "hello" } }
            });
            return next(action);
          }

          if (action.type === "DIRECT_LINE/CONNECT_REJECTED" && hooks.onError) {
            hooks.onError(new Error(
              "Direct Line refused the connection. The token may have expired or been issued for a different agent."
            ));
          }

          if (ssoToken && action.type === "DIRECT_LINE/INCOMING_ACTIVITY") {
            var a = action.payload && action.payload.activity;
            var isOAuthCard = a && a.attachments && a.attachments.some(function (att) {
              return att.contentType === "application/vnd.microsoft.card.oauth";
            });
            if (isOAuthCard && a.from && a.from.role === "bot") {
              // Answer the sign-in card silently and swallow it from the UI.
              dispatch({ type: "WEB_CHAT/SEND_MESSAGE", payload: { text: ssoToken } });
              if (hooks.onSsoHandled) hooks.onSsoHandled();
              return;
            }
          }

          if (action.type === "DIRECT_LINE/INCOMING_ACTIVITY" && hooks.onActivity) {
            hooks.onActivity(action.payload && action.payload.activity);
          }

          return next(action);
        };
      };
    });
  }

  /**
   * Connect using Direct Line + WebChat.
   * opts: { mode, tokenEndpoint, clientId, tenantId, scope, element, dark, hooks }
   */
  function connectWebChat(opts) {
    var hooks = opts.hooks || {};
    var account = null;

    var bearerStep = opts.mode === "sso"
      ? acquireToken(opts).then(function (res) {
          account = res.account ? { name: res.account.name, username: res.account.username } : null;
          if (hooks.onSignedIn) hooks.onSignedIn(account);
          return res.accessToken;
        })
      : Promise.resolve(null);

    return bearerStep
      .then(function (bearer) {
        // Token and regional host are independent lookups, so fetch in parallel.
        return Promise.all([
          fetchDirectLineToken(opts.tokenEndpoint, bearer),
          fetchRegionalDirectLineURL(opts.tokenEndpoint)
        ]).then(function (r) {
          return { dlToken: r[0], domain: r[1], bearer: bearer };
        });
      })
      .then(function (t) {
        return loadScript(WEBCHAT_CDN, "WebChat").then(function (WebChat) {
          var directLine = WebChat.createDirectLine({ token: t.dlToken, domain: t.domain });
          var store = buildStore(WebChat, opts.mode === "sso" ? t.bearer : null, hooks);

          opts.element.hidden = false;
          opts.element.innerHTML = "";

          WebChat.renderWebChat({
            directLine: directLine,
            store: store,
            styleOptions: styleOptions(opts.dark),
            locale: (global.navigator && global.navigator.language) || "en-GB"
          }, opts.element);

          return { directLine: directLine, store: store, account: account };
        });
      });
  }

  global.Connect = {
    connectWebChat: connectWebChat,
    fetchDirectLineToken: fetchDirectLineToken,
    acquireToken: acquireToken,
    signInRedirect: signInRedirect,
    resumeRedirect: resumeRedirect,
    currentAccount: currentAccount,
    signOut: signOut,
    forget: forget,
    DEFAULT_AGENT_SCOPE: DEFAULT_AGENT_SCOPE,
    styleOptions: styleOptions,
    loadScript: loadScript,
    diagnose: diagnose,
    readToken: readToken,
    WEBCHAT_CDN: WEBCHAT_CDN,
    MSAL_CDN: MSAL_CDN
  };
})(typeof window !== "undefined" ? window : this);
