#!/bin/bash

# ./node_modules/.bin/babel node_modules/whatwg-fetch/fetch.js --presets=env --out-file fetch.min.js --minified --source-maps

pushd "$(dirname "${BASH_SOURCE[0]}")" > /dev/null
PIDS=()

python -m SimpleHTTPServer &
PIDS+=($!)
./node_modules/.bin/babel -w --presets=env --minified --source-maps --out-file timetable.min.js timetable.js &
PIDS+=($!)
./node_modules/.bin/babel -w --presets=env --minified --source-maps --out-file js/wj_timetable.min.js js/common.js js/wj_timetable.js &
PIDS+=($!)

trap "echo ' Exiting...'; sleep 1; kill ${PIDS[*]} 2>/dev/null" SIGINT
wait

popd > /dev/null
