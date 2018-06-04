class DateUtils {
  static formatNumber_(number) {
    let result = number.toString();
    return result.length == 1 ? '0' + result : result;
  }

  static formatDate(y, m, d) {
    let result = y.toString();
    if (m) {
      result += '-' + DateUtils.formatNumber_(m);
    }
    if (d) {
      result +=  '-' + DateUtils.formatNumber_(d);
    }
    return result;
  }

  static toYearMonth(date) {
    let monthIndexMinusOne = date.indexOf('-');
    if (monthIndexMinusOne == -1)
      return date;
    let dayIndexMinusOne = date.indexOf('-', monthIndexMinusOne + 1);
    if (dayIndexMinusOne == -1)
      return date;
    return date.substr(0, dayIndexMinusOne);
  }

  static nextMonth(date) {
    let components = date.split('-').map(x => parseInt(x));
    components[1]++;
    if (components[1] > 12) {
      components[0] += Math.floor(components[1] / 12);
      components[1] %= 12;
    }
    if (components[2] && components[2] > DateUtils.daysInMonthsMap_[components[1]])
      components[2] = DateUtils.daysInMonthsMap_[components[1]];
    return DateUtils.formatDate.apply(null, components);
  }

  static previousMonth(date) {
    let components = date;
    if (typeof date == 'string')
      components = date.split('-').map(x => parseInt(x));
    components[1]--;
    if (components[1] == 0) {
      components[0]--;
      components[1] = 12;
    }
    if (components[2] && components[2] > DateUtils.daysInMonthsMap_[components[1]])
      components[2] = DateUtils.daysInMonth(components[1]);
    return DateUtils.formatDate.apply(null, components);
  }

  static yesterday(date) {
    let components = date.split('-').map(x => parseInt(x));
    components[2]--;
    if (components[2] == 0) {
      let ym = DateUtils.previousMonth(components.slice(0, 2));
      let ymc = ym.split('-').map(x => parseInt(x));
      return ym + '-' + DateUtils.formatNumber_(DateUtils.daysInMonth(ymc[0], ymc[1]));
    }
    return DateUtils.formatDate.apply(null, components);
  }

  static isLeapYear(year) {
    year = parseInt(year);
    return year % 400 == 0 || (year % 100 != 0 && year % 4 == 0);
  }

  static daysInMonth(year, month) {
    month = parseInt(month);
    return month == 2 && DateUtils.isLeapYear(year) ? 29 : DateUtils.daysInMonthsMap_[month];
  }
}

DateUtils.daysInMonthsMap_ = [
  undefined, // 0
  31, // Jan
  28, // Feb (NON LEAP YEAR)
  31, // Mar
  30, // Apr
  31, // May
  30, // Jun
  31, // Jul
  31, // Aug
  30, // Sep
  31, // Oct
  30, // Nov
  31, // Dec
];

class LineDataManager {
  constructor(manifest) {
    this.manifest = manifest;
    this.loadedLineData_ = {};
    this.lineData_ = {};

    let today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    this.today_ = today.toISOString().substr(0, 10);

    this.earliestDate = Object.keys(manifest.archives || {}).
        map(source => manifest.archives[source].start_date).
        concat([manifest.start_date]).
        reduce((result, date) => date < result ? date : result, '9999-99-99');
    // TODO: Use |last_update_time| in the standalane manifest.
    this.latestDate = this.today_;

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
    if (this.isRangeOverlapped_(startDate, endDate, this.manifest.start_date, this.today_)) {
      this.appendLineDataToLoad_(dataToLoad, 'current');
    }

    if (startDate < this.manifest.start_date) { // [-inf, manifest.start_date) and [startDate, endDate] have intersection
      if (startDate < this.earliestDate)
        startDate = this.earliestDate;
      if (endDate >= this.manifest.start_date)
        endDate = DateUtils.yesterday(this.manifest.start_date);

      if (startDate <= endDate) {
        let startMonth = DateUtils.toYearMonth(startDate);
        let endMonth = DateUtils.toYearMonth(endDate);
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
        return this.isRangeOverlapped_(startDate, endDate, this.manifest.start_date, this.today_);
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
    let plainSort = this.linesSortOrder == 'plain';

    return lines.sort((a, b) => {
      let ia = parseInt(a);
      let ib = parseInt(b);
      let defaultComparisonResult;

      if (a < b)
        defaultComparisonResult = -1;
      else if (a > b)
        defaultComparisonResult = 1;
      else
        defaultComparisonResult = 0;

      if (plainSort)
        return defaultComparisonResult;

      if (isNaN(ia) && isNaN(ib)) { // Neither a or b is number.
        // TODO: Sort special lines in the appropriate order. For example:
        // 10S < 10N < G1 < K8 < K8Z < Y1 < J1 < N1 < JLJ
        return defaultComparisonResult;
      } else if (isNaN(ia) && !isNaN(ib)) { // a (NaN) > b (Number).
        return 1;
      } else if (!isNaN(ia) && isNaN(ib)) { // a (Number) < b (NaN).
        return -1;
      } else { // Both a & b are numbers.
        if (ia < ib)
          return -1;
        else if (ia > ib)
          return 1;
        else
          return defaultComparisonResult;
      }
    });
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


const COLOR = [106, 90, 205];
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
let lineDataManager = new LineDataManager(manifest);
let currentStartDate;
let currentEndDate;
let progressText = '';
let activeLines = [];

(function() {
  var today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  currentEndDate = today.toISOString().substr(0, 10);
  var month = today.getMonth();
  today.setDate(today.getDate() - 30 + 1);
  currentStartDate = today.toISOString().substr(0, 10);
})();

function loadRemoteManifest() {
  fetch('manifest.json', {cache: 'no-cache'}).then(r => r.json()).then(manifest => {
    document.getElementById('last_update_container').style.display = '';
    document.getElementById('last_update_time').appendChild(document.createTextNode(manifest.last_update_time));
  }).catch(_ => {
    document.getElementById('offline_prompt').style.display = '';
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

function updateLineChooser(lines) {
  var lineChooser = document.getElementById('lineChooser');
  lines.forEach(line => {
    let option = document.createElement('option');
    option.value = line;
    option.appendChild(document.createTextNode(convertLineName(line, manifest)));
    lineChooser.appendChild(option);
  });
}

function fillTr(data, th, attrs) {
  var tr = document.createElement('tr');
  Array.prototype.forEach.call(data, function(item, index) {
    var td = document.createElement(th ? 'th' : 'td');
    if (attrs && attrs[index])
    for (var x in attrs[index])
      td.setAttribute(x, attrs[index][x]);
    td.appendChild(document.createTextNode(item));
    tr.appendChild(td);
  });
  return tr;
}

function removeChildren(parent) {
  while(parent.hasChildNodes())
    parent.removeChild(parent.childNodes[0]);
}

function createTableHeader(allBuses) {
  var thead = document.createElement('thead');

  var tr = document.createElement('tr');
  var th = document.createElement('th');
  th.appendChild(document.createTextNode('自编号'));
  tr.appendChild(th);
  var previousTd = null;
  var inRange = false;
  var odd = false;
  var elementClass = '';
  for (var i = 0; i < allBuses.length; ++i) {
    var td = document.createElement('th');
    td.appendChild(document.createTextNode(allBuses[i].busId));
    tr.appendChild(td);

    elementClass = odd ? 'busid_odd_range_element' : 'busid_even_range_element';
    if (i > 0 && isBusIdContinuous(allBuses[i - 1].busId, allBuses[i].busId)) {
      if (inRange) { // The same range continues.
        previousTd.className = elementClass;
      } else { // A new range begins.
        previousTd.className = 'busid_range_begin ' + elementClass;
        inRange = true;
      }
    } else {
      if (inRange) { // The previous td is the end of the range.
        inRange = false;
        previousTd.className = 'busid_range_end ' + elementClass;
        odd = !odd;
      }
    }
    previousTd = td;
  }
  if (inRange) {
    previousTd.className = 'busid_range_end ' + elementClass;
  }

  thead.appendChild(tr);

  thead.appendChild(fillTr(['车牌号'].concat(allBuses.map(bus => bus.licenseId)), true));
  return thead;
}

function convertBusQuery(queryInput) {
  const rangeSeparatorRegExStr = '(?:~|～)';
  const busIdRegExStr = '([0-9])(?:0|-)([0-9]{4})';
  const licenseIdRegExStr = '(?:苏\s*E[^0-9A-Z]{0,4})?([0-9A-Z]{5}|[0-9]{5}(?:D|F))';
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
  let resultList = document.getElementById('resultList');
  let busCountContainer = document.getElementById('bus_count_container');
  let busCount = document.getElementById('bus_count');
  removeChildren(resultList);
  let result = lineDataManager.queryBuses(convertBusQuery(query), currentStartDate, currentEndDate, true);
  if (result.lines.length > 0) {
    result.lines.forEach(line => {
      let option = document.createElement('option');
      option.value = line;
      option.appendChild(document.createTextNode(line));
      resultList.appendChild(option);
    });

    busCount.innerText = result.buses.length;
    busCountContainer.style.display = '';
  } else {
    busCountContainer.style.display = 'none';
  }
}

function showLinesNew(lineOrLines, lineData, showLineNames) {
  if (typeof lineOrLines == 'string')
    lineOrLines = [lineOrLines];

  let content = document.getElementById('content');
  let legend = document.getElementById('legend');
  removeChildren(content);
  removeChildren(legend);

  if (lineOrLines.length > PALETTE.length && !showLineNames) {
    content.appendChild(document.createTextNode('您选择的线路太多了！'));
    return;
  }

  if (!lineData && !lineDataManager.containsLines(lineOrLines)) {
    content.appendChild(document.createTextNode('某些线路不存在！'));
    return;
  }

  if (lineOrLines.length > 1) {
    lineOrLines.forEach((line, index) => {
      let item = document.createElement('span');
      let span = document.createElement('span');
      span.style.backgroundColor = 'rgb(' + PALETTE[showLineNames ? index % PALETTE.length : index].join(',') + ')';
      span.style.height = '1em';
      span.style.width = '2em';
      span.style.display = 'inline-block';
      item.style.marginLeft = '3em';
      item.appendChild(span);
      item.appendChild(document.createTextNode(' ' + line));
      legend.appendChild(item);
    });
  }

  let data = lineData || lineDataManager.queryLines(lineOrLines, currentStartDate, currentEndDate);

  let table = document.createElement('table');
  table.appendChild(createTableHeader(data.buses));
  let tbody = document.createElement('tbody');
  data.details.forEach(day => {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.appendChild(document.createTextNode(day[0]));
    tr.appendChild(th);
    data.buses.forEach((bus, busIndex) => {
      var td = document.createElement('td');
      tr.appendChild(td);
      var activeCount = 0;
      activeCount = day[1][busIndex].filter(weight => weight > 0).length;
      if (activeCount == 0) {
        if (showLineNames) {
          var span = document.createElement('span');
          span.className = 'line_view_bus_item';
          span.style.width = '100%';
          span.style.backgroundColor = 'rgb(' + COLOR_GREY.join(',') + ')';
          span.appendChild(document.createTextNode('\u00a0'));
          td.appendChild(span);
        }
        return;
      }

      let first = true;
      day[1][busIndex].forEach((weight, lineIndex) => {
        if (weight > 0) {
          var span = document.createElement('span');
          span.className = 'line_view_bus_item';
          span.style.width = 100 / activeCount + '%';
          span.setAttribute('data-line', lineOrLines[lineIndex]);
          if (showLineNames) {
            span.style.color = 'rgb(' + (PALETTE[lineIndex % PALETTE.length]);
            span.style.fontWeight = 'bold';
            span.style.backgroundColor = 'rgb(' + COLOR_GREY.map(value => parseInt((255 - value) * weight + value)).join(',') + ')';
            let text = lineOrLines[lineIndex];
            if (first) {
              first = false;
            } else {
              text = '/' + text;
            }
            span.appendChild(document.createTextNode(text));
          } else {
            span.style.backgroundColor = 'rgb(' + (lineOrLines.length == 1 ? COLOR : PALETTE[lineIndex]).
                map(value => parseInt((255 - value) * (1 - weight) + value)).join(',') + ')';
            span.appendChild(document.createTextNode('\u00a0'));
          }
          td.appendChild(span);
        }
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  content.appendChild(table);
}

function onChooseLine() {
  if (document.getElementById('compare').checked) {
    if (activeLines.includes(this.value))
      return;
    activeLines.push(this.value);
    history.pushState(activeLines, '', '#' + activeLines.join('+'));
    showLinesNew(activeLines);
  } else {
    var line = this.value;
    activeLines = [line];
    showLinesNew(line);
    history.pushState(line, '', '#' + line);
  }
}

function parseUrlHash() {
  if (location.hash.replace('#', '')) {
    var hashValue = location.hash.replace('#', '');
    if (hashValue.includes('+')) {
      activeLines = hashValue.split('+');
      showLinesNew(activeLines);
    } else {
      activeLines = [hashValue];
      lineChooser.value = hashValue;
      showLinesNew(hashValue);
    }
    return true;
  }
}

function onModifyDate() {
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
        updateLineChooser(lineDataManager.getLines());
        showLinesNew(activeLines);
      });
    }
  } else {
    startDate.value = currentStartDate;
    endDate.value = currentEndDate;
  }
}

function init() {
  let lineChooser = document.getElementById('lineChooser');
  let startDate = document.getElementById('startDate');
  let endDate = document.getElementById('endDate');
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
    let knownLengthTotal = knownLengthItems.reduce((result, item) => result += item.lengthTotal, 0);
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
    updateLineChooser(lineDataManager.getLines());
    if (!parseUrlHash()) {
      activeLines = [lineChooser.children[0].value];
      showLinesNew(activeLines);
    }
    loadRemoteManifest();
  });

  startDate.value = currentStartDate;
  endDate.value = currentEndDate;
  startDate.addEventListener('change', onModifyDate);
  endDate.addEventListener('change', onModifyDate);
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
    findBusByQuery(this.value);
  });
  document.getElementById('findDetails').addEventListener('click', function() {
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
    div.style.left = Math.min(x, window.innerWidth && div.clientWidth ? window.innerWidth - div.clientWidth - 30 : x) + document.body.scrollLeft + document.documentElement.scrollLeft + 8 + 'px';
    div.style.top = Math.min(y, window.innerHeight && div.clientHeight ? window.innerHeight - div.clientHeight - 30 : y) + document.body.scrollTop + document.documentElement.scrollTop + 8 + 'px';
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
  document.getElementById('content').addEventListener('touchmove', function(e) {
    if (touchStarted) {
      touchStarted = false;
      window.clearTimeout(timer);
      timeout = null;
    }
  });
  document.getElementById('content').addEventListener('touchend', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if (tagName == 'span' || tagName == 'td' && e.touches.length == 1 && touchStarted) {
      e.preventDefault();
      updateCellDetails(e.target, e.touches[0].clientX, e.touches[0].clientY);
      touchStarted = false;
      window.clearTimeout(timer);
      timeout = null;
    }
  });
  document.getElementById('content').addEventListener('mouseover', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if (tagName == 'span' || tagName == 'td') {
      updateCellDetails(e.target, e.clientX, e.clientY);
    }
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

/*if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service_worker.js');
} else {
  var iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = 'appcache.html';
  document.body.appendChild(iframe);
}*/
