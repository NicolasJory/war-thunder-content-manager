# War Thunder Content Manager

Browse the camouflages published on [War Thunder Live](https://live.warthunder.com) and install them into the game with one click.

Doing this by hand means downloading an archive, unzipping it, and dropping the folder in the right place inside your game files. The app handles those three steps, and removes cleanly whatever it installed.

## Features

- Infinite-scrolling catalogue, filtered by country, type, class and vehicle
- Hashtag search, plus the four sort orders the site offers
- Detail sheet with a zoomable gallery, stats and description
- One-click install, and you choose the folder name the game will show
- Tracks what you installed and flags content republished since
- Author favourites, shareable links, and links that open straight in the app
- Interface in English, French, Russian and Simplified Chinese

The app finds your Steam installation on first launch. It never touches folders it did not create: Gaijin's templates and camouflages you placed by hand stay untouched, and appear read-only.

## Install

Two builds, same app. Both keep their settings in the same place, so you can switch between them.

| | Installer | Portable |
|---|---|---|
| File | `...-Setup.exe` | `...-Portable.exe` |
| Installs to | Folder of your choice | Nothing installed |
| Desktop shortcut | Yes | No |
| `wtcm://` links open the app | Yes | No |
| Auto-updates | Yes | No, download the new version |
| First launch | Fast | A few seconds slower, it unpacks itself |

Take the installer unless you have a reason not to. The portable build suits a USB stick or a machine where you would rather not install anything.

No release published yet. Build either one yourself with `npm run dist`, or see [Development](#development).

### What Windows will tell you the first time

The binaries carry no code signature. A certificate runs several hundred euros a year, which makes no sense for a free tool. Two consequences follow.

**Windows shows "Windows protected your PC".** Click "More info", then "Run anyway".

**Your antivirus may complain.** An unsigned Electron app that writes into a game folder and makes network requests ticks several boxes on a suspicious profile. Every line of the code sits in this repository, and you can build it yourself if you would rather.

## What the app does with your data

Nothing leaves your machine. There is no account, no telemetry and no server in between: the app talks to War Thunder Live directly, and writes only into your game's `UserSkins` folder.

Installed content is visible to you alone, locally. The game server never sees it.

Your settings live in one file, next to the app's configuration folder:

```
%APPDATA%\War Thunder Content Manager\config.json
```

## Development

You need Node.js 20 or newer.

```bash
npm install
npm run dev
```

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app with hot reload |
| `npm run build` | Type-checks and builds all three processes |
| `npm run typecheck` | Types only |
| `npm run dist` | Builds both the installer and the portable exe into `release/` |
| `npm run smoke` | Real install: downloads two actual archives into a test folder |
| `npm run smoke:real` | Same, against your real game folder, checking it comes back untouched |
| `npm run smoke:ui` | Filters, translations, description parsing |
| `npm run smoke:validate` | IPC boundary validation, incoming links, endpoint manifest |
| `npm run smoke:config` | Steam detection, persistence |

The tests hit the live API and download real archives. They are slow and depend on the network, on purpose: a suite that only talks to mocks would never notice the API changing under it.

### Layout

```
src/
  main/       Electron main process: network, install, filesystem
  preload/    contextBridge, the only surface the renderer sees
  renderer/   React interface
  shared/     Pure modules used by both sides
```

The renderer reaches neither the network nor the filesystem. Everything goes through named IPC channels whose arguments are validated on arrival.

### When the Live API moves

These endpoints are unofficial. They all live in `src/shared/endpoints.ts`: addresses, headers, the pattern that extracts the filter taxonomy, allowed download hosts and safety limits. No URL is hard-coded anywhere else.

You can override any part of the manifest without recompiling. Drop a file next to your configuration:

```
%APPDATA%\War Thunder Content Manager\endpoints.json
```

```json
{
  "api": { "feed": "/api/v2/feed/" },
  "downloadHosts": ["cdn2.warthunder.com"]
}
```

The app also reads [`endpoints.json`](endpoints.json) from this repository at startup, which means one commit repairs every user on their next launch, with no release to publish. Your local file wins over the published one.

Each field is validated on its own. A half-wrong file keeps the defaults for whatever fails, rather than breaking the app.

## Known limits

**A `https://live.warthunder.com` link someone sends you on Discord opens your browser.** Windows reserves web link handling for the default browser. Two ways around it: links shared from the app use a custom protocol that opens it directly, and pasting a Live URL into the search field opens that content in the app.

**Vehicle filter values stay in English** across all four languages. They come from the API, over a taxonomy of more than 3,000 entries that shifts with every game update.

**Sights and sound mods are not installable yet.** The architecture has room for them; the work is still to do.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm run typecheck` and the test suites that apply to what you touched.

Source comments are in French. Nothing else is: user-facing strings live in `src/renderer/src/i18n.ts`, and adding a language means adding one dictionary there. TypeScript will list every key you missed.

## License

[GPL-3.0](LICENSE).

The Inter typeface ships under the [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt).

The icon font that draws the national roundels belongs to Gaijin Entertainment. This repository does not redistribute it: the app fetches it from their server on first launch, the same way a browser would.

This project is neither affiliated with nor endorsed by Gaijin Entertainment. War Thunder and War Thunder Live are their trademarks.
