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
    let components = date.split('-');
    components[1]++;
    if (components[1] > 12) {
      components[0] += components[1] / 12;
      components[1] %= 12;
    }
    if (components[2] && components[2] > DateUtils.daysInMonthsMap_[components[1]])
      components[2] = DateUtils.daysInMonthsMap_[components[1]];
    return DateUtils.formatDate.apply(null, components);
  }

  static previousMonth(date) {
    let components = date;
    if (typeof date == 'string')
      components = date.split('-');
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
    let components = date.split('-');
    components[2]--;
    if (components[2] == 0) {
      let ym = DateUtils.previousMonth(components.slice(0, 2));
      let ymc = ym.split('-');
      return ym + '-' + DateUtils.formatNumber_(DateUtils.daysInMonth(ymc[0], ymc[1]));
    }
  }

  static isLeapYear(year) {
    year = parseInt(year);
    return year % 400 == 0 || (year % 100 != 0 && year % 4 == 0);
  }

  static daysInMonth(year, month) {
    month = parseInt(month);
    return month == 2 && isLeapYear(year) ? 29 : DateUtils.daysInMonthsMap_[month];
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
        sourceOrSources.filter(source => !this.loadedLineData_[month] || !this.loadedLineData_[month][source]).
        map(source => ({month: month, source: source})));
    return dataToLoad;
  }

  isRangeOverlapped_(start1, end1, start2, end2) {
    return start1 <= end2 && end1 >= start2;
  }

  async load(startDate, endDate) {
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
    
    for (let item of dataToLoad) {
      let path;
      if (item.month == 'current') {
        path = this.manifest.data[item.source];
      } else {
        path = this.manifest.archives[item.source].path + item.month.replace('-', '') + '.json';
      }
      await fetch(path).then(x => x.json()).then(data => {
        if (!this.loadedLineData_[item.month])
          this.loadedLineData_[item.month] = {};
        this.loadedLineData_[item.month][item.source] = data;
        this.importData_(item.month, item.source);
        item.loaded = true;
        this.onUpdateProgress && this.onUpdateProgress(dataToLoad, item.month, item.source, 1, 1);
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

  query(lineOrLines, startDate, endDate) {
    if (typeof lineOrLines == 'string') {
      lineOrLines = [lineOrLines];
    }

    let allBusesMap = {};
    let lineDetailsMap = {};

    lineOrLines.forEach((line, lineIndex) => {
      Object.keys(this.lineData_[line]).filter(month => {
        if (month == 'current') {
          return this.isRangeOverlapped_(startDate, endDate, this.manifest.start_date, this.today_);
        } else {
          return DateUtils.toYearMonth(startDate) <= month && DateUtils.toYearMonth(endDate) >= month;
        }
      }).sort().forEach(month => { // Note: 'current' is always sorted after yyyy-mm.
        let currentLineData = this.lineData_[line][month];
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

    let buses = Object.keys(allBusesMap).filter(licenseId => allBusesMap[licenseId]['hasWeight']).sort((licenseA, licenseB) => {
      let a = allBusesMap[licenseA];
      let b = allBusesMap[licenseB];

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
    }).map(licenseId => allBusesMap[licenseId]);

    let allZeroes = new Array(lineOrLines.length).fill(0);
    let details = Object.keys(lineDetailsMap).sort().map(date => [date, buses.map(bus => lineDetailsMap[date][bus.licenseId] || allZeroes)]);

    return {buses: buses, details: details};
  }

  contains(lineOrLines) {
    if (typeof lineOrLines == 'string')
      lineOrLines = [lineOrLines];
    return !lineOrLines.some(line => !this.lineData_[line]);
  }

  getLines(naturalSort) {
    return Object.keys(this.lineData_).sort((a, b) => {
      let ia = parseInt(a);
      let ib = parseInt(b);
      let defaultComparisonResult;

      if (a < b)
        defaultComparisonResult = -1;
      else if (a > b)
        defaultComparisonResult = 1;
      else
        defaultComparisonResult = 0;

      if (!naturalSort)
        return defaultComparisonResult;

      if (isNaN(ia) && isNaN(ib)) { // Neither a or b is number.
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
    })
  }

  isDateRangeValid(start, end) {
    // TODO: Max date should be less than last_update_time in the manifest.
    return start >= this.manifest.start_date && end <= this.today_;
  }
}


const COLOR = [106, 90, 205];
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
  [128, 128, 128],
];
let lineDataManager = new LineDataManager(manifest);
let currentStartDate;
let currentEndDate;
let activeLines = [];

var lineData = {};
var lineNameMap = {};

(function() {
  var today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  currentEndDate = today.toISOString().substr(0, 10);
  var month = today.getMonth();
  today.setMonth(today.getMonth() - 1);
  if (month == today.getMonth())
    today.setDate(0);
  currentStartDate = today.toISOString().substr(0, 10);
})();

function loadData() {
  var existingLines = {};
  manifest.sources.forEach(function(source) {
    lineNameMap[source] = {};
    if (manifest.lines[source]) {
      manifest.lines[source].forEach(function(lineName) {
        if (lineName != '__+BEGIN_LINES+__' && lineName != '__+END_LINES+__' && existingLines[lineName]) {
          var i;
          for (i = 2; existingLines[lineName + '_' + i]; ++i);
          existingLines[lineName + '_' + i] = true;
          lineNameMap[source][lineName] = lineName + '_' + i;
        } else {
          existingLines[lineName] = true;
        }
      });
    }
  });

  var progress = {};
  manifest.sources.forEach(function(source) {
    progress[source] = {total: 0, loaded: 0, weight: 1 / manifest.sources.length};
  });
  if (manifest.size_hints) {
    var remainingWeight = 1;
    var size_hints_total = 0;
    for (var k in manifest.size_hints) {
      if (manifest.size_hints[k])
        size_hints_total += manifest.size_hints[k];
      else
        remainingProgress -= 1 / manifest.sources.length;
    }
    for (var k in manifest.size_hints) {
      if (manifest.size_hints[k]) {
        progress[k].weight = remainingWeight * manifest.size_hints[k] / size_hints_total;
      }
    }
  }

  function updateProgress(source, loaded, total) {
    var originalTotal = progress[source].total;
    progress[source].total = total;
    progress[source].loaded = loaded;

    if (originalTotal != total) {
      var remainingWeight = 1;
      var knownTotal = 0;
      for (var k in progress) {
        if (progress[k].total == 0) {
          remainingWeight -= progress[k].weight;
        } else {
          knownTotal += progress[k].total;
        }
      }
      for (var k in progress) {
        if (progress[k].total != 0) {
          progress[k].weight = remainingWeight * progress[k].total / knownTotal;
        }
      }
    }

    var progressValue = 0;
    for (var k in progress) {
      if (progress[k].total != 0)
        progressValue += progress[k].loaded / progress[k].total * progress[k].weight;
    }

    if (progressValue > 1)
      progressValue = 1;
    if (isNaN(progressValue)) progressValue = 0; // Strange IE bug
    document.getElementById('progressbar').style.width = progressValue * 100 + '%';
    document.getElementById('progressbar').innerText = 'Loading...' + Math.round(progressValue * 100) + '%';
  }

  Promise.all(manifest.sources.map(function(source) {
    return new Promise(function(resolve, reject) {
      var path = manifest.data[source];
      var xhr = new XMLHttpRequest();
      xhr.open('GET', path, true);
      xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
          var json = xhr.responseText;
          if (json.indexOf('__BUS_LINE_DATA') != -1) {
            json = json.replace(/var __BUS_LINE_DATA=JSON\.parse\('|\\\n|'\)$/g, '');
          }
          var data = JSON.parse(json);
          for (var line in data) {
            var lineName = line;
            if (lineNameMap[source] && lineNameMap[source][line])
              lineName = lineNameMap[source][line];
            var lineDetails = data[line];
            if (lineData[lineName]) {
              console.warn('New line name conflict!');
              var i;
              for (i = 2; lineData[lineName + '_' + i]; ++i);
              lineData[lineName + '_' + i] = lineDetails;
            } else
              lineData[lineName] = lineDetails;
          }
          updateProgress(source, 1, 1);
          resolve();
        } else if (xhr.readyState == 4) {
          // TODO: Error handling.
          // Note: Still resolve() because Promise.all does not wait for other pending promises if any one rejects.
          resolve();
        }
      };
      xhr.onprogress = function(e) {
        if (e.lengthComputable) {
          updateProgress(source, e.loaded, e.total);
        }
      };
      xhr.send()
    });
  })).then(function() {
    document.getElementById('progress').style.display = 'none';
    updateLineChooser(lineDataManager.getLines());
    if (!parseUrlHash())
      showLinesNew(lineChooser.children[0].value);
    loadRemoteManifest();
  });
}

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

function updateLineChooser(lines) {
  var lineChooser = document.getElementById('lineChooser');
  lines.forEach(line => {
    let option = document.createElement('option');
    option.value = line;
    option.appendChild(document.createTextNode(line));
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
  th.appendChild(document.createTextNode('Bus ID'));
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

  thead.appendChild(fillTr(["License ID"].concat(allBuses.map(bus => bus.licenseId)), true));
  return thead;
}

function getFilteredLineData(lines) {
  if (typeof lines == 'string') {
    var details = lineData[lines].details.filter(day => day[0] >= currentStartDate && day[0] <= currentEndDate).slice();
    var buses = lineData[lines].buses;
    var weightSums = new Array(buses.length).fill(0);
    details.forEach(day => day[1].forEach((weight, index) => weightSums[index] += weight));
    var zeroWeightFilter = (_, index) => weightSums[index] > 0;
    return {
      buses: buses.filter(zeroWeightFilter),
      details: details.map(day => [day[0], day[1].filter(zeroWeightFilter)])
    };
  } else {
    console.error('Not implemented');
  }
}

function showLine(line) {
  var content = document.getElementById('content');
  removeChildren(content);
  if (!lineData[line]) {
    content.appendChild(document.createTextNode('Line ' + line + ' does not exist!'));
    return;
  }

  var data = getFilteredLineData(line);

  var table = document.createElement('table');
  table.appendChild(createTableHeader(data.buses));
  var tbody = document.createElement('tbody');
  data.details.forEach(function(day) {
    tbody.appendChild(fillTr([day[0]].concat(new Array(day[1].length).fill('')), false, [''].concat(day[1].map(function(weight){
      return {style: 'background-color:rgb(' + COLOR.map(function(value) {
        return parseInt((255 - value) * (1 - weight) + value);
      }).join(',') + ')'};
    }))));
  });
  table.appendChild(tbody);
  content.appendChild(table);
}

function busCompareFunction(query) {
  if (query.length == 6) {
    return function(bus) {
      return bus.busId[0] == query[0] && bus.busId.substr(2) == query.substr(2);
    }
  } else { // if (query.length >= 5)
    return function(bus) {
      return bus.licenseId == query.substr(Math.max(query.length - 5, 0));
    }
  }
}

function findBusById(query) {
  var resultList = document.getElementById('resultList');
  removeChildren(resultList);
  for (var line in lineData) {
    if (lineData[line].buses.some(busCompareFunction(query))) {
      var option = document.createElement('option');
      option.value = line;
      option.appendChild(document.createTextNode(line));
      resultList.appendChild(option);
    }
  }
}


function showLinesNew(lineOrLines) {
  if (typeof lineOrLines == 'string')
    lineOrLines = [lineOrLines];

  let content = document.getElementById('content');
  let legend = document.getElementById('legend');
  removeChildren(content);
  removeChildren(legend);

  if (lineOrLines.length > PALETTE.length) {
    content.appendChild(document.createTextNode('Too many lines selected!'));
    return;
  }

  if (!lineDataManager.contains(lineOrLines)) {
    content.appendChild(document.createTextNode('Not all lines exist!'));
    return;
  }

  if (lineOrLines.length > 1) {
    lineOrLines.forEach((line, index) => {
      let item = document.createElement('span');
      let span = document.createElement('span');
      span.style.backgroundColor = 'rgb(' + PALETTE[index].join(',') + ')';
      span.style.height = '1em';
      span.style.width = '2em';
      span.style.display = 'inline-block';
      item.style.marginLeft = '3em';
      item.appendChild(span);
      item.appendChild(document.createTextNode(' ' + line));
      legend.appendChild(item);
    });
  }

  let data = lineDataManager.query(lineOrLines, currentStartDate, currentEndDate);

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
      if (activeCount == 0)
        return;

      day[1][busIndex].forEach((weight, lineIndex) => {
        if (weight > 0) {
          var span = document.createElement('span');
          span.style.height = '100%';
          span.style.width = 100 / activeCount + '%';
          span.style.display = 'inline-block';
          span.style.backgroundColor = 'rgb(' + (lineOrLines.length == 1 ? COLOR : PALETTE[lineIndex]).
              map(value => parseInt((255 - value) * (1 - weight) + value)).join(',') + ')';
          span.appendChild(document.createTextNode('\u00a0'));
          span.setAttribute('data-line', lineOrLines[lineIndex]);
          td.appendChild(span);
        }
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  content.appendChild(table);
}

function showLines(lines) {
  var content = document.getElementById('content');
  var legend = document.getElementById('legend');
  removeChildren(content);
  removeChildren(legend);

  if (lines.length > PALETTE.length) {
    content.appendChild(document.createTextNode('Too many lines selected!'));
    return;
  }

  if (lines.some(function(line) {
    return !lineData[line];
  })) {
    content.appendChild(document.createTextNode('Not all lines exist!'));
    return;
  }

  for (var i = 0; i < lines.length; ++i) {
    var item = document.createElement('span');
    var span = document.createElement('span');
    span.style.backgroundColor = 'rgb(' + PALETTE[i].join(',') + ')';
    span.style.height = '1em';
    span.style.width = '2em';
    span.style.display = 'inline-block';
    item.style.marginLeft = '3em';
    item.appendChild(span);
    item.appendChild(document.createTextNode(' ' + lines[i]));
    legend.appendChild(item);
  }

  var allBuses = [];
  var licenseIdSet = new Set();
  var lineDetailsMap = {};
  for (var i = 0; i < lines.length; ++i) {
    currentLineData = lineData[lines[i]];

    currentLineData.buses.forEach(function(bus) {
      if (!licenseIdSet.has(bus.licenseId)) {
        allBuses.push(bus);
        licenseIdSet.add(bus.licenseId);
      }
    });
    currentLineData.details.forEach(function(day) {
      if (!lineDetailsMap[day[0]]) {
        lineDetailsMap[day[0]] = {};
      }
      for (var j = 0; j < currentLineData.buses.length; ++j) {
        var licenseId = currentLineData.buses[j].licenseId;
        if (!lineDetailsMap[day[0]][licenseId])
          lineDetailsMap[day[0]][licenseId] = new Array(lines.length).fill(0);
        lineDetailsMap[day[0]][licenseId][i] = day[1][j];
      }
    });
  }

  allBuses.sort(function(a, b) {
    if (a.busId && b.busId) {
      if (a.busId < b.busId)
        return -1;
      else if (a.busId > b.busId)
        return 1;
      else
        return 0;
    } else if (a.busId && !b.busId) // a < b
      return -1;
    else if (!a.busId && b.busId) // a > b
      return 1;
    else {
      if (a.licenseId < b.licenseId)
        return -1;
      else if (a.licenseId > b.licenseId)
        return 1;
      return 0;
    }
  });

  var table = document.createElement('table');
  table.appendChild(createTableHeader(allBuses));
  var tbody = document.createElement('tbody');
  Object.keys(lineDetailsMap).sort().forEach(function(date) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.appendChild(document.createTextNode(date));
    tr.appendChild(th);
    allBuses.forEach(function(bus) {
      var td = document.createElement('td');
      tr.appendChild(td);
      var activeCount = 0;
      if (lineDetailsMap[date][bus.licenseId]) {
        activeCount = lineDetailsMap[date][bus.licenseId].filter(function(weight) {
          return weight > 0;
        }).length;
      }
      if (activeCount == 0)
        return;

      lineDetailsMap[date][bus.licenseId].forEach(function(weight, index) {
        if (weight > 0) {
          var span = document.createElement('span');
          span.style.height = '100%';
          span.style.width = 'calc(100%/' + activeCount + ')';
          span.style.display = 'inline-block';
          span.style.backgroundColor = 'rgb(' + PALETTE[index].map(function(value) {
            return parseInt((255 - value) * (1 - weight) + value);
          }).join(',') + ')';
          span.appendChild(document.createTextNode('\u00a0'));
          span.setAttribute('data-line', lines[index]);
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
      showLinesNew(hashValue.split('+'));
    } else
      activeLines = [hashValue];
      lineChooser.value = hashValue;
      showLinesNew(hashValue);
    return true;
  }
}

function onModifyDate() {
  let startDate = document.getElementById('startDate');
  let endDate = document.getElementById('endDate');

  if (lineDataManager.isDateRangeValid(startDate.value, endDate.value) && (
      currentStartDate != startDate.value || currentEndDate != endDate.value)) {
    currentStartDate = startDate.value;
    currentEndDate = endDate.value;
    showLinesNew(activeLines);
  } else {
    startDate.value = currentStartDate;
    endDate.value = currentEndDate;
  }
}

function init() {
  let lineChooser = document.getElementById('lineChooser');
  let startDate = document.getElementById('startDate');
  let endDate = document.getElementById('endDate');

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
  document.getElementById('busid').addEventListener('input', function() {
    findBusById(this.value);
  });
  document.getElementById('findRecent').addEventListener('click', function() {
    var findRecentDays = parseInt(document.getElementById('findRecentDays').value) || 15;
    var query = document.getElementById('busid').value;
    var results = {};
    [].map.call(document.getElementById('resultList').children, function(option) {
      return option.value;
    }).forEach(function(line) {
      var days = lineData[line].details;
      var index = lineData[line].buses.findIndex(busCompareFunction(query));
      for (var i = Math.max(days.length - findRecentDays, 0); i < days.length; ++i) {
        var date = days[i][0];
        var weight = days[i][1][index];
        if (weight) {
          var item = {line: line, weight: weight};
          if (results[date])
            results[date].push(item);
          else
            results[date] = [item];
        }
      }
    });
    var dates = Object.keys(results).sort();
    dates = dates.slice(Math.max(dates.length - findRecentDays, 0));
    alert(dates.map(function(date) {
      return date + ': ' + results[date].map(function(item) {
        return item.line + ' (' + item.weight + ')';
      }).join(', ');
    }).join('\n'));
  });
  ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(function(event) {
    document.getElementById('findRecentDays').addEventListener(event, function(e) {
      e.stopPropagation();
    });
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
    div.style.left = x + document.body.scrollLeft + document.documentElement.scrollLeft + 8 + 'px';
    div.style.top = y + document.body.scrollTop + document.documentElement.scrollTop + 8 + 'px';
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
