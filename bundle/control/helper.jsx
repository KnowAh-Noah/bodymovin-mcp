/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4 */
/*global $, app, CompItem, ExternalObject, CSXSEvent*/

/*
 * Script-side controls for the Bodymovin panel. Loaded by the hidden
 * helper extension when After Effects starts, so it exists before the panel
 * has ever been opened.
 *
 *   $.__bodymovinControl.open()      open the Bodymovin panel
 *   $.__bodymovinControl.reload()    reload the open panel in place
 *   $.__bodymovinControl.restart()   reload it if open, open it if not (the hard refresh)
 *   $.__bodymovinControl.isReady()   true once the panel has loaded and its export code is in place
 *   $.__bodymovinControl.status()    JSON: panel state, open project, current export
 *   $.__bodymovinControl.listComps() JSON: every composition in the open project
 *
 * status() and listComps() return JSON strings for the MCP server
 * (control/mcp/), and work before the panel has ever been opened.
 */
$.__bodymovinControl = (function () {
    'use strict';
    var xLib;
    try {
        xLib = new ExternalObject('lib:PlugPlugExternalObject');
    } catch (e) {}

    function send(type) {
        if (!xLib) {
            return 'PlugPlugExternalObject unavailable';
        }
        var eventObj = new CSXSEvent();
        eventObj.type = type;
        eventObj.data = '';
        eventObj.dispatch();
        return 'sent ' + type;
    }

    // The panel shim sets panelOpen on load and clears it on unload.
    // $.__bodymovin survives the panel closing, so it is not a signal by itself.
    // Carry panelOpen over if this file is evaluated again while the panel is
    // open - otherwise open() would reopen an open panel.
    var ob = {panelOpen: !!($.__bodymovinControl && $.__bodymovinControl.panelOpen)};
    // Never reopen a panel that is still open or closing: After Effects
    // crashes in requestOpenExtension (seen 2026-10-08, AE 26.5).
    ob.open = function () { return ob.panelOpen ? 'already open' : send('com.bodymovin.control.open'); };
    ob.reload = function () { ob.panelOpen = false; return send('com.bodymovin.control.reload'); };
    ob.restart = function () { return ob.panelOpen ? ob.reload() : ob.open(); };
    ob.isReady = function () {
        return !!(ob.panelOpen && $.__bodymovin && $.__bodymovin.bm_scriptExport);
    };

    // Minimal JSON for plain values. ExtendScript has no JSON object of its
    // own, and Bodymovin's copy only exists once the panel has loaded.
    function stringify(v) {
        var i, parts, key;
        if (v === null || v === undefined) {
            return 'null';
        }
        if (typeof v === 'number') {
            return isFinite(v) ? String(v) : 'null';
        }
        if (typeof v === 'boolean') {
            return String(v);
        }
        if (typeof v === 'string') {
            return '"' + v.replace(/[\\"\u0000-\u001f]/g, function (c) {
                if (c === '"' || c === '\\') {
                    return '\\' + c;
                }
                return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
            }) + '"';
        }
        parts = [];
        if (v instanceof Array) {
            for (i = 0; i < v.length; i += 1) {
                parts.push(stringify(v[i]));
            }
            return '[' + parts.join(',') + ']';
        }
        for (key in v) {
            if (v.hasOwnProperty(key)) {
                parts.push(stringify(key) + ':' + stringify(v[key]));
            }
        }
        return '{' + parts.join(',') + '}';
    }

    function projectInfo() {
        return {
            // File.name is URI-encoded ("My%20Project.aep").
            name: app.project.file ? decodeURI(app.project.file.name) : null,
            path: app.project.file ? app.project.file.fsName : null
        };
    }

    ob.status = function () {
        var ready = ob.isReady();
        // The export's own status is already a JSON string; splice it in.
        var exportStatus = ready ? $.__bodymovin.bm_scriptExport.status() : 'null';
        return '{"panelOpen":' + stringify(ob.panelOpen) + ',"ready":' + stringify(ready)
            + ',"bodymovinVersion":' + stringify(ready ? $.__bodymovin.bm_versionHelper.get() : null)
            + ',"project":' + stringify(projectInfo()) + ',"export":' + exportStatus + '}';
    };

    ob.listComps = function () {
        var i, item, comps = [];
        for (i = 1; i <= app.project.numItems; i += 1) {
            item = app.project.item(i);
            if (item instanceof CompItem) {
                comps.push({
                    id: item.id,
                    name: item.name,
                    width: item.width,
                    height: item.height,
                    frameRate: item.frameRate,
                    duration: item.duration,
                    workAreaStart: item.workAreaStart,
                    workAreaDuration: item.workAreaDuration,
                    layers: item.numLayers,
                    folder: item.parentFolder === app.project.rootFolder ? null : item.parentFolder.name
                });
            }
        }
        return stringify({project: projectInfo(), comps: comps});
    };

    return ob;
}());
