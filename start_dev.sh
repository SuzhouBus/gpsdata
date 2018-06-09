#!/bin/bash

# ./node_modules/.bin/babel node_modules/whatwg-fetch/fetch.js --presets=env --out-file fetch.min.js --minified --source-maps

pushd "$(dirname "${BASH_SOURCE[0]}")" > /dev/null

python -m SimpleHTTPServer &
./node_modules/.bin/babel -w --presets=env --minified --source-maps --out-file timetable.min.js timetable.js &
./node_modules/.bin/babel -w --presets=env --minified --source-maps --out-file js/wj_timetable.min.js js/common.js js/wj_timetable.js &
wait

popd "$(dirname "${BASH_SOURCE[0]}")" > /dev/null
