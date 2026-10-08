/*
 * Hidden helper extension. Starts with After Effects, has no UI.
 *
 * Only a CEP extension can open another extension's panel, so this one does
 * it on behalf of scripts. ExtendScript fires the events through
 * $.__bodymovinControl (helper.jsx); this listens and acts.
 */
(function () {
  'use strict';
  var BODYMOVIN = 'com.bodymovin.bodymovin';
  var cs = new CSInterface();

  function open() {
    cs.requestOpenExtension(BODYMOVIN, '');
  }

  // CEP loads an extension's ScriptPath (helper.jsx) on its first evalScript,
  // not at start. Make one now so $.__bodymovinControl exists for scripts.
  cs.evalScript('typeof $.__bodymovinControl');

  cs.addEventListener('com.bodymovin.control.open', open);
}());
