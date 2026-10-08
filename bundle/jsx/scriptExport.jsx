/*jslint vars: true , plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global $, app, File, Folder, CompItem*/

/*
 * Scripted export.
 *
 * Runs the same path as the panel's Render button
 * (bm_compsManager.renderComposition) without clicking anything. The panel
 * must still be loaded: it answers the image, audio and font callbacks the
 * render sends out. Use $.__bodymovinControl.open() (helper extension) to load it.
 *
 *   $.__bodymovin.bm_scriptExport.exportComp('{"comp":"Main","folder":"/path/to/output","fileName":"main","settings":{"original_names":true}}')
 *   $.__bodymovin.bm_scriptExport.status()   // JSON string, poll until state is "finished" or "failed"
 *
 * Arguments are a JSON string so callers never have to build ExtendScript
 * literals. `settings` in the arguments is deep-merged over the panel's
 * defaults, using the same keys the panel stores (see defaults() below).
 */
$.__bodymovin.bm_scriptExport = (function () {
    'use strict';
    var JSON = $.__bodymovin.JSON;
    var dispatcher = $.__bodymovin.bm_eventDispatcher;
    var API_VERSION = '1';

    // The panel's default comp settings - keep in step with
    // src/redux/reducers/compositions.js.
    function defaults() {
        return {
            segmented: false,
            segmentedTime: 10,
            standalone: false,
            avd: false,
            glyphs: true,
            includeExtraChars: false,
            bundleFonts: false,
            inlineFonts: false,
            hiddens: false,
            original_assets: false,
            original_names: false,
            should_encode_images: false,
            should_compress: true,
            should_skip_images: false,
            should_reuse_images: false,
            should_include_av_assets: false,
            compression_rate: 80,
            extraComps: {active: false, list: []},
            guideds: false,
            ignore_expression_properties: false,
            export_old_format: false,
            use_source_names: false,
            shouldTrimData: false,
            skip_default_properties: false,
            not_supported_properties: false,
            pretty_print: false,
            useCompNamesAsIds: false,
            export_mode: 'standard',
            export_modes: {standard: true, demo: false, standalone: false, banner: false, avd: false, smil: false, rive: false, reports: false},
            demoData: {backgroundColor: '#ffffff'},
            banner: {
                lottie_origin: 'local', lottie_path: 'https://', lottie_library: 'full', lottie_renderer: 'svg',
                width: 500, height: 500, use_original_sizes: true, original_width: 500, original_height: 500,
                click_tag: 'https://', zip_files: true, shouldIncludeAnimationDataInTemplate: false,
                shouldLoop: false, loopCount: 0, localPath: null
            },
            expressions: {shouldBake: false, shouldCacheExport: false, shouldBakeBeyondWorkArea: false, sampleSize: 1},
            audio: {isEnabled: true, shouldRaterizeWaveform: true, bitrate: '__bodymovin_sound_template_16'},
            metadata: {includeFileName: false, customProps: []},
            template: {active: false, id: 0, errors: []},
            essentialProperties: {active: true, useSlots: false, skipExternalComp: false}
        };
    }

    function merge(target, source) {
        var key;
        for (key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] && typeof source[key] === 'object' && !(source[key] instanceof Array)
                        && target[key] && typeof target[key] === 'object') {
                    merge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        }
        return target;
    }

    var state = {state: 'idle'};

    function setState(next) {
        state = next;
        state.at = new Date().getTime();
    }

    // Watch the render's own progress events so status() can report them.
    var originalSend = dispatcher.sendEvent;
    dispatcher.sendEvent = function (type, data) {
        if (state.state === 'rendering') {
            var parsed = data;
            if (typeof data === 'string') {
                try { parsed = JSON.parse(data); } catch (e) { parsed = null; }
            }
            if (type === 'bm:render:update' && parsed) {
                state.message = parsed.message;
                state.progress = parsed.progress;
                if (parsed.isFinished === true) {
                    setState({state: 'finished', file: state.file, comp: state.comp});
                } else if (parsed.isFinished === false) {
                    setState({state: 'failed', file: state.file, comp: state.comp, message: parsed.message});
                }
            } else if (type === 'bm:alert' && parsed) {
                state.alert = parsed.message;
            } else if (type === 'bm:render:cancel') {
                setState({state: 'failed', file: state.file, comp: state.comp, message: 'cancelled'});
            }
        }
        return originalSend.apply(dispatcher, arguments);
    };

    function findComp(nameOrId) {
        var i, item, matches = [];
        for (i = 1; i <= app.project.numItems; i += 1) {
            item = app.project.item(i);
            if (item instanceof CompItem && (item.name === nameOrId || item.id === nameOrId)) {
                matches.push(item);
            }
        }
        if (matches.length !== 1) {
            throw new Error(matches.length + ' comps match "' + nameOrId + '" - need exactly one');
        }
        return matches[0];
    }

    function exportComp(argsJSON) {
        try {
            if (state.state === 'rendering') {
                throw new Error('an export is already running');
            }
            var args = JSON.parse(argsJSON);
            var comp = findComp(args.comp);
            var folder = new Folder(args.folder);
            if (!folder.exists && !folder.create()) {
                throw new Error('cannot create folder ' + args.folder);
            }
            var fileName = (args.fileName || 'data').replace(/\.json$/, '');
            var file = new File(folder.fsName + '/' + fileName + '.json');
            var settings = merge(defaults(), args.settings || {});
            var compositionData = {
                id: comp.id,
                uid: 'script-' + comp.id + '-' + new Date().getTime(),
                absoluteURI: file.absoluteURI,
                destination: file.fsName,
                settings: settings
            };
            setState({state: 'rendering', comp: comp.name, file: file.fsName, progress: 0});
            $.__bodymovin.bm_compsManager.renderComposition(compositionData);
            return JSON.stringify(state);
        } catch (err) {
            setState({state: 'failed', message: String(err)});
            return JSON.stringify(state);
        }
    }

    function status() {
        return JSON.stringify(state);
    }

    function ping() {
        return JSON.stringify({ready: true, api: API_VERSION, bodymovin: $.__bodymovin.bm_versionHelper.get()});
    }

    return {
        exportComp: exportComp,
        status: status,
        ping: ping,
        defaults: function () { return JSON.stringify(defaults()); }
    };
}());
