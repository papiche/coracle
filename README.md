# What is this?

Coracle is a web client for the Nostr protocol focused on pushing the boundaries of what's unique about nostr, including relay selection and management, web-of-trust based moderation and content recommendations, and privacy protection.

This `zen` branch is a fork that turns Coracle into the **UPlanet MULTIPASS client**: a Nostr identity backed by a Ğ1 wallet, created and managed in-app against a self-hosted **Astroport** station rather than an external keygen page. Check it out at [coracle.copylaradio.com](https://coracle.copylaradio.com).

If you like Coracle and want to support its development, you can donate Ẑen via [G1FabLab#monnaie-libre](https://opencollective.com/monnaie-libre).

# UPlanet / ẐEN (zen branch)

[UPlanet](https://github.com/papiche/Astroport.ONE) is a cooperative ecosystem combining Nostr, IPFS and the [Ğ1](https://www.monnaie-libre.fr/) libre currency, run on self-hosted **Astroport** stations. This branch wires Coracle into that ecosystem:

- **In-app MULTIPASS creation & restoration** (`src/util/multipass.ts`, `src/app/shared/MultipassLogin.svelte`) — no more redirect to an external `g1.html`/keygen page. Enter an email (and, to restore an existing account, its PASS code) and get a Nostr identity backed by a Ğ1 wallet, created directly against the `/g1nostr` endpoint of a chosen Astroport station.
- **Astroport station picker** — when creating a MULTIPASS, pick which station hosts your account among your local swarm. Each station shown lists:
  - its captain's Nostr profile (avatar, name, and a link to their full profile)
  - available disk space, fetched live from the station's own published state
  - its weekly PAF ("Participation Aux Frais", in Ẑen)
  - a "closest station" button that geolocates you and picks the nearest one by GPS distance
  - stations only reachable from their own local network (127.0.0.1) are hidden from the list, with a count shown instead
- **Station-pinned identity** (`src/util/uplanet-detect.ts`) — the relay, API and IPFS gateway used after creating a MULTIPASS are the exact ones the chosen station published (`myRELAY`/`uSPOT`/`myIPFS`), not guessed from a hostname naming convention.
- **ẐEN balances** (`src/util/zen.ts`) — Ẑen is a cooperative accounting unit derived from Ğ1: `(Ğ1_balance − 1) × 10 = Ẑen`. Two token types exist:
  - **MULTIPASS** (usage tokens): pay for likes (1 Ẑen each, enforced by the relay's own write policy), relay operations, AI services.
  - **ZEN Card** (property tokens): cooperative ownership shares (satellite/constellation/infrastructure tiers), split 3×1/3 between TREASURY/R&D/ASSETS.

# Features

- [x] Threads/social
- [x] Profile search using NIP-50
- [x] Login via extension, nsecbunker, and pubkey
- [x] Profile sharing via QR codes
- [x] NIP 05 verification
- [x] NIP 65 relay selection and NIP 32 relay reviews
- [x] NIP 89 app recommendations
- [x] NIP 32 labeling and recommendations
- [x] NIP 99 classifieds
- [x] NIP 52 calendar events
- [x] NIP 87 closed groups
- [x] NIP 72 communities
- [x] NIP 89 client tag support
- [x] NIP 89 handler integration
- [x] NIP 32 labeling and collections
- [x] NIP 17 DMs
- [x] Private group calendars and listings
- [x] Cross-posting between communities and main feed
- [x] Bech32 entity search and scan
- [x] Mention, reply, and reaction notifications
- [x] Direct messages - NIP 04 and NIP 24
- [x] Note composition with mentions and topics
- [x] Content warnings, mute, and keyword mute
- [x] Profile pages, follow/unfollow, follow/follower count
- [x] Thread muting, collapse thread
- [x] Invoice, quote, mention, link, image, and video rendering
- [x] Installable as a progressive web app
- [x] Integrated media uploads via NIP 96
- [x] Lightning zaps and reactions
- [x] Feeds customizable by person, relay, and topic using NIP-51
- [x] AUTH (NIP-42) support for closed relays
- [x] Multiplextr support for reducing bandwidth
- [x] Profile and note metadata
- [x] White-labeling support
- [x] NIP 51 person lists
- [x] Exports/imports of user events
- [x] User profile editing
- [x] NIP XX encrypted read receipts for notifications
- [x] Topic and relay feeds
- [x] Onboarding workflow
- [x] Multi-account support
- [x] Notifications view
- [x] Web of trust scores for less spam and better group/feed suggestions
- [x] Customizable and shareable feeds and lists
- [x] Customizable invite links
- [x] Reporting via tagr-bot
- [x] Nostr Wallet Connect support
- [x] Date/time localization

You can find a more complete changelog [here](./CHANGELOG.md).

# Run Coracle locally:

- Clone the project repository: `git clone https://github.com/papiche/coracle.git`
- Navigate to the project directory, zen branch : `cd coracle; git checkout zen;`
- Install dependencies: `pnpm i`
- Customize configuration in `.env` (optional, see below)
- Start the development server: `pnpm run dev`
- In order for `pnpm run build` to work, you'll need to run `pnpm i sharp --include=optional` first.

# Tests

- Run all tests: `pnpm run test`
- Run unit tests: `pnpm run test:unit`
- Run e2e tests: `pnpm run test:e2e`

# Building for Android

Make sure you have the android build tools in your path and run:

```
pnpm run build:android --keystorepath <path> --keystorepass <password> --keystorealias <alias> --keystorealiaspass <password>
```

# Deploying to IPFS (zen branch)

`./build-web-compatible-ipfs.sh [gateway_base_url] [--skip-apk] [--skip-dns]` builds and publishes the whole app to IPFS in one step:

1. Builds the Svelte app with relative asset paths (`base: "./"`) so it works from any IPFS gateway/CID, not just the domain root.
2. Strips the service worker, which is incompatible with content-addressed IPFS URLs (and unregisters any previously-installed one for visitors upgrading from an older build).
3. Builds the signed Android release APK (skipped automatically without `android/key.properties`, or via `--skip-apk`) and bundles it with `www/` into `dist/www/`, published under the same CID as the app.
4. Publishes `dist/` to IPFS with `ipfs add -rw --pin`.
5. Repoints `coracle.astroport.one`'s DNSLink at the new root CID via Astroport.ONE's `ovh.me.sh` (skipped automatically without OVH credentials, or via `--skip-dns`).

# Customization

Coracle is intended to be fully white-labeled by groups of various kinds. The following environment variables can be set in `.env.local` to customize Coracle's appearance and behavior:

- `VITE_DARK_THEME` and `VITE_LIGHT_THEME` are comma-separate lists of key/value pairs defining theme colors.
- `VITE_DVM_RELAYS` is a comma-separated list of relays to use when making requests against DVMs.
- `VITE_SEARCH_RELAYS` is a comma-separated list of relays to use when using NIP 50 search.
- `VITE_DEFAULT_RELAYS` is a comma-separated list of relays to use as defaults/fallbacks.
- `VITE_DEFAULT_FOLLOWS` is a comma-separated list of hex pubkeys to fetch content from when the user isn't following anyone.
- `VITE_ONBOARDING_LISTS` is a comma-separated list of `kind:30003` person lists to populate onboarding with.
- `VITE_NIP96_URLS` is a comma-separated list of default upload providers.
- `VITE_DUFFLEPUD_URL` is a [Dufflepud](https://github.com/coracle-social/dufflepud) instance url, which helps Coracle with things like link previews and image uploads.
- `VITE_PLATFORM_ZAP_SPLIT` is a decimal between 0 and 1 defining the default zap split percent.
- `VITE_PLATFORM_PUBKEY` is the pubkey of the platform owner. This gets zapped when using the platform zap split.
- `VITE_ENABLE_ZAPS` can be set to `false` to disable zaps.
- `VITE_APP_NAME` is the app's name.
- `VITE_APP_URL` is the app's url. Used to generate open graph meta tags.
- `VITE_APP_LOGO` is the path for the app's logo relative to the `public` directory, starting with a leading slash. Used to generate favicons and manifest.
- `VITE_APP_WORDMARK_DARK` and `VITE_APP_WORDMARK_LIGHT` are paths for the app's wordmark relative to the `public` directory, starting with a leading slash.
- `VITE_APP_DESCRIPTION` is the app's description.
- `VITE_CLIENT_NAME` is the client's name. Only change this if you have forked Coracle.
- `VITE_CLIENT_ID` is the client's NIP 89 handler id. Only change this if you have forked Coracle.
- `VITE_BUILD_HASH` can be set during build to indicate the software version on the about page.
- `VITE_LOG_LEVEL` can be set to `info`, `warn`, or `error`. This controls how much shows up in the console.
- `VITE_ENABLE_MARKET` can be set to `false` to disable the marketplace tab.

See `.env` for default values.
