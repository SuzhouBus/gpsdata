#!/bin/bash

dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
babel="$dir/node_modules/.bin/babel"

pushd "$(dirname "${BASH_SOURCE[0]}")" > /dev/null
PIDS=()

python -m SimpleHTTPServer > /dev/null 2>&1 &
PIDS+=($!)
"$babel" -w --presets=env --minified --source-maps --out-file timetable.min.js timetable.js &
PIDS+=($!)
"$babel" -w --presets=env --minified --source-maps --out-file js/wj_timetable.min.js js/common.js js/wj_timetable.js &
PIDS+=($!)
"$babel" -w --presets=es2016,es2017,minify --no-babelrc --minified --source-maps --out-file js/buses.min.js js/buses.js &
PIDS+=($!)
"$babel" -w --source-maps --out-file js/buses.legacy.min.js js/buses.js &

echo Started!

trap "echo ' Exiting...'; sleep 1; $dir/build.py; kill ${PIDS[*]} 2>/dev/null" SIGINT
wait

popd > /dev/null
