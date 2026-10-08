/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4 */
/*global $, ExternalObject, CSXSEvent*/

/*
 * Script-side controls for the Bodymovin panel. Loaded by the hidden
 * helper extension when After Effects starts, so it exists before the panel
 * has ever been opened.
 *
 *   $.__bodymovinControl.open()      open the Bodymovin panel
 *   $.__bodymovinControl.reload()    reload the open panel in place
 *   $.__bodymovinControl.restart()   reload it if open, open it if not (the hard refresh)
 *   $.__bodymovinControl.isReady()   true once the panel has loaded and its export code is in place
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
    var ob = {panelOpen: false};
    // Never reopen a panel that is still open or closing: After Effects
    // crashes in requestOpenExtension (seen 2026-10-08, AE 26.5).
    ob.open = function () { return ob.panelOpen ? 'already open' : send('com.bodymovin.control.open'); };
    ob.reload = function () { ob.panelOpen = false; return send('com.bodymovin.control.reload'); };
    ob.restart = function () { return ob.panelOpen ? ob.reload() : ob.open(); };
    ob.isReady = function () {
        return !!(ob.panelOpen && $.__bodymovin && $.__bodymovin.bm_scriptExport);
    };
    return ob;
}());
