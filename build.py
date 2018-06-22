#!/usr/bin/env python

import os, re, subprocess

SCRIPT_PATH = os.path.dirname(__file__)
INPUT_HTML = 'sz3.html'
INPUT_LEGACY_HTML = 'sz3.legacy.html'
EMBED_REGEX = re.compile(r'<script src="([^"]+)" data-embedded></script>');

def LoadScript(match, legacy=False, raw=False):
  with open(os.path.join(SCRIPT_PATH, match.group(1)), 'r') as f:
    return b'<script>%s</script>' % f.read()

if __name__ == '__main__':
  subprocess.call([os.path.join(SCRIPT_PATH, 'build_preprocess.sh')])

  for filename in [INPUT_HTML, INPUT_LEGACY_HTML]:
    with open(os.path.join(SCRIPT_PATH, filename), 'r+') as f:
      contents = f.read()
      f.seek(0)
      f.truncate(0)
      f.write(EMBED_REGEX.sub(LoadScript, contents))
