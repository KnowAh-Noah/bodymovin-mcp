#!/usr/bin/env python3
"""Install this fork as "Bodymovin MCP", next to the official Bodymovin.

The panel's React build needs 2017-era Node tooling, so the fork does not
rebuild it. The official installed build is the base: it is read, never
changed. This copies it to its own extension folder, lays the fork's
ExtendScript, control/ files and manifest on top, then gives the copy its own
identity so the two can be installed and open at the same time:

  - extension ids, menu name and debug ports
  - the ExtendScript namespace ($.__bodymovin -> $.__bodymovinMCP).
    Both panels share After Effects' one script engine, so with one name the
    second panel to load would replace the first one's code.
  - the event names (bm: -> bmcp:). Both panels hear every event, so with one
    set each would answer the other's export.
  - the panel's local image/audio server port, and its temp folder

The source keeps upstream's names so it still merges cleanly; all renaming
happens here. Quit After Effects before running - new extensions only
register on launch.

    python3 scripts/install.py
"""
import os
import re
import shutil
import sys

NAME = 'Bodymovin MCP'
BUNDLE_ID = 'com.bodymovin.mcp'
PANEL_ID = BUNDLE_ID + '.panel'
CONTROL_ID = BUNDLE_ID + '.control'
NAMESPACE = '__bodymovinMCP'
EVENT_PREFIX = 'bmcp:'
SERVER_PORT = '24802'          # official: 24801
DEBUG_PORTS = ('8492', '8493')  # panel, control
TEMP_FOLDER = 'BodymovinMCP'
VERSION = '5.12.1'             # the Lottie's "v" - must stay the official version

EXTENSIONS = '/Library/Application Support/Adobe/CEP/extensions'
BASE = os.environ.get('BODYMOVIN_BASE', os.path.join(EXTENSIONS, 'bodymovin'))
# The per-user folder, so installing needs no admin rights.
USER_EXTENSIONS = os.path.expanduser('~/Library/Application Support/Adobe/CEP/extensions')
TARGET = os.environ.get('BODYMOVIN_TARGET', os.path.join(USER_EXTENSIONS, 'bodymovin-mcp'))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def rename_identity(text):
    # \b stops at '_', so __bodymovin_sound_template_* (AE render templates)
    # and $.__bodymovinControl are left alone.
    text = re.sub(r'\$\.__bodymovin\b', '$.' + NAMESPACE, text)
    text = re.sub(r'''(['"])bm:''', r'\1' + EVENT_PREFIX, text)
    text = text.replace('com.bodymovin.bodymovin_server', BUNDLE_ID + '.server')
    text = re.sub(r'com\.bodymovin\.bodymovin\b', PANEL_ID, text)
    text = text.replace('com.bodymovin.control', CONTROL_ID)
    return text


def main():
    manifest = read(os.path.join(BASE, 'CSXS', 'manifest.xml'))
    if 'ExtensionBundleId="com.bodymovin.bodymovin"' not in manifest:
        sys.exit('%s is not the official Bodymovin build. Set BODYMOVIN_BASE.' % BASE)

    if os.path.exists(TARGET):
        shutil.rmtree(TARGET)
    shutil.copytree(BASE, TARGET, symlinks=True)
    shutil.copytree(os.path.join(REPO, 'bundle', 'jsx'), os.path.join(TARGET, 'jsx'), dirs_exist_ok=True)
    shutil.copytree(os.path.join(REPO, 'bundle', 'control'), os.path.join(TARGET, 'control'))

    # Rename in every script the panel or ExtendScript runs.
    paths = [os.path.join(TARGET, 'server', 'main.js'), os.path.join(TARGET, 'index.html')]
    for folder in ('jsx', 'control', os.path.join('static', 'js')):
        for root, _, files in os.walk(os.path.join(TARGET, folder)):
            paths += [os.path.join(root, f) for f in files if f.endswith(('.jsx', '.js', '.html'))]
    for path in paths:
        write(path, rename_identity(read(path)))

    for path in [os.path.join(TARGET, 'server', 'main.js')] + [
            os.path.join(TARGET, 'static', 'js', f) for f in os.listdir(os.path.join(TARGET, 'static', 'js')) if f.endswith('.js')]:
        text = read(path)
        if '24801' not in text:
            sys.exit('server port 24801 not found in %s - the base build changed' % path)
        write(path, text.replace('24801', SERVER_PORT))

    path = os.path.join(TARGET, 'jsx', 'helpers', 'fileManager.jsx')
    text = read(path)
    text = text.replace("changePath('Bodymovin/'", "changePath('%s/'" % TEMP_FOLDER)
    text = text.replace("changePath('Bodymovin')", "changePath('%s')" % TEMP_FOLDER)
    write(path, text)

    path = os.path.join(TARGET, 'jsx', 'helpers', 'versionHelper.jsx')
    write(path, re.sub(r"(version_number = ')[^']+(';)", r'\g<1>%s\g<2>' % VERSION, read(path)))

    # Manifest: the fork's, with gulp copy-manifest's stamping and the new identity.
    text = read(os.path.join(REPO, 'bundle', 'CSXS', 'manifest.xml'))
    text = re.sub(r'(<Extension Id="com\.bodymovin\.bodymovin" Version=")[^"]+(")', r'\g<1>%s\g<2>' % VERSION, text)
    text = re.sub(r'ExtensionBundleId="com\.bodymovin\.bodymovin" ExtensionBundleVersion="[^"]+"',
                  'ExtensionBundleId="%s" ExtensionBundleVersion="%s"' % (BUNDLE_ID, VERSION), text)
    text = text.replace('ExtensionBundleName="bodymovin"', 'ExtensionBundleName="%s"' % NAME)
    text = text.replace('<MainPath>./index_dev.html</MainPath>', '<MainPath>./index.html</MainPath>')
    text = text.replace('<Menu>Bodymovin</Menu>', '<Menu>%s</Menu>' % NAME)
    write(os.path.join(TARGET, 'CSXS', 'manifest.xml'), rename_identity(text))

    write(os.path.join(TARGET, '.debug'), """<?xml version="1.0" encoding="UTF-8"?>
<ExtensionList>
    <Extension Id="%s"><HostList><Host Name="AEFT" Port="%s"/></HostList></Extension>
    <Extension Id="%s"><HostList><Host Name="AEFT" Port="%s"/></HostList></Extension>
</ExtensionList>
""" % (PANEL_ID, DEBUG_PORTS[0], CONTROL_ID, DEBUG_PORTS[1]))

    # The panel shim, injected the way public/index.html has it.
    path = os.path.join(TARGET, 'index.html')
    text = read(path)
    anchor = '<script src="howler.js"></script>'
    if text.count(anchor) != 1:
        sys.exit('howler.js tag not found in index.html - the base build changed')
    write(path, text.replace(anchor, anchor + '<script src="./CSInterface.js"></script><script src="./control/panel.js"></script>'))

    print('Installed %s %s to %s' % (NAME, VERSION, TARGET))
    print('Official Bodymovin untouched at %s' % BASE)


if __name__ == '__main__':
    main()
