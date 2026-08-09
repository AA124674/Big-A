# Self-hosted libraries

Drop files here when a network filter blocks the public CDNs. BIG A looks in
this folder **before** any CDN, and because these files are served from your own
site they cannot be blocked by a filter that already allows the site itself.

Nothing here is required. When a file is absent the lookup 404s immediately and
the CDNs are used as normal.

Vendoring is nevertheless the recommended production setup: it removes two
third-party origins from the trust boundary and pins exactly the bytes that were
reviewed.

## msal-browser.min.js

This is the one worth adding. It is the Microsoft Authentication Library, and
without it the **Sign in with Microsoft** button cannot work at all.

Get the pinned file from the official npm package or one of its package mirrors:

```
https://cdn.jsdelivr.net/npm/@azure/msal-browser@5.18.0/lib/msal-browser.min.js
https://unpkg.com/@azure/msal-browser@5.18.0/lib/msal-browser.min.js
```

Save it here as exactly `msal-browser.min.js`, retain its licence header, commit,
and push. No code change is needed. Microsoft stopped publishing msal-browser to
its own CDN starting with v3, so an old `alcdn.msauth.net/browser/2.x` URL is not
a suitable source for this build and is no longer attempted by `connect.js`.

Check that the version matches `MSAL_VERSION` in `assets/js/connect.js` whenever
you update it. Review the upstream release and migration notes before changing a
major version.

## webchat.js

Only needed for the legacy Direct Line modes, which most setups never use. Use
the pinned `4.19.1` build from
`https://cdn.botframework.com/botframework-webchat/4.19.1/webchat.js` and save it
as exactly `webchat.js`.

## Verify before committing

Do this on a machine that can reach the official sources, and never from an
unverified mirror or a search result. The point of the exercise is that the
bytes you commit are the bytes you checked.

```sh
# 1. Fetch from the official package registry, by exact version.
npm pack @azure/msal-browser@5.18.0
tar -xzf azure-msal-browser-5.18.0.tgz
cp package/lib/msal-browser.min.js assets/vendor/msal-browser.min.js

# 2. Confirm the CDN copy is byte-identical to the registry copy.
curl -fsSL https://cdn.jsdelivr.net/npm/@azure/msal-browser@5.18.0/lib/msal-browser.min.js \
  | shasum -a 256
shasum -a 256 assets/vendor/msal-browser.min.js

# 3. Record the hashes in the table below.
shasum -a 256 assets/vendor/msal-browser.min.js assets/vendor/webchat.js
openssl dgst -sha384 -binary assets/vendor/msal-browser.min.js | openssl base64 -A

# 4. Confirm the MIT licence notice survived minification.
head -c 400 assets/vendor/msal-browser.min.js
```

Bot Framework Web Chat has no npm build that is byte-identical to the CDN
bundle, so for `webchat.js` fetch
`https://cdn.botframework.com/botframework-webchat/4.19.1/webchat.js` over TLS
and record its hash the same way.

### Recorded versions and hashes

Fill this in at the moment you commit each file, from the output of step 3.
Leave a row blank rather than guessing: an unverified hash is worse than none,
because it looks like a check that was done.

| File | Package | Version | Source | SHA-256 | SHA-384 (base64) | Verified by | Date |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `msal-browser.min.js` | `@azure/msal-browser` | 5.18.0 | npm registry | _not yet recorded_ | _not yet recorded_ | | |
| `webchat.js` | `botframework-webchat` | 4.19.1 | cdn.botframework.com | _not yet recorded_ | _not yet recorded_ | | |

Neither file is committed in this repository. They were not fetched during the
deployment review because that environment had no outbound network access, so no
hash could be honestly recorded here.

`connect.js` loads these files without an `integrity` attribute, deliberately: a
same-origin vendored file gains nothing from SRI, and applying SRI to the CDN
fallbacks turns a mirror's re-minification into a hard sign-in failure. If you
vendor both files and then remove the CDN entries from `script-src` in
`index.html`, the CDN path disappears entirely, which is stronger than SRI.

## Licensing

These are Microsoft's files under the MIT licence. Keep the licence header that
ships inside the file intact, which minified builds already include. They are
not committed to this repository by default because they would go stale and are
better fetched fresh from the CDN whenever the network allows it.
