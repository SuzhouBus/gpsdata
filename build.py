#!/usr/bin/env python

import os, re, subprocess

SCRIPT_PATH = os.path.dirname(__file__)
INPUT_HTML = 'sz3.html'

def GetFileName(basename, keyword=None):
  if keyword is None:
    return basename
  name, ext = basename.rsplit('.')
  return '%s.%s.%s' % (name, keyword, ext)

def LoadScriptBase(match, legacy=False):
  path = match.group(1)
  suffix = '.min.js'
  if path.endswith(suffix):
    original_path = path[:-len(suffix)] + '.js'
    subprocess.call([os.path.join(SCRIPT_PATH, 'node_modules/.bin/babel'),
        os.path.join(SCRIPT_PATH, original_path),
        '--presets=env,minify' if legacy else '--presets=es2016,minify',
        '--out-file', os.path.join(SCRIPT_PATH, path),
        '--minified',
        '--source-maps'
    ])
  with open(os.path.join(SCRIPT_PATH, path), 'r') as f:
    return b'<script>%s</script>' % f.read()

def LoadScript(match):
  return LoadScriptBase(match)

def LoadScriptLegacy(match):
  return LoadScriptBase(match, True)

if __name__ == '__main__':
  with open(os.path.join(SCRIPT_PATH, GetFileName(INPUT_HTML, 'base')), 'r') as f:
    contents = f.read()
  embed_regex = re.compile(r'<script src="([^"]+)" data-embedded></script>');
  embed_shim_regex = re.compile(r'<script src="([^"]+)" data-embedded data-shim></script>');
  feature_detection_regex = re.compile(r'<script data-feature-detection>[\s\S]*?</script>');

  html_contents = embed_shim_regex.sub('', embed_regex.sub(LoadScript, contents))
  legacy_html_contents = feature_detection_regex.sub('', embed_shim_regex.sub(LoadScript, embed_regex.sub(LoadScriptLegacy, contents)))

  with open(os.path.join(SCRIPT_PATH, GetFileName(INPUT_HTML)), 'w') as f:
    f.write(html_contents)
  with open(os.path.join(SCRIPT_PATH, GetFileName(INPUT_HTML, 'legacy')), 'w') as f:
    f.write(legacy_html_contents)
