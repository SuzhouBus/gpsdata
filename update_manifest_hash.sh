#!/bin/bash
dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESULT_NO_UPDATE=2019
manifest="$dir/manifest.json"

update_hash() {
  sub_manifest="$dir/manifest_$1.json"
  version_regex='\("'"$1"'_version":\s*\)"\([^"]*\)"'

  version=$(grep -o "$version_regex" "$manifest" | sed 's/'"$version_regex"'/\2/')
  version_new=$(wc -c < "$sub_manifest")_$(hash=$(md5sum < "$sub_manifest" | cut -d ' ' -f 1); echo ${hash:0:6})
  if [[ "$version" != "$version_new" ]]; then
    echo Updating $1 version from \'"$version"\' to \'"$version_new"\'...
    sed -i 's/'"$version_regex"'/\1"'"$version_new"'"/' "$manifest"
  else
    echo No change detected for $1.
  fi
}

update_hash archives
update_hash extra
