# Self-hosted libraries

Drop files here when a network filter blocks the public CDNs. BIG A looks in
this folder **before** any CDN, and because these files are served from your own
site they cannot be blocked by a filter that already allows the site itself.

Nothing here is required. When a file is absent the lookup 404s immediately and
the CDNs are used as normal.

## msal-browser.min.js

This is the one worth adding. It is the Microsoft Authentication Library, and
without it the **Sign in with Microsoft** button cannot work at all.

Get the file from any machine with unrestricted internet access:

```
https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js
```

Save it here as exactly `msal-browser.min.js`, commit, and push. That is all;
no code change is needed.

If `alcdn.msauth.net` is blocked on every machine you have, the identical file
is published on the public npm mirrors:

```
https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js
https://unpkg.com/@azure/msal-browser@2.38.3/lib/msal-browser.min.js
```

Check the version matches `MSAL_VERSION` in `assets/js/connect.js` if you ever
change it. Version 2.x is required; version 3 renamed parts of the API that
this app relies on.

## webchat.js

Only needed for the legacy Direct Line modes, which most setups never use. Same
idea, from `https://cdn.botframework.com/botframework-webchat/latest/webchat.js`.

## Licensing

These are Microsoft's files under the MIT licence. Keep the licence header that
ships inside the file intact, which minified builds already include. They are
not committed to this repository by default because they would go stale and are
better fetched fresh from the CDN whenever the network allows it.
