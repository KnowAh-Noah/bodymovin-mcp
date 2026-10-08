<h1 align="center">Bodymovin MCP</h1>

<p align="center">
  An MCP server that lets an AI agent <strong>export Lottie animations</strong> from a live Adobe After Effects session.
</p>

---

Bodymovin exports After Effects compositions to Lottie, but only from its
panel, one click at a time. This fork adds an MCP server so an agent - or any
script - can export a comp and get the files back without touching the panel.
The output is identical to an export made by hand.

It installs **next to** the official Bodymovin, as *Window > Extensions >
Bodymovin MCP*, and leaves the official one alone.

**Requires** macOS and the official
[Bodymovin](https://exchange.adobe.com/apps/cc/12557/bodymovin) 5.12.1
installed. Tested on After Effects 2026 (26.5).

## Quick start

1. **Turn on CEP debug mode.** This build is unsigned, so After Effects only
   loads it with debug mode on:

   ```bash
   defaults write com.adobe.CSXS.12 PlayerDebugMode 1
   ```

2. **Install.** Quit After Effects, then from a clone of this repo:

   ```bash
   python3 scripts/install.py
   ```

   Run it again to update after pulling changes.

3. **Open After Effects.** The server starts by itself on `127.0.0.1:8793`.
   No panel needs to be open.

4. **Connect your client.** For Claude Code:

   ```bash
   claude mcp add --transport http --scope user bodymovin http://127.0.0.1:8793/mcp --header "Authorization: Bearer $(cat ~/.bodymovin-mcp/token)"
   ```

   Any client that speaks MCP over Streamable HTTP with a bearer token works
   the same way.

5. **Check it.** Ask your agent to *"run `bodymovin_status`"*. You should get
   the open project back.

## The tools

| Tool | What it does |
|---|---|
| `bodymovin_export` | Export a comp to Lottie JSON and wait until it is written. Opens the panel if needed. Returns the JSON path and every exported image and audio file |
| `bodymovin_list_comps` | Every comp in the open project, with size, frame rate and work area |
| `bodymovin_status` | Whether the panel is ready, the open project, and the current or last export |
| `bodymovin_open` | Open the Bodymovin MCP panel and wait until it can export |
| `bodymovin_restart` | Reload the panel - the refresh for when it gets stuck |
| `bodymovin_defaults` | Bodymovin's default export settings: every option an export can change |
| `bodymovin_save_preset` | Save a named set of export settings |
| `bodymovin_list_presets` | The saved presets |
| `bodymovin_delete_preset` | Delete a preset |

An export takes a comp, an output folder and, optionally, a file name, a
preset and settings. Settings use Bodymovin's own option names, and a misspelt
one is refused rather than ignored:

```json
{
  "comp": "Main",
  "folder": "/Users/me/Exports/Main",
  "fileName": "main",
  "settings": {
    "original_names": true,
    "original_assets": true
  }
}
```

This writes `main.json`, with images and audio in `images/` beside it.

| Panel option | Setting |
|---|---|
| Original Asset Names | `original_names` |
| Copy Original Assets | `original_assets` |
| Audio bitrate | `audio.bitrate` (`__bodymovin_sound_template_16` ... `_32`) |

## Presets

Save the settings you use often under a name, then export with just the name:

```json
{ "name": "Web", "settings": { "original_names": true, "original_assets": true } }
```

```json
{ "comp": "Main", "folder": "/Users/me/Exports/Main", "preset": "Web" }
```

Settings passed with a preset override it for that one export. Presets are
yours, not part of the extension: they are saved in
`~/.bodymovin-mcp/presets.json` and survive reinstalls. Names are matched
regardless of case.

## Without MCP

The same controls are available to any After Effects script (`.jsx`, a CEP
extension, or AppleScript's `DoScript`):

```js
$.__bodymovinControl.open()                              // open the panel
$.__bodymovinControl.isReady()                           // true once it can export
$.__bodymovinMCP.bm_scriptExport.exportComp(jsonString)  // same arguments as bodymovin_export
$.__bodymovinMCP.bm_scriptExport.status()                // poll until "finished" or "failed"
```

## Security

The bearer token is the trust boundary: anything holding it can drive After
Effects as you.

- Listens on `127.0.0.1` only. The token lives in `~/.bodymovin-mcp/token`
  (mode `0600`) and is required on every request.
- The `Host` header is pinned to loopback, which blocks DNS rebinding, and
  requests from web origins are refused.

## Credits

A fork of [bodymovin/bodymovin-extension](https://github.com/bodymovin/bodymovin-extension)
by Hernan Torrisi, which does the actual export. The `master` branch tracks
upstream unchanged; this project lives on `main`.

## Licence

MIT - see [LICENSE](LICENSE). Copyright (c) 2017 hernan.
