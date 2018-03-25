var COLOR = [106, 90, 205];
var PALETTE = [
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
var lineData = {};
var lineNameMap = {};
var lineSourceMap = {};
var activeLines = [];

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
    initializeLineChooser();
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

function initializeLineChooser() {
  var lineChooser = document.getElementById('lineChooser');
  Object.keys(lineData).sort(function(a, b) {
    var ia = parseInt(a);
    var ib = parseInt(b);
    var defaultComparisonResult;

    if (a < b)
      defaultComparisonResult = -1;
    else if (a > b)
      defaultComparisonResult = 1;
    else
      defaultComparisonResult = 0;

    if (isNaN(ia) && isNaN(ib)) {
      return defaultComparisonResult;
    } else if (isNaN(ia) && !isNaN(ib)) { // a (NaN) > b (Number)
      return 1;
    } else if (!isNaN(ia) && isNaN(ib)) { // a (Number) < b (NaN)
      return -1;
    } else { // Both a & b are numbers
      if (ia < ib)
        return -1;
      else if (ia > ib)
        return 1;
      else
        return defaultComparisonResult;
    }
  }).forEach(function(line) {
    var option = document.createElement('option');
    option.value = line;
    option.appendChild(document.createTextNode(line));
    lineChooser.appendChild(option);
  });

  if (!parseUrlHash())
    showLine(lineChooser.children[0].value);
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

function showLine(line) {
  activeLines = [line];
  var content = document.getElementById('content');
  removeChildren(content);
  if (!lineData[line]) {
    content.appendChild(document.createTextNode('Line ' + line + ' does not exist!'));
    return;
  }

  var table = document.createElement('table');
  table.appendChild(createTableHeader(lineData[line].buses));
  var tbody = document.createElement('tbody');
  lineData[line].details.forEach(function(day) {
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
    showLines(activeLines);
  } else {
    var line = this.value;
    showLine(line);
    history.pushState(line, '', '#' + line);
  }
}

function loadDataFromFile(url, callback) {
  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = url;
  document.head.appendChild(script);
  script.onload = function() {
    callback(__BUS_LINE_DATA, url);
  };
}

function parseUrlHash() {
  if (location.hash.replace('#', '')) {
    var hashValue = location.hash.replace('#', '');
    if (hashValue.includes('+')) {
      activeLines = hashValue.split('+');
      showLines(hashValue.split('+'));
    } else
      showLine(lineChooser.value = hashValue);
    return true;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  loadData();

  lineChooser.addEventListener('change', onChooseLine);
  document.getElementById('resultList').addEventListener('change', onChooseLine);
  window.onpopstate = function(e) {
    if (e.state instanceof Array) {
      activeLines = e.state;
      showLines(activeLines);
    } else if(e.state) {
      showLine(e.state);
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
  document.getElementById('startDate').value = '2018-01-01';
  var today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  document.getElementById('endDate').value = today.toISOString().substr(0, 10);
});

/*if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service_worker.js');
} else {
  var iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = 'appcache.html';
  document.body.appendChild(iframe);
}*/
