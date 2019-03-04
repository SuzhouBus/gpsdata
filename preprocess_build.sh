#!/bin/bash

dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
src="$dir/sz3.base.html"
out="$dir/sz3.html"
out_legacy="$dir/sz3.legacy.html"

# "$dir/update_embedded_manifest.sh"
cat "$src" | sed '/#IF(LEGACY_BROWSER)/,/#ENDIF(LEGACY_BROWSER)/d' | sed '/#\(END\)\?IF(MODERN_BROWSER)/d' > "$out"
cat "$src" | sed '/#IF(MODERN_BROWSER)/,/#ENDIF(MODERN_BROWSER)/d' | sed '/#\(END\)\?IF(LEGACY_BROWSER)/d' > "$out_legacy"
