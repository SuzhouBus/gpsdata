const THRESHOLD = 30 * 60;

function removeChildren(parent) {
  while(parent.hasChildNodes())
    parent.removeChild(parent.childNodes[0]);
}

function parseUrlHash() {
  let line = location.hash.replace('#', '');
  if (line) {
    loadData(line);
  }
}

function timeDelta(time1, time2) {
  const BASE = 60;
  let components1 = time1.split(':');
  let components2 = time2.split(':');
  let result = 0;
  let sign = 1;

  if (components1.length < components2.length) {
    [components1, components2] = [components2, components1];
    sign = -1;
  }

  let lengthDelta = components1.length - components2.length;
  for (let i = 0; i < lengthDelta; ++i) {
    results *= BASE;
    results += parseInt(components1[i]);
  }

  for (let i = 0; i < components2.length; ++i) {
    result *= BASE;
    result += (components1[lengthDelta + i] - components2[i]);
  }

  return sign * result;
}

function formatTimeDelta(delta, length) {
  const BASE = 60;

  if (delta == 0) {
    return new Array(length).fill('00').join(':');
  }
  
  let prefix = '';
  if (delta < 0) {
    prefix = '-';
    delta = -delta;
  }

  let result = [];
  do {
    let lower = (delta % BASE).toString();
    if (lower.length == 1) {
      lower = '0' + lower;
    }
    delta = Math.trunc(delta / BASE);
    result.unshift(lower);
  } while (delta > 0 && (!length || result.length < length - 1));

  if (delta > 0) {
    let highest = delta.toString();
    if (highest.length == 1) {
      highest = '0' + highest;
    }
    result.unshift(highest);
  }

  while (length && result.length < length) {
    result.unshift('00');
  }

  return prefix + result.join(':');
}

function loadData(line, data) {
  document.getElementById('line').value = line;
  let content = document.getElementById('content');
  removeChildren(content);

  if (data) {
    showData(parseData(data));
  } else {
    fetch(line + '.csv').then(x=>x.text()).then(parseData)./*then(data => document.getElementById('logs').value = JSON.stringify(data, null, '  ')).*/
    then(showData).
    catch(function() {
      alert('Failed to load data.');
    });
  }
}

function parseData(data) {
  let linesSet = new Set();
  return data.split(/\r\n|\r|\n/).
      filter(x => linesSet.has(x) ? false : (linesSet.add(x), true)).
      map(x => {
    let values = x.split(',');
    if (values.length >= 6) {
      return {
        stopName: values[0],
        stopId: values[1],
        licenseId: values[2],
        time: values[3],
        date: values[4],
        direction: values[5]
      };
    } else {
      return null;
    }
  }).filter(x => x).reduce((result, current) => {
    if (!result[current.date]) {
      result[current.date] = {};
    }

    let newRange = {
      startTime: current.time,
      startStopName: current.stopName,
      startStopId: current.stopId,
      endTime: current.time,
      endStopName: current.stopName,
      endStopId: current.stopId,
      direction: current.direction,
    };
    if (!result[current.date][current.licenseId]) {
      result[current.date][current.licenseId] = [newRange];
      return result;
    }

    let ranges = result[current.date][current.licenseId];
    let lastRange = ranges[ranges.length - 1];
    if (current.stopName == lastRange.endStopName &&
        current.stopName == lastRange.startStopName &&
        current.direction == lastRange.direction) {
      lastRange.startTimeInstructed = lastRange.startTime;
      lastRange.endTime = lastRange.startTime = current.time;
    } else if (timeDelta(current.time, lastRange.endTime) > THRESHOLD ||
        lastRange.direction != current.direction) {
      ranges.push(newRange);
    } else {
      lastRange.endTime = current.time;
      lastRange.endStopName = current.stopName;
      lastRange.endStopId = current.stopId;
    }

    return result;
  }, {});
}

function showData(data) {
  let maxRanges = Object.keys(data).reduce(
    (max, date) => Math.max(max, Object.keys(data[date]).reduce(
      (max, licenseId) => Math.max(max, data[date][licenseId].length), 0)
  ), 0);
  Object.keys(data).sort().forEach(function(date) {
    let h2 = document.createElement('h2');
    h2.appendChild(document.createTextNode(date));
    content.appendChild(h2);
    let table = document.createElement('table');
    let tbody = document.createElement('tbody');
    Object.keys(data[date]).sort((a, b) => {
      let data2 = data[date];
      return timeDelta(data2[a][0].startTime, data2[b][0].startTime);
    }).forEach(licenseId => {
      let ranges = data[date][licenseId];
      let tr = document.createElement('tr');
      let th = document.createElement('th');
      th.appendChild(document.createTextNode(licenseId));
      tr.appendChild(th);
      ranges.forEach(range => {
        let td = document.createElement('td');
        td.appendChild(document.createTextNode(range.startStopName));
        td.appendChild(document.createElement('br'));
        td.appendChild(document.createTextNode(range.startTime));
        tr.appendChild(td);
        td = document.createElement('td');
        td.appendChild(document.createTextNode(range.endStopName));
        td.appendChild(document.createElement('br'));
        td.appendChild(document.createTextNode(range.endTime));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(table);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  var file = document.getElementById('file');
  window.onpopstate = function(e) {
    if(e.state) {
      loadData(e.state);
    } else {
      parseUrlHash();
    }
  };

  document.getElementById('load').addEventListener('click', function() {
    loadData(document.getElementById('line').value);
  });

  file.addEventListener('change', function() {
    if (file.files && file.files.length) {
      var reader = new FileReader();
      reader.onload = function() {
        loadData(file.files[0].name, reader.result);
      };
      reader.readAsText(file.files[0]);
    }
  });

  if (file.files && FileReader) {
    document.getElementById('file_container').style.display = '';
  }

  parseUrlHash();
});
