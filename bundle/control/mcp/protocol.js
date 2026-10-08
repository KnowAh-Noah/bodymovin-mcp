/*
 * MCP protocol layer - JSON-RPC 2.0, hand-rolled.
 *
 * No @modelcontextprotocol/sdk: CEP ships its own Node runtime, and MCP over
 * HTTP is a small, stable JSON-RPC surface. Implementing it directly avoids
 * bundling node_modules into the extension. Same approach as ae-vision.
 */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'bodymovin', version: '1.0.0' };

const INSTRUCTIONS = [
  'Exports After Effects compositions to Lottie JSON through Bodymovin, without clicking the panel.',
  'bodymovin_export does everything: opens the panel if needed, exports, and waits until the file is written.',
  'Use bodymovin_list_comps to find comp names. Settings use the keys Bodymovin stores - see bodymovin_defaults.',
  'Common settings: original_names (Original Asset Names), original_assets (Copy Original Assets), audio.bitrate.',
].join(' ');

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function createMcpHandler(registry) {
  async function handleOne(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg && msg.id !== undefined ? msg.id : null, -32600, 'Not a JSON-RPC 2.0 request');
    }
    const { id, method, params } = msg;
    // Notifications have no id and are never answered.
    const isNotification = id === undefined;
    try {
      switch (method) {
        case 'initialize': {
          const asked = params && params.protocolVersion;
          return rpcResult(id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          });
        }
        case 'notifications/initialized':
        case 'initialized':
          return null;
        case 'ping':
          return isNotification ? null : rpcResult(id, {});
        case 'tools/list':
          return rpcResult(id, { tools: registry.tools });
        case 'tools/call':
          if (!params || typeof params.name !== 'string') {
            return rpcError(id, -32602, 'tools/call requires a name');
          }
          return rpcResult(id, await registry.callTool(params.name, params.arguments || {}));
        case 'resources/list':
          return rpcResult(id, { resources: [] });
        case 'prompts/list':
          return rpcResult(id, { prompts: [] });
        default:
          return isNotification ? null : rpcError(id, -32601, `Unknown method: ${method}`);
      }
    } catch (err) {
      return isNotification ? null : rpcError(id, -32603, String((err && err.message) || err));
    }
  }

  // Takes a raw request body; returns a response, or null for a notification.
  return async function handle(body) {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch (err) {
      return rpcError(null, -32700, 'Invalid JSON');
    }
    if (Array.isArray(msg)) {
      const out = [];
      for (const m of msg) {
        const r = await handleOne(m);
        if (r) out.push(r);
      }
      return out.length ? out : null;
    }
    return handleOne(msg);
  };
}

module.exports = { createMcpHandler };
