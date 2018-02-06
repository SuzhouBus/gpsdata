#!/bin/bash

./node_modules/.bin/babel node_modules/whatwg-fetch/fetch.js --presets=env --out-file fetch.min.js --minified --source-maps
./node_modules/.bin/babel timetable.js --presets=env --out-file timetable.min.js --minified --source-maps
