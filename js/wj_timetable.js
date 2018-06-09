const lineSeparatorRegEx = /\r|\n|\r\n/;
var allLines = {};
var allData = {};

let fetchPromise = fetch('wj_all.guid').then(x => x.text()).then(data => {
  let lineChooser = document.getElementById('lineChooser');
  data.split(lineSeparatorRegEx).filter(x => x).map(x => x.split(/\t/)).forEach(line => {
    let guid = line[0];
    let name = line[1];
    let direction = line[2];
    if (!allLines[name])
      allLines[name] = [];
    allLines[name].push({direction: direction, guid: guid});
  });
  fillSelect(lineChooser, Object.keys(allLines).sort());
}).then(_ =>
fetch('wj_timetable.csv')).then(x => x.text()).then(data => {
  document.getElementById('progress').style.display = 'none';
  data.split(lineSeparatorRegEx).forEach(entry => {
    let values = entry.split(',');
    let date = values[0];
    let licenseId = values[1];
    let time = values[2];
    let lineGuid = values[3];

    if (!allData[lineGuid])
      allData[lineGuid] = {};
    if (!allData[lineGuid][date])
      allData[lineGuid][date] = [];

    allData[lineGuid][date].push({licenseId: licenseId, time: time});
  });
});

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('lineChooser').addEventListener('change', function() {
    onLineChange();
  });
  document.getElementById('dateChooser').addEventListener('change', function() {
    onDateChange();
  });

  fetchPromise.then(_ => onLineChange());
});

function defaultCompare(a, b) {
  if (a > b)
    return 1;
  if (a < b)
    return -1;
  return 0;
}

function onLineChange() {
  let lineChooser = document.getElementById('lineChooser');
  let dateChooser = document.getElementById('dateChooser');
  let originalDate = dateChooser.value;
  let dates = Object.keys(allData[allLines[lineChooser.value][0].guid]).sort();
  fillSelect(dateChooser, dates);
  if (dates.includes(originalDate))
    dateChooser.value = originalDate;
  onDateChange();
}

function parseByLineDate(line, date) {
  let timetable = {};
  let directions = allLines[line];
  directions.forEach((line, directionId) => {
    allData[line.guid][date].forEach(current => {
      if (!timetable[current.licenseId])
        timetable[current.licenseId] = [];
      timetable[current.licenseId].push({directionId: directionId, time: current.time});
    });
  });
  let maxCols = 0;
  for (let [licenseId, runs] of Object.entries(timetable)) {
    timetable[licenseId] = runs = runs.sort((a, b) => defaultCompare(a.time, b.time));
    let currentDirection = 0;
    let runsCount = 0;
    runs.forEach(details => {
      if (currentDirection != details.directionId)
        ++runsCount;
      ++runsCount;
      currentDirection = details.directionId == 1 ? 0 : 1;
    });
    maxCols = Math.max(maxCols, runsCount);
  }
  let order = Object.keys(timetable).sort((a, b) => {
    return defaultCompare(timetable[a][0].directionId, timetable[b][0].directionId) ||
      defaultCompare(timetable[a][0].time, timetable[b][0].time);
  });

  return {maxCols: maxCols, data: new Map(order.map(k => [k, timetable[k]]))};
}

function onDateChange() {
  let lineChooser = document.getElementById('lineChooser');
  let dateChooser = document.getElementById('dateChooser');
  let {maxCols: maxCols, data: data} = parseByLineDate(lineChooser.value, dateChooser.value);

  let table = document.createElement('table');
  table.border = 1;
  let tbody = document.createElement('tbody');
  let tr = document.createElement('tr');
  let th = document.createElement('th');
  th.rowSpan = 2;
  th.appendChild(document.createTextNode('车牌号'));
  let th2 = document.createElement('th');
  th2.colSpan = maxCols;
  th2.appendChild(document.createTextNode('发车时间'));
  tr.appendChild(th);
  tr.appendChild(th2);
  tbody.appendChild(tr);
  let tr2 = document.createElement('tr');
  let directionShortNames = [allLines[lineChooser.value][0].direction, allLines[lineChooser.value][1].direction];
  for (let i = 0; i < Math.min(directionShortNames[0].length, directionShortNames[1].length); ++i) {
    if (directionShortNames[0][i] == directionShortNames[1][i])
      continue;
    directionShortNames[0] = directionShortNames[0].substr(0, i + 1);
    directionShortNames[1] = directionShortNames[1].substr(0, i + 1);
  }
  for (let i = 0; i < maxCols; ++i) {
    let th = document.createElement('th');
    let direction = allLines[lineChooser.value][i % 2];
    th.title = direction.direction;
    th.appendChild(document.createTextNode(directionShortNames[i % 2]));
    tr2.appendChild(th);
  }
  tbody.appendChild(tr2);

  for (const [licenseId, runs] of data) {
    let tr = document.createElement('tr');
    let td = document.createElement('td');
    td.appendChild(document.createTextNode(licenseId));
    tr.appendChild(td);
    let currentDirection = 0;
    let colCount = 0;
    runs.forEach(details => {
      if (currentDirection != details.directionId) {
        let td = document.createElement('td');
        tr.appendChild(td);
        ++colCount;
      }
      currentDirection = details.directionId == 1 ? 0 : 1;
      let td = document.createElement('td');
      td.appendChild(document.createTextNode(details.time));
      tr.appendChild(td);
      ++colCount;
    });
    for (let i = 0; i < maxCols - colCount; ++i) {
      let td = document.createElement('td');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  let content = document.getElementById('content');
  removeChildren(content);
  content.appendChild(table);
}
