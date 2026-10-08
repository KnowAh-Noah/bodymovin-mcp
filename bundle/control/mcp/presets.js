/*
 * Export presets: named sets of Bodymovin settings, saved per user.
 *
 * Stored in ~/.bodymovin-mcp/presets.json, never in the extension, so a
 * reinstall keeps them and the code ships with none:
 *
 *   { "version": 1, "presets": { "<name>": { "description": "...", "settings": {...}, "updated": "<ISO date>" } } }
 *
 * Names are matched case-insensitively and keep the case they were saved with.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.BODYMOVIN_MCP_TOKEN_DIR || path.join(os.homedir(), '.bodymovin-mcp');
const FILE = path.join(DIR, 'presets.json');

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function load() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, presets: {} };
    throw err;
  }
  const data = JSON.parse(raw);
  if (!isPlainObject(data) || !isPlainObject(data.presets)) throw new Error(`${FILE} is not a presets file`);
  return data;
}

// Write to a temporary file and rename, so a crash never leaves half a file.
function save(data) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
}

function findKey(data, name) {
  const wanted = String(name).trim().toLowerCase();
  return Object.keys(data.presets).find((k) => k.toLowerCase() === wanted);
}

function get(name) {
  const data = load();
  const key = findKey(data, name);
  if (!key) {
    const names = Object.keys(data.presets);
    throw new Error(`No preset "${name}". ${names.length ? `Saved presets: ${names.join(', ')}` : 'No presets saved yet - see bodymovin_save_preset.'}`);
  }
  return { name: key, ...data.presets[key] };
}

function list() {
  const data = load();
  return {
    file: FILE,
    presets: Object.keys(data.presets).sort().map((name) => ({ name, ...data.presets[name] })),
  };
}

function put(name, settings, description, overwrite) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('A preset needs a name');
  if (!isPlainObject(settings) || !Object.keys(settings).length) throw new Error('A preset needs settings');
  const data = load();
  const existing = findKey(data, clean);
  if (existing && !overwrite) {
    throw new Error(`A preset "${existing}" already exists - pass overwrite: true to replace it`);
  }
  if (existing) delete data.presets[existing];
  data.presets[clean] = { description: description || '', settings, updated: new Date().toISOString() };
  save(data);
  return { saved: clean, replaced: !!existing, file: FILE, ...data.presets[clean] };
}

function remove(name) {
  const data = load();
  const key = findKey(data, name);
  if (!key) throw new Error(`No preset "${name}"`);
  delete data.presets[key];
  save(data);
  return { deleted: key, file: FILE };
}

// Every key path in `settings` that Bodymovin's defaults do not have.
function unknownKeys(settings, defaults, prefix = '') {
  const out = [];
  for (const key of Object.keys(settings)) {
    const at = prefix + key;
    if (!(key in defaults)) {
      out.push(at);
    } else if (isPlainObject(settings[key]) && isPlainObject(defaults[key])) {
      out.push(...unknownKeys(settings[key], defaults[key], `${at}.`));
    }
  }
  return out;
}

// Deep merge for settings: objects merge, everything else (arrays included) replaces.
function merge(base, over) {
  const out = { ...base };
  for (const key of Object.keys(over || {})) {
    out[key] = isPlainObject(out[key]) && isPlainObject(over[key]) ? merge(out[key], over[key]) : over[key];
  }
  return out;
}

module.exports = { get, list, put, remove, unknownKeys, merge, FILE };
