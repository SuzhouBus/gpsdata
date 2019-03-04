#!/bin/bash
dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
begin_token="BEGIN MANIFEST"
end_token="END MANIFEST"
target_file="$dir/sz3.base.html"

echo 'ERROR: This script has been deprecated.'
exit

if ! diff -u <(grep -B 0 -A 99999 -F "$begin_token" "$target_file" | grep -B 99999 -A 0 "$end_token" | head -n -1 | tail -n +2) "$dir/manifest.json"; then
  echo ======== Manifest changed! Updating... ========
  ex -es -c '/BEGIN MANIFEST/+1,/END MANIFEST/-1 d' -c '/BEGIN MANIFEST/ r '"$dir/manifest.json" -c 'wq' "$target_file"
fi
