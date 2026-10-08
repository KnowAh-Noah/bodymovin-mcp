/*
 * Loaded into the stock Bodymovin panel alongside its React build.
 * Lets scripts reload the panel, and tells ExtendScript whether
 * the panel is open ($.__bodymovinControl.panelOpen).
 */
(function () {
  'use strict';
  var cs = new CSInterface();

  function setOpen(isOpen) {
    cs.evalScript('if ($.__bodymovinControl) { $.__bodymovinControl.panelOpen = ' + isOpen + '; }');
  }

  cs.addEventListener('com.bodymovin.control.reload', function () {
    window.location.reload();
  });
  window.addEventListener('beforeunload', function () { setOpen(false); });

  // The React app loads Bodymovin's ExtendScript (jsx/initializer.jsx) after
  // this runs, and that recreates $.__bodymovin. Drop any copy left by an
  // earlier load first, so isReady() waits for the fresh one.
  cs.evalScript('if ($.__bodymovin) { delete $.__bodymovin.bm_scriptExport; }');
  setOpen(true);

  // The panel only loads its ExtendScript on the first focus, click or hover
  // (ExtensionLoader in the React build), so an untouched panel can't export.
  // Fire that trigger once the app has attached its listeners.
  window.addEventListener('load', function () {
    window.dispatchEvent(new Event('focus'));
  });
}());
