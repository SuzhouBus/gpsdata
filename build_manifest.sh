#!/bin/bash
dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
manifest="$dir/manifest.json"
manifest_extra_src="$dir/manifest_extra.json5"
manifest_extra="$dir/manifest_extra.json"

echo Building "$manifest_extra"...
"$dir/node_modules/json5/lib/cli.js" -o "$manifest_extra" "$manifest_extra_src"

"$dir/update_manifest_hash.sh"
