# Bodymovin Scriptable

A fork of the Bodymovin extension that can be driven from scripts: open the
panel and export a Lottie without clicking anything. Built for automated
pipelines and agents (an MCP server driving After Effects, a batch script).

It installs **next to** the official Bodymovin as a separate extension,
*Window > Extensions > Bodymovin Scriptable*. The official one is not changed.

Verified on After Effects 26.5 (2026) against Bodymovin 5.12.1: a scripted
export of a production comp was byte-identical to the same comp exported by
hand from the official panel - JSON and every image. The only difference was
the encode date Bodymovin writes into a re-encoded mp3's ID3 tag.

## Install

Needs the official Bodymovin 5.12.1 installed (it is the base) and CEP debug
mode on (`defaults write com.adobe.CSXS.12 PlayerDebugMode 1`), since this
build is unsigned. Quit After Effects, then:

```bash
python3 scripts/install-scriptable.py
```

It installs to `~/Library/Application Support/Adobe/CEP/extensions/bodymovin-scriptable`
- the per-user folder, no admin rights needed. Run it again after any change
to the fork; it replaces the previous install.

## Scripting it

Everything is called from ExtendScript in After Effects - from a CEP
extension's `evalScript`, a `.jsx` file, or AppleScript's `DoScript`.

### The panel

```js
$.__bodymovinControl.open()      // open the panel; refuses if already open
$.__bodymovinControl.isReady()   // true once the panel is open and can export
$.__bodymovinControl.reload()    // reload the open panel
$.__bodymovinControl.restart()   // reload if open, open if not - the "refresh"
```

The panel must be open to export: it handles the image copying and audio
encoding a render asks for. Call `open()`, then poll `isReady()` - about three
seconds from a cold start.

### Exporting

```js
$.__bodymovinScriptable.bm_scriptExport.exportComp(JSON_STRING)
$.__bodymovinScriptable.bm_scriptExport.status()     // poll until "finished" or "failed"
$.__bodymovinScriptable.bm_scriptExport.defaults()   // the settings an export starts from
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
| `bundle/control/helper.*` | A hidden extension that starts with After Effects. Only an extension can open another extension's panel, so it opens the panel when a script asks. |
| `bundle/control/panel.js` | Loaded into the panel. Reports open/closed, reloads on request, and triggers the panel's script loading itself. |
| `scripts/install-scriptable.py` | Builds the install from the official build - see below. |

### Why it is built this way

- **No React rebuild.** The panel's UI build needs 2017-era Node tooling. The
  installer takes the official built extension as a base and lays the fork's
  ExtendScript and the `control/` files on top.
- **Its own identity.** All CEP extensions in After Effects share one script
  engine, and every panel hears every event. Two Bodymovins with the same
  names would overwrite each other's code and answer each other's exports.
  The installer renames the copy: extension ids (`com.bodymovin.scriptable.*`),
  menu name, the script namespace (`$.__bodymovin` to `$.__bodymovinScriptable`),
  event names (`bm:` to `bms:`), the panel's local server port (24801 to
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
- AppleScript's `DoScript` runs in the same script engine as the extensions,
  but does not return the script's result - write it to a file.

## Upstream

A fork of [bodymovin/bodymovin-extension](https://github.com/bodymovin/bodymovin-extension)
(MIT). `master` tracks upstream untouched; this work lives on `scriptable`.
Pull upstream changes into `master`, then merge them into `scriptable` and
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
