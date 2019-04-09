class LineDataManager {
  constructor(manifest, fetchSupportsReadableStream) {
    this.manifest = manifest;
    this.fetchSupportsReadableStream_ = fetchSupportsReadableStream;
    this.loadedLineData_ = {};
    this.lineData_ = {};

    this.earliestDate = Object.keys(manifest.archives || {}).
        map(source => manifest.archives[source].start_date).
        concat([manifest.start_date]).
        reduce((result, date) => date < result ? date : result, '9999-99-99');
    this.latestDate = manifest.last_update_time.substring(0, 10);

    this.initializeLineNameMap_(manifest);
  }

  initializeLineNameMap_(manifest) {
    this.lineNameMap_ = {};
    let existingLines = {};
    manifest.sources.forEach(source => {
      this.lineNameMap_[source] = {};
      if (manifest.lines[source]) {
        manifest.lines[source].forEach(lineName => {
          if (lineName != '__+BEGIN_LINES+__' && lineName != '__+END_LINES+__' && existingLines[lineName]) {
            let i;
            for (i = 2; existingLines[lineName + '_' + i]; ++i);
            existingLines[lineName + '_' + i] = true;
            this.lineNameMap_[source][lineName] = lineName + '_' + i;
          } else {
            existingLines[lineName] = true;
          }
        });
      }
    });
  }

  appendLineDataToLoad_(dataToLoad, month, sourceOrSources) {
    if (typeof sourceOrSources == 'string')
      sourceOrSources = [sourceOrSources];
    else if (sourceOrSources == undefined) {
      sourceOrSources = this.manifest.sources;
    }
    Array.prototype.push.apply(dataToLoad,
        sourceOrSources.filter(source => !this.loadedLineData_[month] || !this.loadedLineData_[month][source]).map(source => {
          if (month == 'current')
            return {month: month, source: source, sizeHint: this.manifest.size_hints[source]};
          else if (this.manifest.archives[source] && this.manifest.archives[source].lengths)
            return {month: month, source: source, lengthTotal: this.manifest.archives[source].lengths[month], lengthAccurate: true};
          else
            return {month: month, source: source};
        }));
    return dataToLoad;
  }

  isRangeOverlapped_(start1, end1, start2, end2) {
    return start1 <= end2 && end1 >= start2;
  }

  getDataToLoad_(startDate, endDate) {
    let dataToLoad = [];
    if (this.isRangeOverlapped_(startDate, endDate, this.manifest.start_date, this.latestDate)) {
      this.appendLineDataToLoad_(dataToLoad, 'current');
    }

    if (startDate < this.manifest.start_date) { // [-inf, manifest.start_date) and [startDate, endDate] have intersection
      if (startDate < this.earliestDate)
        startDate = this.earliestDate;
      if (endDate >= this.manifest.start_date)
        endDate = DateUtils.yesterday(this.manifest.start_date);

      if (startDate <= endDate) {
        let archivedSources = Object.keys(this.manifest.archives || {}).map(source => {
          let result = Object.assign({}, this.manifest.archives[source], {name: source});
          result.start_month = DateUtils.toYearMonth(result.start_date);
          result.end_month = DateUtils.toYearMonth(result.end_date);
          return result;
        }).filter(source => this.isRangeOverlapped_(startDate, endDate, source.start_date, source.end_date));
        for (let currentMonth = DateUtils.toYearMonth(startDate);
            currentMonth <= DateUtils.toYearMonth(endDate);
            currentMonth = DateUtils.nextMonth(currentMonth)) {
          this.appendLineDataToLoad_(dataToLoad, currentMonth,
              archivedSources.filter(source => currentMonth >= source.start_month && currentMonth <= source.end_month).
              map(source => source.name));
        }
      }
    }

    return dataToLoad;
  }

  async load(startDate, endDate) {
    let dataToLoad = this.getDataToLoad_(startDate, endDate);
    
    for (let item of dataToLoad) {
      let path;
      let length = item.lengthTotal || 0;
      let lengthAccurate = true;
      let fileName = item.month.replace('-', '') + '.json';
      if (item.month == 'current') {
        path = this.manifest.data[item.source];
      } else {
        path = this.manifest.archives[item.source].path + fileName;
      }
      await fetch(path).then(async response => {
        if (window.TextDecoder && response.body && response.body.getReader) {
          if (!length) {
            let contentEncoding = response.headers.get('Content-Encoding');
            let contentLength = response.headers.get('Content-Length');
            if ((!contentEncoding || contentEncoding == 'identity') && contentLength) {
              length = contentLength;
            } else if (contentEncoding == 'gzip' && contentLength) {
              length = contentLength / (this.manifest.gzip_ratio_hint || 0.5);
              lengthAccurate = false;
            }
          }

          if (length) {
            item.lengthTotal = length;
            item.lengthAccurate = lengthAccurate;
            item.lengthLoaded = 0;
            let reader = response.body.getReader();
            let done = false;
            let decoder = new TextDecoder();
            let json = '';
            while (!done) {
              await reader.read().then(result => {
                if (result.done) {
                  done = true;
                }
                if (result.value) {
                  json += decoder.decode(result.value, {stream: result.done});
                  item.lengthLoaded += result.value.length;
                  this.onUpdateProgress && this.onUpdateProgress(dataToLoad, item);
                }
              });
            }
            return JSON.parse(json);
          }
        }

        return response.json();
      }).then(data => {
        if (!this.loadedLineData_[item.month])
          this.loadedLineData_[item.month] = {};
        this.loadedLineData_[item.month][item.source] = data;
        this.importData_(item.month, item.source);
        item.loaded = true;
        this.onUpdateProgress && this.onUpdateProgress(dataToLoad, item);
      }).catch(_ => item.loaded = false, Promise.resolve());
    }

    return dataToLoad;
  }

  importData_(month, source) {
    let data = this.loadedLineData_[month][source];
    Object.keys(data).forEach(line => {
      let lineName = this.lineNameMap_[source][line] || line;
      if (!this.lineData_[lineName])
        this.lineData_[lineName] = {};
      this.lineData_[lineName][month] = data[line];
    });
  }

  isDataLoaded(startDate, endDate) {
    return this.getDataToLoad_(startDate, endDate).length == 0;
  }

  getMonthsByRange_(startDate, endDate) {
    return Object.keys(this.loadedLineData_).filter(month => {
      if (month == 'current') {
        return this.isRangeOverlapped_(startDate, endDate, this.manifest.start_date, this.latestDate);
      } else {
        return DateUtils.toYearMonth(startDate) <= month && DateUtils.toYearMonth(endDate) >= month;
      }
    });
  }

  queryLines(lineOrLines, startDate, endDate) {
    if (typeof lineOrLines == 'string') {
      lineOrLines = [lineOrLines];
    }

    let allBusesMap = {};
    let lineDetailsMap = {};

    lineOrLines.forEach((line, lineIndex) => {
      this.getMonthsByRange_(startDate, endDate).sort().forEach(month => { // Note: 'current' is always sorted after yyyy-mm.
        let currentLineData = this.lineData_[line][month];
        if (!currentLineData)
          return;
        currentLineData.buses.forEach(bus => {
          if (!allBusesMap[bus.licenseId]) {
            allBusesMap[bus.licenseId] = Object.assign({}, bus);
          } else if(allBusesMap[bus.licenseId].busId != bus.busId) {
            allBusesMap[bus.licenseId].busId = bus.busId;
          }
        });

        currentLineData.details.filter(day => day[0] >= startDate && day[0] <= endDate).forEach(day => {
          if (!lineDetailsMap[day[0]]) {
            lineDetailsMap[day[0]] = {};
          }
          for (let i = 0; i < currentLineData.buses.length; ++i) {
            let licenseId = currentLineData.buses[i].licenseId;
            if (!lineDetailsMap[day[0]][licenseId])
              lineDetailsMap[day[0]][licenseId] = new Array(lineOrLines.length).fill(0);
            let currentWeight = day[1][i];
            lineDetailsMap[day[0]][licenseId][lineIndex] = currentWeight;
            if (currentWeight > 0) {
              allBusesMap[licenseId]['hasWeight'] = true;
            }
          }
        });
      });
    });

    let buses = this.sortBuses_(Object.keys(allBusesMap).filter(licenseId => allBusesMap[licenseId]['hasWeight']).map(licenseId => allBusesMap[licenseId]));

    let allZeroes = new Array(lineOrLines.length).fill(0);
    let details = Object.keys(lineDetailsMap).sort().map(date => [date, buses.map(bus => lineDetailsMap[date][bus.licenseId] || allZeroes)]);

    return {buses: buses, details: details};
  }

  containsLines(lineOrLines) {
    if (typeof lineOrLines == 'string')
      lineOrLines = [lineOrLines];
    return !lineOrLines.some(line => !this.lineData_[line]);
  }

  // query = {busId: [...], licenseId: [...], lines: [...]}
  // where |busId| and |licenseId| can contain:
  // * '1-1001' / '3G317'
  // * {start: '1-1001', end: '1-1008'}
  // * {prefix: '1-29'}
  // * {suffix: '*D'}
  //
  // Returns
  // {lines: [...], buses: [...], details: [...]}
  // where |buses| and |details| will be returned if returnDetails is true.
  queryBuses(query, startDate, endDate, returnDetails) {
    let linesSet = new Set();
    let allBusesMap = {};
    let busDetailsMap = {}; // busDetailsMap[date][licenseId][line] = weight

    (query.lines || Object.keys(this.lineData_)).forEach(line => {
      this.getMonthsByRange_(startDate, endDate).sort().forEach(month => {
        let currentLineData = this.lineData_[line][month];
        let currentLineDetails = null;
        if (!currentLineData)
          return;

        currentLineData.buses.forEach((bus, busIndex) => {
          if (this.compareBus_(bus, query)) {
            if (!allBusesMap[bus.licenseId]) {
              allBusesMap[bus.licenseId] = Object.assign({}, bus);
            } else if(allBusesMap[bus.licenseId].busId != bus.busId) {
              allBusesMap[bus.licenseId].busId = bus.busId;
            }

            if (!currentLineDetails)
              currentLineDetails = currentLineData.details.filter(day => day[0] >= startDate && day[0] <= endDate);
            for (let day of currentLineDetails) {
              if (!busDetailsMap[day[0]]) {
                busDetailsMap[day[0]] = {};
              }

              let weight = day[1][busIndex];
              if (weight > 0) {
                if (!busDetailsMap[day[0]][bus.licenseId]) {
                  busDetailsMap[day[0]][bus.licenseId] = {};
                }
                busDetailsMap[day[0]][bus.licenseId][line] = weight;

                linesSet.add(line);
                if (!returnDetails)
                  break;
              }
            }
          }
        });
      });
    });

    let lines = this.sortLines_(Array.from(linesSet));
    if (!returnDetails)
      return {lines: lines};

    let buses = this.sortBuses_(Object.keys(allBusesMap).map(licenseId => allBusesMap[licenseId]));
    let details = Object.keys(busDetailsMap).sort().map(date =>
        [date, buses.map(bus => lines.map(line => (busDetailsMap[date][bus.licenseId] || {})[line] || 0))]);
    return {lines: lines, buses: buses, details: details};
  }

  getLineFullName(line) {
    if (this.lineData_[line])
      return line;
    // When the string does not contain '_', indexOf returns -1, and substring treats it as 0, returning an empty string and would not match.
    return Object.keys(this.lineData_).find(cur => cur.substring(0, cur.indexOf('_')) == line);
  }

  // TODO: Consider consolidate this function with queryBuses.
  queryCurrentBus(line, licenseId) {
    let lineData = this.lineData_[this.getLineFullName(line)];
    if (lineData)
      return lineData['current'].buses.find(bus => bus.licenseId == licenseId);
  }

  compareBus_(bus, query) {
    let result = false;
    ['busId', 'licenseId'].forEach(queryKey => {
      if (query[queryKey]) {
        result |= query[queryKey].some(queryDetails => {
          if (typeof queryDetails == 'string') {
            return bus[queryKey] == queryDetails;
          } else if (queryDetails.start && queryDetails.end) {
            return bus[queryKey] >= queryDetails.start && bus[queryKey] <= queryDetails.end;
          } else if (queryDetails.prefix) {
            return bus[queryKey].substr(0, queryDetails.prefix.length) == queryDetails.prefix;
          } else if (queryDetails.suffix) {
            return bus[queryKey].substr(-queryDetails.suffix.length) == queryDetails.suffix;
          }
        });
      }
    });
    return result;
  }

  getLines() {
    return this.sortLines_(Object.keys(this.lineData_));
  }

  sortLines_(lines) {
    return lines.sort((a, b) => {
      const pureNumberRegEx = /^[0-9]+$/;
      const lineNameParserRegEx = /^([A-Z]*)([0-9]*)([A-Z]*)(?:_([0-9]+))?$/;

      if (this.manifest.line_name_map) {
        if (this.manifest.line_name_map[a])
          a = this.manifest.line_name_map[a];
        if (this.manifest.line_name_map[b])
          b = this.manifest.line_name_map[b];
      }

      if (pureNumberRegEx.test(a) && pureNumberRegEx.test(b))
        return this.compareNumbers_(a, b);

      a = {full: a};
      b = {full: b};
      [a, b].forEach(x => {
        let match = lineNameParserRegEx.exec(x.full);
        if (match && match[0]) {
          if (match[1])
            x.prefixAlpha = match[1];
          if (match[2])
            x.numberPart = match[2];
          if (match[3])
            x.suffixAlpha = match[3];
          if (match[4])
            x.copyNumber = match[4];
        } else
          x.other = true;
      });

      let result = this.compareWithoutCopyNumber_(a, b);
      return result == 0 ?  this.compareNumbers_(a.copyNumber || -1, b.copyNumber || -1, 'natural') : result;
        // TODO: Sort special lines in the appropriate order. For example:
        // 10S < 10N < G1 < K8 < K8Z < Y1 < J1 < N1 < JLJ
    });
  }

  compareWithoutCopyNumber_(a, b) {
    if (a.other && b.other)
      return this.defaultCompare_(a, b);
    if (a.other && !b.other) // |a|(other) > |b|(normal)
      return 1;
    if (!a.other && b.other) // |a|(normal) < |b|(other)
      return -1;

    // Here both a and b can be parsed into three optional parts.
    if (a.prefixAlpha && !b.prefixAlpha) // a(X1) > b(2)
      return 1;
    if (!a.prefixAlpha && b.prefixAlpha) // a(1) < b(X2)
      return -1;

    if (a.numberPart && !b.numberPart) // a(x1n) < b(yy)
      return -1;
    if (!a.numberPart && b.numberPart) // a(xx) > b(y2s)
      return 1;

    if(a.prefixAlpha && b.prefixAlpha && ((!a.numberPart && !b.numberPart) || a.prefixAlpha != b.prefixAlpha))
      return this.defaultCompare_(a.prefixAlpha, b.prefixAlpha);

    // Here neither a nor b could have |prefixAlpha| or they have the same |prefixAlpha|, which can be ignored for further comparison.
    // If neither a nor b have |numberPart|, they must only have |prefixAlpha|, without |suffixAlpha|.
    // As a result, further comparisons compare |numberPart| first, then |suffixAlpha| if |numberPart| are the same.

    let result = this.compareNumbers_(a.numberPart, b.numberPart);

    if (result == 0) {
      let definedOrder = [undefined].concat(this.manifest.line_name_suffix_order || []);
      [a.suffixAlpha, b.suffixAlpha].sort().forEach(x => !definedOrder.includes(x) && definedOrder.push(x));
      return this.defaultCompare_(definedOrder.indexOf(a.suffixAlpha), definedOrder.indexOf(b.suffixAlpha));
    }

    return result;
  }

  compareNumbers_(a, b, sortOrder) {
    let plainSort = (sortOrder || this.linesSortOrder) == 'plain';
    if (plainSort && (!typeof a == 'number' || !typeof b == 'number')) {
      // 'plain' sorts by strings.
      a = a.toString();
      b = b.toString();
    } else if (!plainSort && (typeof a == 'string' || typeof b == 'string')) {
      // 'natural' sorts by numbers.
      a = parseInt(a);
      b = parseInt(b);
    }
    return this.defaultCompare_(a, b);
  }

  defaultCompare_(a, b) {
    if (a < b)
      return -1;
    else if (a > b)
      return 1;
    else
      return 0;
  }

  sortBuses_(buses) {
    return buses.sort((a, b) => {
      if (a.busId && b.busId) { // Buses with busId are sorted by busId.
        if (a.busId < b.busId)
          return -1;
        else if (a.busId > b.busId)
          return 1;
        else
          return 0;
      } else if (a.busId && !b.busId) // a < b, buses without busId is placed after all other buses with busId.
        return -1;
      else if (!a.busId && b.busId) // a > b, the same as above.
        return 1;
      else { // Buses without busId are sorted by licenseId.
        if (a.licenseId < b.licenseId)
          return -1;
        else if (a.licenseId > b.licenseId)
          return 1;
        return 0;
      }
    });
  }
}


const COLOR = [0x5f, 0x8c, 0xb5];
const COLOR_GREY = [160, 160, 160];
const PALETTE = [
  [230, 25, 75],
  [60, 180, 75],
  [255, 225, 25],
  [0, 130, 200],
  [245, 130, 48],
  [145, 30, 180],
  [70, 240, 240],
  [240, 50, 230],
  [210, 245, 60],
  [250, 190, 190],
  [0, 128, 128],
  [170, 110, 40],
  [128, 0, 0],
  [170, 255, 195],
  [128, 128, 0],
  [0, 0, 128],
];
const NBSP = '\u00a0';
const DEFAULT_DATE_RANGE = 30;
let manifest = null;
let lineDataManager = null;
let settings = new Settings('buses');
let currentStartDate;
let currentEndDate;
let progressText = '';
let activeLines = [];

function positionPopup(element, baseX, baseY, marginX, marginY, addScrollOffset) {
  if (!marginX) {
    marginX = 0;
  }
  if (!marginY && marginY !== 0) {
    marginY = marginX;
  }

  let width = element.offsetWidth || element.clientWidth;
  let height = element.offsetHeight || element.clientHeight;
  let x = Math.min(baseX, window.innerWidth && width ? window.innerWidth - width - marginX : baseX);
  let y = Math.min(baseY, window.innerHeight && height ? window.innerHeight - height - marginY : baseY);
  if (addScrollOffset) {
    x += document.body.scrollLeft + document.documentElement.scrollLeft;
    y += document.body.scrollTop + document.documentElement.scrollTop;
  }

  element.style.left = x.toString() + 'px';
  element.style.top =  y.toString() + 'px';
}

function loadManifest() {
  let fetchSupportsReadableStream = false;
  let offline_prompt = document.getElementById('offline_prompt')

  return fetch('manifest.json').then(response=> {
    if (window.TextDecoder && response.body && response.body.getReader) {
      fetchSupportsReadableStream = true;
    }
    if (response.headers.get('X-Service-Worker-Fallback')) {
      offline_prompt.style.display = '';
    }
    return response.json();
  }).then(manifest_ => {
    manifest = manifest_;
    lineDataManager = new LineDataManager(manifest, fetchSupportsReadableStream);
    document.getElementById('last_update_container').style.display = '';
    appendChildren('last_update_time', manifest.last_update_time);
  }).catch(error => {
    offline_prompt.style.display = '';
    replaceChildren(offline_prompt, '数据加载失败，请检查您的网络状态。');
    return Promise.reject(error);
  });
}

function loadBusUpdates() {
  let updates_div = document.getElementById('updates');
  if (updates_div.children.length > 0)
    return Promise.resolve();
  return fetch('newbuses.csv').then(r => r.text()).then(csv => {
    let updates = csv.split(/\r\n|\r|\n/).filter(line => !line.match(/^\s*$/)).map(line => {
      let values = line.split(',');
      return {update_time: values[0], line: values[1], licenseId: values[2]};
    }).reverse();
    updates.splice(20);
    replaceChildren(updates_div, createElement('table', [
      createElement('thead', createElement('tr', ['时间', '线路', '自编号', '车牌号'].map(x => createElement('th', x)))),
      createElement('tbody', 
        updates.map(item => {
          let lineName = convertLineName(item.line, manifest);
          let match = lineName.match(/（|\(/);
          if (match) {
            lineName = [
              createElement('span', lineName.substring(0, match.index)),
              createElement('span', lineName.substring(match.index), {className: 'a_small_note'}),
            ];
          }
          // TODO: Consolidate line name collapsing code with those for |lineChooser|.
          let hrefLineName = ([].find.call(document.getElementById('lineChooser').children,
              option => option.value.split('+').includes(item.line)) || {}).value ||
              lineDataManager.getLineFullName(item.line);
          return createElement('tr', [
            createElement('td', item.update_time.substring(5)), 
            createElement('td', createElement('a', lineName, {href: '#' + hrefLineName})),
            createElement('td', (lineDataManager.queryCurrentBus(item.line, item.licenseId) || {}).busId || ''),
            createElement('td', item.licenseId),
          ]);
        })
      ),
    ]));
  });
}

function isBusIdContinuous(a, b) {
  if (a.substr(0, 2) != b.substr(0, 2))
    return false;
  var ia = parseInt(a.substr(2));
  var ib = parseInt(b.substr(2));
  if (ia == ib + 1 || ib == ia + 1)
    return true;
  else if (a.substr(0, 2) == '5-' &&
      ((ia % 10 == 3 && ia + 2 == ib) || 
       (ib % 10 == 3 && ib + 2 == ia)))
    return true;
  return false;
}

function convertLineName(line, options) {
  if (options.line_name_map && options.line_name_map[line])
    return convertLineName(options.line_name_map[line], options);
  let match = /^([^0-9]*)([0-9]+)([^0-9_]*)(.*)$/.exec(line);
  if (match) {
    if (match[1] && options.line_name_prefix_map && options.line_name_prefix_map[match[1]]) {
      let prefix = options.line_name_prefix_map[match[1]];
      if (typeof prefix == 'string') {
        match[1] = prefix;
      } else {
        match[1] = prefix[0];
        match[2] += prefix[1];
      }
    }
    if (match[3] && options.line_name_suffix_map && options.line_name_suffix_map[match[3]]) {
      match[3] = '（' + options.line_name_suffix_map[match[3]] + '）';
    }

    return match[1] + match[2] + match[3] + match[4];
  }
  return line;
}

function updateLineChooser(lines, manifest) {
  const REGEX = /^([^0-9]*[0-9]+)([^_]*)(.*)$/;
  let labels = [];
  let values = [];
  let lastMatch = null;
  for (let i = 0; i < lines.length; ++i) {
    let match = REGEX.exec(lines[i]);
    if (lastMatch && match && lastMatch[1] == match[1] && lastMatch[3] == match[3] && !(manifest.unrelated_lines || []).includes(match[1] + match[2])) {
      labels[labels.length - 1] = convertLineName(match[1] + match[3], manifest);
      values[labels.length - 1] += '+' + lines[i];
    } else {
      labels.push(convertLineName(lines[i], manifest));
      values.push(lines[i]);
    }
    lastMatch = match;
  }
  fillSelect('lineChooser', labels, values);
}

function createTableHeader(allBuses) {
  let allBusesTh = allBuses.map(current => createElement('th', current.busId));

  // Label continous busIds in color.
  let i = 0;
  let inRange = false;
  let elementClass = '';
  for (let odd = false; i < allBuses.length; ++i) {
    elementClass = odd ? 'busid_odd_range_element' : 'busid_even_range_element';
    if (i > 0 && isBusIdContinuous(allBuses[i - 1].busId, allBuses[i].busId)) {
      if (inRange) { // The same range continues.
        allBusesTh[i - 1].className = elementClass;
      } else { // A new range begins.
        allBusesTh[i - 1].className = 'busid_range_begin ' + elementClass;
        inRange = true;
      }
    } else {
      if (inRange) { // The previous td is the end of the range.
        inRange = false;
        allBusesTh[i - 1].className = 'busid_range_end ' + elementClass;
        odd = !odd;
      }
    }
  }
  if (inRange) { // Mark the end of the last range.
    allBusesTh[i - 1].className = 'busid_range_end ' + elementClass;
  }

  return createElement('thead', [
    createElement('tr', [
      createElement('th', '自编号'),
      ...allBusesTh,
    ]),
    createElement('tr', ['车牌号'].concat(allBuses.map(bus => bus.licenseId)).map(item => createElement('th', item))),
  ]);
}

function convertBusQuery(queryInput) {
  const rangeSeparatorRegExStr = '(?:~|～)';
  const busIdRegExStr = '([0-9])(?:0|-)([0-9]{4})';
  const licenseIdRegExStr = '(?:苏\\s*E[^0-9A-Z]{0,4})?([0-9A-Z]{5}|[0-9]{5}(?:D|F))';
  const busIdRegEx = new RegExp('^' + busIdRegExStr + '$');
  const busIdRangeRegEx = new RegExp('^' + busIdRegExStr + rangeSeparatorRegExStr + busIdRegExStr + '$');
  const licenseIdRegEx = new RegExp('^' + licenseIdRegExStr + '$', 'i');
  const licenseIdRangeRegEx = new RegExp('^' + licenseIdRegExStr + rangeSeparatorRegExStr + licenseIdRegExStr + '$', 'i');
  const prefixRegEx = /^([^~～*?#]+)(?:\*|\?|#){1,3}$/;

  let query = {busId: [], licenseId: []};
  let conditions = queryInput.split(/,|;|，|；|、|\s+/);
  conditions.forEach(condition => {
    let match = null;
    if (match = busIdRangeRegEx.exec(condition))
        query.busId.push({start: match[1] + '-' + match[2], end: match[3] + '-' + match[4]});
    else if (match = licenseIdRangeRegEx.exec(condition))
        query.licenseId.push({start: match[1].toUpperCase(), end: match[2].toUpperCase()});
    else if (match = prefixRegEx.exec(condition)) {
      if (match[1].includes('-'))
        query.busId.push({prefix: match[1]});
      else
        query.licenseId.push({prefix: match[1].toUpperCase()});
    } else if (match = busIdRegEx.exec(condition))
      query.busId.push(match[1] + '-' + match[2]);
    else if (match = licenseIdRegEx.exec(condition))
      query.licenseId.push(match[1].toUpperCase());
    else if (condition[0] == '*')
      query.licenseId.push({suffix: condition.substr(1)});
    // TODO: Is error handling necessary?
  });

  return query;
}

function findBusByQuery(query) {
  let busCountContainer = document.getElementById('bus_count_container');
  let busCount = document.getElementById('bus_count');
  let result = lineDataManager.queryBuses(convertBusQuery(query), currentStartDate, currentEndDate, true);
  fillSelect(document.getElementById('resultList'), result.lines);
  if (result.lines.length > 0) {
    busCount.innerText = result.buses.length;
    busCountContainer.style.display = '';
  } else {
    busCountContainer.style.display = 'none';
  }
}

function showLinesNew(lineOrLines, lineData, showLineNames) {
  if (typeof lineOrLines == 'string')
    lineOrLines = [lineOrLines];

  if (lineOrLines.length > PALETTE.length && !showLineNames) {
    replaceChildren('content', '您选择的线路太多了！');
    return;
  }
  if (!lineData && !lineDataManager.containsLines(lineOrLines)) {
    replaceChildren('content', '某些线路不存在！');
    return;
  }

  removeChildren('legend');
  if (lineOrLines.length > 1) {
    appendChildren('legend', lineOrLines.map((line, index) => createElement('span', [
      createElement('span', null, {style: {
        backgroundColor: 'rgb(' + PALETTE[index % PALETTE.length].join(',') + ')',
        height: '1em',
        width: '2em',
        display: 'inline-block',
        marginLeft: '3em',
      }}),
      ' ' + convertLineName(line, manifest),
    ])));
  }

  let data = lineData || lineDataManager.queryLines(lineOrLines, currentStartDate, currentEndDate);

  replaceChildren('content', createElement('table', [
    createTableHeader(data.buses),
    createElement('tbody', data.details.map(day => createElement('tr', [
      createElement('th', day[0]),
      ...data.buses.map((bus, busIndex) => {
        let activeCount = day[1][busIndex].filter(weight => weight > 0).length;
        if (activeCount == 0) {
          return createElement('td', showLineNames ? [
            createElement('span', NBSP, {
              className: 'line_view_bus_item',
              style: {
                width: '100%',
                backgroundColor: 'rgb(' + COLOR_GREY.join(',') + ')',
              }
            })
          ] : null);
        }

        let td = createElement('td');
        let first = true;
        day[1][busIndex].forEach((weight, lineIndex) => {
          if (weight > 0) {
            let text = lineOrLines[lineIndex];
            if (first) {
              first = false;
            } else {
              text = '/' + text;
            }
            td.appendChild(createElement('span', showLineNames ? text : NBSP, {
              className: 'line_view_bus_item',
              style: Object.assign({
                width: 100 / activeCount + '%',
                backgroundColor: showLineNames ? 'rgb(' + COLOR_GREY.map(value => parseInt((255 - value) * weight + value)).join(',') + ')' :
                    'rgb(' + (lineOrLines.length == 1 ? COLOR : PALETTE[lineIndex]).map(value =>
                        parseInt((255 - value) * (1 - weight) + value)).join(',') + ')'
              }, showLineNames ? {
                color: 'rgb(' + (PALETTE[lineIndex % PALETTE.length]),
                fontWeight: 'bold',
              } : null),
              'data-line': lineOrLines[lineIndex],
            }));
          }
        });
        return td;
      })
    ]))),
  ]));
}

function onChooseLine() {
  let newLines = this.value.split('+');
  let needUpdate = false;
  if (document.getElementById('compare').checked) {
    newLines.forEach(line => !activeLines.includes(line) && (activeLines.push(line), needUpdate = true));
  } else {
    activeLines = newLines;
    needUpdate = true;
  }
  if (needUpdate) {
    showLinesNew(activeLines);
    history.pushState(activeLines.length == 1 ? activeLines[0] : activeLines, '', '#' + activeLines.join('+'));
  }
}

function parseUrlHash() {
  if (location.hash.replace('#', '')) {
    var hashValue = location.hash.replace('#', '');
    activeLines = hashValue.split('+');
    lineChooser.value = hashValue;
    if (lineDataManager && currentStartDate)
      showLinesNew(activeLines);
    return true;
  }
}

function onModifyDate() {
  if (!lineDataManager)
    return;
  let startDate = document.getElementById('startDate');
  let endDate = document.getElementById('endDate');

  if (startDate.value < lineDataManager.earliestDate)
    startDate.value = lineDataManager.earliestDate;
  if (endDate.value > lineDataManager.latestDate)
    endDate.value = lineDataManager.latestDate;
  if ( currentStartDate != startDate.value || currentEndDate != endDate.value) {
    currentStartDate = startDate.value;
    currentEndDate = endDate.value;
    if (lineDataManager.isDataLoaded(currentStartDate, currentEndDate)) {
      showLinesNew(activeLines);
    } else {
      let progress = document.getElementById('progress');
      document.getElementById('progressbar').style.width = 0;
      document.getElementById('progress_text').innerText = progressText;
      progress.style.display = '';
      lineDataManager.load(currentStartDate, currentEndDate).then(_ => {
        progress.style.display = 'none';
        updateLineChooser(lineDataManager.getLines(), lineDataManager.manifest);
        showLinesNew(activeLines);
      });
    }
  } else {
    startDate.value = currentStartDate;
    endDate.value = currentEndDate;
  }
}

function navigateLine(increment, repeat) {
  let lineChooser = document.getElementById('lineChooser');
  let newIndex = Math.max(0, lineChooser.selectedIndex + increment);
  if (lineChooser.children.length > 0 && newIndex > lineChooser.children.length - 1)
    newIndex = lineChooser.children.length - 1;
  lineChooser.selectedIndex = newIndex;
  if (!repeat)
    onChooseLine.call(lineChooser);
}

function init() {
  let lineChooser = document.getElementById('lineChooser');

  loadManifest().then(_ => {
    let startDate = document.getElementById('startDate');
    let endDate = document.getElementById('endDate');
    currentEndDate = lineDataManager.latestDate;
    let date = new Date(currentEndDate);
    date.setDate(date.getDate() - DEFAULT_DATE_RANGE + 1);
    currentStartDate = date.toISOString().substring(0, 10);
    startDate.value = currentStartDate;
    endDate.value = currentEndDate;
    startDate.addEventListener('change', onModifyDate);
    endDate.addEventListener('change', onModifyDate);

    progressText = document.getElementById('progress_text').innerText;

    lineDataManager.onUpdateProgress = function(items, progressedItem) {
      let progressbar = document.getElementById('progressbar');
      let sizeHintItems = items.filter(item => item.sizeHint);
      let sizeHintTotal = sizeHintItems.reduce((result, item) => result += item.sizeHint, 0);
      let progressValue1 = sizeHintItems.reduce((result, item) => {
        let weight = item.sizeHint / sizeHintTotal;
        if (item.loaded) {
          result += weight;
        } else if (item.lengthLoaded && item.lengthTotal) {
          if (item.lengthAccurate) {
            result += weight * item.lengthLoaded / item.lengthTotal;
          } else {
            result += weight * Math.min(item.lengthLoaded, item.lengthTotal * 0.95) / item.lengthTotal;
          }
        }
        return result;
      }, 0);
      let knownLengthItems = items.filter(item => item.lengthAccurate && !item.sizeHint);
      let knownLengthTotal = knownLengthItems.reduce((result, item) => result + item.lengthTotal, 0);
      let progressValue2 = knownLengthItems.reduce((result, item) => {
        let weight = item.lengthTotal / knownLengthTotal;
        if (item.loaded) {
          result += weight;
        } else if (item.lengthLoaded) {
          result += weight * item.lengthLoaded / item.lengthTotal;
        }
        return result;
      }, 0);
      let progressValue = 100 * (progressValue1 * sizeHintItems.length / items.length +
          progressValue2 * knownLengthItems.length / items.length);
      progressbar.style.width = progressValue + '%';
      document.getElementById('progress_text').innerText = progressText + Math.round(progressValue) + '%';
    }

    lineDataManager.load(currentStartDate, currentEndDate).then(_ => {
      document.getElementById('progress').style.display = 'none';
      updateLineChooser(lineDataManager.getLines(), lineDataManager.manifest);
      if (!parseUrlHash()) {
        activeLines = [lineChooser.children[0].value];
        showLinesNew(activeLines);
      }
    });
  });

  lineChooser.addEventListener('change', onChooseLine);
  document.getElementById('resultList').addEventListener('change', onChooseLine);
  window.onpopstate = function(e) {
    if (e.state instanceof Array) {
      activeLines = e.state;
      showLinesNew(activeLines);
    } else if(e.state) {
      activeLines = [e.state];
      showLinesNew(e.state);
    } else {
      parseUrlHash();
    }
  };
  document.getElementById('bus_query').addEventListener('input', function() {
    if (!lineDataManager || !currentStartDate)
      return;
    findBusByQuery(this.value);
  });
  document.getElementById('findDetails').addEventListener('click', function() {
    if (!lineDataManager || !currentStartDate)
      return;
    let result = lineDataManager.queryBuses(Object.assign({lines: [].map.call(document.getElementById('resultList').children, option => option.value)},
        convertBusQuery(document.getElementById('bus_query').value)), currentStartDate, currentEndDate, true);
    showLinesNew(result.lines, result, true);
  });

  function updateCellDetails(element, x, y) {
    var div = document.getElementById('cellDetails');
    if (div.style.display == 'none')
      return;

    var lineContainer = document.getElementById('cellLineContainer');
    var td = element;
    if (td.tagName.toLowerCase() == 'span') {
      td = td.parentElement;
      lineContainer.style.display = '';
      document.getElementById('cellLine').innerText = element.getAttribute('data-line');
    } else {
      lineContainer.style.display = 'none';
    }
    document.getElementById('cellDate').innerText = td.parentElement.children[0].innerText;
    var thead = document.getElementById('content').querySelector('table thead');
    document.getElementById('cellBusId').innerText = thead.children[0].children[td.cellIndex].innerText;
    document.getElementById('cellLicenseId').innerText = thead.children[1].children[td.cellIndex].innerText;
    positionPopup(div, x + 8, y + 8, 30, 30, true);
  }

  function toggleCellDetails() {
    var div = document.getElementById('cellDetails');
    div.style.display =
        (div.style.display == 'none' && !document.getElementById('disableInfotip').checked) ?
        '' : 'none';
  }

  document.getElementById('content').addEventListener('click', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if (tagName == 'span' || tagName == 'td') {
      toggleCellDetails();
      updateCellDetails(e.target, e.clientX, e.clientY);
    }
  });
  var touchStarted = false;
  var timer = null;
  document.getElementById('content').addEventListener('touchstart', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if ((tagName == 'span' || tagName == 'td') && e.touches.length == 1) {
      if (!touchStarted) {
        touchStarted = true;
        timer = window.setTimeout(function() {
          if (touchStarted) {
            toggleCellDetails();
            updateCellDetails(e.target, e.touches[0].clientX, e.touches[0].clientY);
            touchStarted = false;
            timer = null;
          }
        }, 1500);
      }
    }
  });
  document.getElementById('content').addEventListener('touchmove', function() {
    if (touchStarted) {
      touchStarted = false;
      window.clearTimeout(timer);
      timer = null;
    }
  });
  document.getElementById('content').addEventListener('touchend', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if (tagName == 'span' || tagName == 'td' && e.touches.length == 1 && touchStarted) {
      e.preventDefault();
      updateCellDetails(e.target, e.touches[0].clientX, e.touches[0].clientY);
      touchStarted = false;
      window.clearTimeout(timer);
      timer = null;
    }
  });
  document.getElementById('content').addEventListener('mouseover', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if (tagName == 'span' || tagName == 'td') {
      updateCellDetails(e.target, e.clientX, e.clientY);
    }
  });

  document.getElementById('last_update_time').addEventListener('click', function() {
    loadBusUpdates().then(_ => {
      let updates_div = document.getElementById('updates');
      let last_update_container = document.getElementById('last_update_container');
      if (updates_div.style.display == 'none') {
        updates_div.style.display = '';
        positionPopup(updates_div, last_update_container.offsetLeft, last_update_container.offsetTop + last_update_container.offsetHeight + 8, 30);
      } else {
        updates_div.style.display = 'none';
      }
    });
  });

  let keyRepeatPending = false;
  document.addEventListener('keydown', function(e) {
    if (!e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey)
      return;
    if ((e.key == 'ArrowUp' || e.keyCode == 38) && lineChooser.selectedIndex > 0) {
      navigateLine(-1, e.repeat);
      keyRepeatPending = e.repeat;
      e.preventDefault();
    } else if ((e.key == 'ArrowDown' || e.keyCode == 40) && lineChooser.selectedIndex < lineChooser.children.length - 1) {
      navigateLine(+1, e.repeat);
      keyRepeatPending = e.repeat;
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', function(e) {
    if (keyRepeatPending) {
      keyRepeatPending = false;
      navigateLine(0, false);
    }
  });

  return settings.initPromise.then(_ => {
    let disableInfotip = document.getElementById('disableInfotip');

    disableInfotip.addEventListener('change', () => {
      settings.set({disableInfotip: disableInfotip.checked});
    });

    return settings.get({disableInfotip: false}).then(items => {
      disableInfotip.checked = !!items.disableInfotip;
    });
  });
}

(function() {
  let initialized = false;
  function initOnce() {
    if (!initialized) {
      init();
      initialized = true;
    }
  }
  document.onload = initOnce;
  document.onreadystatechange = function() {
    if (document.readyState == 'complete')
      initOnce();
  };
  document.addEventListener('DOMContentLoaded', initOnce);
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(location.href.substring(0, location.href.lastIndexOf('/')) + '/service_worker.js');
}
