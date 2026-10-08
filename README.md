# Bodymovin MCP

Export After Effects compositions to Lottie through Bodymovin - from an AI
agent over MCP, or from any script - without clicking the panel.

A fork of the Bodymovin extension. It installs **next to** the official
Bodymovin as a separate extension, *Window > Extensions > Bodymovin MCP*, and
leaves the official one alone. It brings its own MCP server, running inside
After Effects, so it needs no other MCP server or tooling to work.

Verified on After Effects 26.5 (2026) against Bodymovin 5.12.1: an export
through the MCP was byte-identical to the same comp exported by hand from the
official panel - JSON and every image. The only difference was the encode date
Bodymovin writes into a re-encoded mp3's ID3 tag.

## Install

Needs the official Bodymovin 5.12.1 installed (it is the base) and CEP debug
mode on (`defaults write com.adobe.CSXS.12 PlayerDebugMode 1`), since this
build is unsigned. Quit After Effects, then:

```bash
python3 scripts/install.py
```

It installs to `~/Library/Application Support/Adobe/CEP/extensions/bodymovin-mcp`
- the per-user folder, no admin rights needed. Run it again after any change
to the fork; it replaces the previous install. Then start After Effects.

## The MCP server

Starts with After Effects, in a hidden extension - no panel needs to be open.

- **Endpoint:** `http://127.0.0.1:8793/mcp` (Streamable HTTP, JSON responses)
- **Auth:** a bearer token, created on first start in `~/.bodymovin-mcp/token`
  (0600) and kept across launches. Requests must come from loopback with a
  loopback `Host`; web origins are refused.
- **Health:** `GET /health` with the same token.
- **Boot log:** `$TMPDIR/bodymovin-mcp/boot.log`.

Add it to Claude Code:

```bash
claude mcp add --scope user --transport http bodymovin http://127.0.0.1:8793/mcp \
  --header "Authorization: Bearer $(cat ~/.bodymovin-mcp/token)"
```

### Tools

| Tool | Does |
|---|---|
| `bodymovin_export` | Export a comp and wait until it is written. Opens the panel if needed. Takes `comp`, `folder`, optional `fileName` and `settings`. Returns the JSON path and size and the exported images. |
| `bodymovin_list_comps` | Every comp in the open project: name, id, size, frame rate, work area. |
| `bodymovin_status` | Panel open and ready, the open project, the current or last export. |
| `bodymovin_open` | Open the panel and wait until it can export. |
| `bodymovin_restart` | Reload the panel and wait - the refresh for a stuck panel. |
| `bodymovin_defaults` | Bodymovin's default export settings: every key `settings` can override. |

Example `bodymovin_export` arguments:

```json
{
  "comp": "Main",
  "folder": "/absolute/path/to/output",
  "fileName": "my-animation",
  "settings": {
    "original_names": true,
    "original_assets": true,
    "audio": {"bitrate": "__bodymovin_sound_template_32"}
  }
}
```

The ports in use: ae-vision takes 8791 (After Effects) and 8792 (Illustrator);
this server takes 8793.

## Scripting it

The MCP tools are built on this ExtendScript API, which is also usable on its
own - from a CEP extension's `evalScript`, a `.jsx` file, or AppleScript's
`DoScript`.

### The panel

```js
$.__bodymovinControl.open()      // open the panel; refuses if already open
$.__bodymovinControl.isReady()   // true once the panel is open and can export
$.__bodymovinControl.reload()    // reload the open panel
$.__bodymovinControl.restart()   // reload if open, open if not - the "refresh"
$.__bodymovinControl.status()    // JSON: panel state, open project, current export
$.__bodymovinControl.listComps() // JSON: every comp in the open project
```

The panel must be open to export: it handles the image copying and audio
encoding a render asks for. Call `open()`, then poll `isReady()` - about three
seconds from a cold start.

### Exporting

```js
$.__bodymovinMCP.bm_scriptExport.exportComp(JSON_STRING)
$.__bodymovinMCP.bm_scriptExport.status()     // poll until "finished" or "failed"
$.__bodymovinMCP.bm_scriptExport.defaults()   // the settings an export starts from
```

`exportComp` takes one JSON string:

```json
{
  "comp": "Main",
  "folder": "/absolute/path/to/output",
  "fileName": "my-animation",
  "settings": {
    "original_names": true,
    "original_assets": true,
    "audio": {"bitrate": "__bodymovin_sound_template_32"}
  }
}
```

- `comp` - the composition's name (must be unique in the project) or its id.
- `fileName` - written as `<fileName>.json`; images and audio go in `images/` beside it.
- `settings` - optional. Deep-merged over the panel's own defaults, using the
  keys the panel stores (see `defaults()` and `src/redux/reducers/compositions.js`).
  Panel checkbox to key: *Original Asset Names* `original_names`, *Copy
  Original Assets* `original_assets`, audio bitrate `audio.bitrate`.

Both `exportComp` and `status` return JSON:

```json
{"state": "rendering", "comp": "Main", "file": "/abs/path/my-animation.json", "progress": 0.4, "message": "Rendering layer: ..."}
```

`state` is `idle`, `rendering`, `finished` or `failed` (with `message`, and
`alert` if Bodymovin raised one). One export at a time.

## How it works

The official export is mostly ExtendScript: the panel's Render button calls
`bm_compsManager.renderComposition(...)`, which walks the comp and writes the
JSON. Midway it sends events back to the panel to copy images, re-encode
audio and resolve fonts. `exportComp` makes that same call with the settings
supplied, so the output is the same.

What the fork adds:

| File | Does |
|---|---|
| `bundle/jsx/scriptExport.jsx` | `exportComp` / `status`. Loaded by `initializer.jsx`. |
| `bundle/control/helper.*` | A hidden extension that starts with After Effects. Hosts the MCP server, and opens the panel when asked - only an extension can open another extension's panel. |
| `bundle/control/mcp/` | The MCP server: HTTP and auth (`server.js`), JSON-RPC (`protocol.js`), the tools (`tools.js`). Node builtins only. |
| `bundle/control/panel.js` | Loaded into the panel. Reports open/closed, reloads on request, and triggers the panel's script loading itself. |
| `scripts/install.py` | Builds the install from the official build - see below. |

### Why it is built this way

- **No React rebuild.** The panel's UI build needs 2017-era Node tooling. The
  installer takes the official built extension as a base and lays the fork's
  ExtendScript and the `control/` files on top.
- **Its own identity.** All CEP extensions in After Effects share one script
  engine, and every panel hears every event. Two Bodymovins with the same
  names would overwrite each other's code and answer each other's exports.
  The installer renames the copy: extension ids (`com.bodymovin.mcp.*`),
  menu name, the script namespace (`$.__bodymovin` to `$.__bodymovinMCP`),
  event names (`bm:` to `bmcp:`), the panel's local server port (24801 to
  24802), its temp folder and debug ports. The source keeps upstream's names
  so it still merges cleanly.

## Things learned the hard way

- **The panel only loads its ExtendScript on the first focus, click or hover**
  (`ExtensionLoader` in the React build). An untouched panel cannot export.
  `panel.js` fires that trigger on load.
- **CEP loads an extension's ScriptPath on its first `evalScript`**, not when
  the extension starts. `helper.js` makes one call at startup so
  `$.__bodymovinControl` exists.
- **Never reopen a panel that is closing.** Closing the panel and calling
  `requestOpenExtension` 1.5 s later crashed After Effects 26.5 inside PlugPlug
  (`HtmlPanelNativeWindow::SetWindowActive`). `restart()` reloads in place
  instead, and `open()` refuses while the panel is open.
- **CEP's Node is old** - v17.7.2 in After Effects 26.5. The MCP server uses
  Node builtins only, hand-rolled like ae-vision's, rather than the MCP SDK.
- AppleScript's `DoScript` runs in the same script engine as the extensions,
  but does not return the script's result - write it to a file.

## Upstream

A fork of [bodymovin/bodymovin-extension](https://github.com/bodymovin/bodymovin-extension)
(MIT). `master` tracks upstream untouched; this work lives on `main`.
Pull upstream changes into `master`, then merge them into `main` and
re-run the installer - the source keeps upstream's names so merges stay clean.
Nothing here is pushed upstream.

### Developing the panel UI

1. Setup AE for debugging extensions ([guide](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_9.x/Documentation/CEP%209.0%20HTML%20Extension%20Cookbook.md#debugging-unsigned-extensions))
2. Install the [CEF client](https://github.com/Adobe-CEP/CEP-Resources/tree/master/CEP_9.x) you'll need for remote debugging
3. Install extension dependencies (`npm i`)
4. Install server dependencies (`cd bundle/server && npm i`)
5. Run `npm run start-dev`
6. Open the CEF client and navigate to `http://localhost:8092`

The extension window will now hot-reload and you can use the devtools in the CEF client.
