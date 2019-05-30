#!/bin/bash
dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
manifest="$dir/manifest.json"
manifest_archives="$dir/manifest_archives.json"

regex_archives='"archives_version":\s*"\([^"]*\)"'

archives_hash=$(grep -o "$regex_archives" "$manifest" | sed 's/'"$regex_archives"'/\1/')
archives_hash_new=$(wc -c < "$manifest_archives")_$(hash=$(md5sum < "$manifest_archives" | cut -d ' ' -f 1); echo ${hash:0:6})

if [[ "$archives_hash" != "$archives_hash_new" ]]; then
  echo Updating archives_version from \'"$archives_hash"\' to \'"$archives_hash_new"\'...
  sed -i 's/'"$regex_archives"'/"archives_version": "'"$archives_hash_new"'"/' "$manifest"
else
  echo Nothing to update.
fi
