/*
 * The MCP tools. Each one runs ExtendScript in After Effects through the
 * helper extension's evalScript - the same script engine the Bodymovin panel
 * uses - and calls $.__bodymovinControl (control/helper.jsx) or
 * $.__bodymovin.bm_scriptExport (jsx/scriptExport.jsx).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const presets = require('./presets.js');

const READY_TIMEOUT_MS = 30000;
const POLL_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The helper page's window.__adobe_cep__, set by server.start().
let cep = null;
const setHost = (host) => { cep = host; };

function evalHost(script, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!cep) {
      reject(new Error('Not connected to After Effects'));
      return;
    }
    const timer = setTimeout(() => reject(new Error(`After Effects did not answer within ${timeoutMs / 1000}s`)), timeoutMs);
    cep.evalScript(script, (result) => {
      clearTimeout(timer);
      if (result === 'EvalScript error.') {
        reject(new Error('ExtendScript error in After Effects'));
      } else {
        resolve(result);
      }
    });
  });
}

async function hostJSON(script) {
  const raw = await evalHost(script);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unexpected reply from After Effects: ${raw}`);
  }
}

// An ExtendScript string literal carrying `value`. JSON string syntax is valid
// ExtendScript, except that raw U+2028/U+2029 end a line there.
const literal = (value) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const status = () => hostJSON('$.__bodymovinControl.status()');

async function waitReady(timeoutMs) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await status();
    if (last.ready) return last;
    await sleep(POLL_MS);
  }
  throw new Error(`The Bodymovin panel was not ready after ${timeoutMs / 1000}s (panelOpen: ${last && last.panelOpen})`);
}

// Open the panel if it is closed, reload it if it is open but stuck, then wait.
async function ensureReady() {
  const now = await status();
  if (now.ready) return now;
  if (!now.panelOpen) {
    await evalHost('$.__bodymovinControl.open()');
    return waitReady(READY_TIMEOUT_MS);
  }
  try {
    return await waitReady(10000);
  } catch (err) {
    await evalHost('$.__bodymovinControl.reload()');
    return waitReady(READY_TIMEOUT_MS);
  }
}

function resolveFolder(folder) {
  if (typeof folder !== 'string' || !folder) throw new Error('folder is required');
  const expanded = folder.startsWith('~') ? path.join(os.homedir(), folder.slice(1)) : folder;
  if (!path.isAbsolute(expanded)) throw new Error(`folder must be an absolute path: ${folder}`);
  return expanded;
}

function listOutput(jsonFile) {
  const out = { file: jsonFile, bytes: null, images: [] };
  try { out.bytes = fs.statSync(jsonFile).size; } catch (err) { /* reported as null */ }
  const imagesDir = path.join(path.dirname(jsonFile), 'images');
  try {
    out.images = fs.readdirSync(imagesDir).filter((f) => !f.startsWith('.')).sort();
    out.imagesFolder = imagesDir;
  } catch (err) { /* no images exported */ }
  return out;
}

const getDefaults = () => hostJSON('$.__bodymovin.bm_scriptExport.defaults()');

// A misspelt option would otherwise be ignored without a word, so refuse it.
async function checkSettings(settings) {
  const unknown = presets.unknownKeys(settings, await getDefaults());
  if (unknown.length) {
    throw new Error(`Not Bodymovin settings: ${unknown.join(', ')}. See bodymovin_defaults for the option names.`);
  }
}

const tools = [
  {
    name: 'bodymovin_status',
    description: 'Whether the Bodymovin panel is open and ready to export, the open After Effects project, and the current or last export.',
    inputSchema: { type: 'object', properties: {} },
    run: () => status(),
  },
  {
    name: 'bodymovin_open',
    description: 'Open the Bodymovin panel and wait until it can export. Does nothing if it is already open. bodymovin_export does this itself.',
    inputSchema: { type: 'object', properties: {} },
    run: () => ensureReady(),
  },
  {
    name: 'bodymovin_restart',
    description: 'Reload the Bodymovin panel (or open it if closed) and wait until it can export - the refresh to use when an export fails or the panel looks stuck. Not while an export is running.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const now = await status();
      if (now.export && now.export.state === 'rendering') throw new Error('An export is running - wait for it to finish');
      await evalHost('$.__bodymovinControl.restart()');
      await sleep(1000);
      return waitReady(READY_TIMEOUT_MS);
    },
  },
  {
    name: 'bodymovin_list_comps',
    description: 'Every composition in the open After Effects project: name, id, size, frame rate, duration, work area. Bodymovin exports the work area.',
    inputSchema: { type: 'object', properties: {} },
    run: () => hostJSON('$.__bodymovinControl.listComps()'),
  },
  {
    name: 'bodymovin_defaults',
    description: 'The export settings an export starts from - Bodymovin\'s own defaults - showing every key bodymovin_export\'s settings can override.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      await ensureReady();
      return getDefaults();
    },
  },
  {
    name: 'bodymovin_list_presets',
    description: 'The saved export presets: each one\'s name, description and settings. Presets belong to this user and live in ~/.bodymovin-mcp/presets.json.',
    inputSchema: { type: 'object', properties: {} },
    run: () => presets.list(),
  },
  {
    name: 'bodymovin_save_preset',
    description: 'Save a named set of export settings, to use with bodymovin_export\'s preset. Settings use Bodymovin\'s option names (see bodymovin_defaults) and are checked against them. Only list the options that differ from the defaults.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Preset name. Matched case-insensitively.' },
        settings: { type: 'object', description: 'Bodymovin settings, e.g. {"original_names": true, "original_assets": true}.' },
        description: { type: 'string', description: 'What the preset is for.' },
        overwrite: { type: 'boolean', description: 'Replace an existing preset of the same name.' },
      },
      required: ['name', 'settings'],
    },
    run: async (args) => {
      await ensureReady();
      await checkSettings(args.settings || {});
      return presets.put(args.name, args.settings, args.description, args.overwrite);
    },
  },
  {
    name: 'bodymovin_delete_preset',
    description: 'Delete a saved export preset.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    run: (args) => presets.remove(args.name),
  },
  {
    name: 'bodymovin_export',
    description: [
      'Export a composition to Lottie JSON and wait until it is written. Opens the panel if needed.',
      'Writes <folder>/<fileName>.json, with images and audio in <folder>/images/. Existing files of the same names are overwritten.',
      'preset names a saved preset (bodymovin_list_presets). settings are deep-merged over the preset, or over Bodymovin\'s defaults (see bodymovin_defaults). Common ones:',
      'original_names (Original Asset Names), original_assets (Copy Original Assets),',
      'audio: {bitrate: "__bodymovin_sound_template_16" ... "_32"}.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        comp: { type: ['string', 'number'], description: 'Composition name (unique in the project) or id.' },
        folder: { type: 'string', description: 'Absolute output folder; created if missing.' },
        fileName: { type: 'string', description: 'Output name without .json. Default "data", as Bodymovin.' },
        preset: { type: 'string', description: 'A saved preset to export with.' },
        settings: { type: 'object', description: 'Bodymovin settings to override, on top of the preset if one is given.' },
        timeoutSeconds: { type: 'number', description: 'Give up waiting after this long. Default 600.' },
      },
      required: ['comp', 'folder'],
    },
    run: async (args) => {
      const folder = resolveFolder(args.folder);
      const before = await ensureReady();
      if (before.export && before.export.state === 'rendering') throw new Error('Another export is running');

      const preset = args.preset ? presets.get(args.preset) : null;
      const settings = presets.merge(preset ? preset.settings : {}, args.settings || {});
      await checkSettings(settings);

      const request = { comp: args.comp, folder, fileName: args.fileName || 'data', settings };
      const started = Date.now();
      let state = await hostJSON(`$.__bodymovin.bm_scriptExport.exportComp(${literal(JSON.stringify(request))})`);
      const timeoutMs = (args.timeoutSeconds || 600) * 1000;
      while (state.state === 'rendering') {
        if (Date.now() - started > timeoutMs) {
          throw new Error(`Export still running after ${timeoutMs / 1000}s - check bodymovin_status`);
        }
        await sleep(POLL_MS);
        state = await hostJSON('$.__bodymovin.bm_scriptExport.status()');
      }
      if (state.state !== 'finished') {
        const why = [state.message, state.alert].filter(Boolean).join(' - ');
        throw new Error(`Export failed: ${why || 'no reason given'}`);
      }
      return { state: 'finished', comp: state.comp, preset: preset ? preset.name : null, seconds: (Date.now() - started) / 1000, ...listOutput(state.file) };
    },
  },
];

async function callTool(name, args) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  try {
    const result = await tool.run(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: String((err && err.message) || err) }] };
  }
}

module.exports = {
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  callTool,
  status,
  setHost,
};
