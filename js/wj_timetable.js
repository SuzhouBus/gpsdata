const lineSeparatorRegEx = /\r|\n|\r\n/;
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
].map(x => 'rgb(' + x.join(',') + ')');

var allLines = {};
var allData = {};
var parsedLines = {};

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

function defaultCompare(a, b) {
  if (a > b)
    return 1;
  if (a < b)
    return -1;
  return 0;
}

function parseByLineDate(line, date) {
  let timetable = {};
  let directions = allLines[line];
  directions.forEach((line, directionId) => {
    ((allData[line.guid] || {})[date] || []).forEach(current => {
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

function parseLine(line) {
  let dates = Array.from(allLines[line].reduce((result, cur) => (Object.keys(allData[cur.guid] || {}).forEach(date => result.add(date)), result), new Set())).sort();
  let parsedData = dates.map(date => Object.assign({date: date}, parseByLineDate(line, date))).
      map(details => Object.assign(details, {key: Array.from(details.data.values()).map(runs => runs.map(run => run.directionId + '/' + run.time).join(',')).join(';')}));
  let groupedData = new Map();
  parsedData.forEach(day => {
    if (groupedData.has(day.key)) {
      groupedData.get(day.key).dates.set(day.date, Array.from(day.data.keys()));
    } else {
      groupedData.set(day.key, {dates: new Map([[day.date, Array.from(day.data.keys())]]), timetable: Array.from(day.data.values()), maxCols: day.maxCols});
    }
  });
  return Array.from(groupedData.values());
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('lineChooser').addEventListener('change', function() {
    onLineChange();
  });
  document.getElementById('dateChooser').addEventListener('change', function() {
    onDateChange();
  });
  document.getElementById('scheduleTable').addEventListener('change', function() {
    onDateChange();
  });
  document.getElementById('timetable').addEventListener('change', function() {
    onDateChange();
  });

  fetchPromise.then(_ => onLineChange());
});

function onLineChange() {
  let lineChooser = document.getElementById('lineChooser');
  let dateChooser = document.getElementById('dateChooser');
  let originalDate = dateChooser.value;
  let dates = ['显示所有日期'].concat(Object.keys(allData[allLines[lineChooser.value][0].guid]).sort());
  fillSelect(dateChooser, dates, ['all']);
  if (dates.includes(originalDate))
    dateChooser.value = originalDate;
  onDateChange();
}

function renderTimeTableRow(runs, maxCols) {
  let tds = [];
  let currentDirection = 0;
  let colCount = 0;
  runs.forEach(details => {
    if (currentDirection != details.directionId) {
      tds.push(createElement('td'));
      ++colCount;
    }
    currentDirection = details.directionId == 1 ? 0 : 1;
    tds.push(createElement('td', details.time));
    ++colCount;
  });
  for (let i = 0; i < maxCols - colCount; ++i) {
    tds.push(createElement('td'));
  }
  return tds;
}

function renderTimetable(timetable, directions) {
  return createElement('table', [
    createElement('tbody', 
      Object.keys(timetable).sort().reduce((trs, date) => trs.concat(directions.map((details, directionId) => createElement('tr', [
        ...(directionId == 0 ? [createElement('th', date, {rowSpan: 2, style: 'white-space: nowrap'})] : []),
        createElement('th', details.direction, {style: 'white-space: nowrap'}),
        ...timetable[date][directionId].map(time => createElement('td', time)),
      ]))), [])
    )
  ]);
}

function onDateChange() {
  let selectedLine = document.getElementById('lineChooser').value;
  let selectedDate = document.getElementById('dateChooser').value;
  let content = document.getElementById('content');
  let allDates = selectedDate == 'all';
  let directions = allLines[selectedLine];
  let data = parseLine(selectedLine);
  removeChildren(content);

  if (!allDates) {
    data = [data.find(cur => Array.from(cur.dates.keys()).includes(selectedDate))];
    if (!data[0])
      data = [];
    else
      data[0].dates = new Map([[selectedDate, data[0].dates.get(selectedDate)]]);
  }

  if (document.getElementById('timetable').checked) {
    let timetable = data.reduce((result, current) => {
      for (const date of current.dates.keys()) {
        result[date] = current.timetable.reduce((timesByDirection, currentRow) => {
          currentRow.forEach(entry => {
            if (!timesByDirection[entry.directionId])
              timesByDirection[entry.directionId] = [];
            timesByDirection[entry.directionId].push(entry.time);
          });
          return timesByDirection;
        }, {});
        for (let direction in result[date]) {
          result[date][direction] = result[date][direction].sort();
        }
      }
      return result;
    }, {});
    content.appendChild(renderTimetable(timetable, directions));
  } else {
    data.forEach(cur => {
      let header1 = createElement('tr', [
        createElement('th', allDates ? '日期' : '车牌号', {rowSpan: 2}),
        ...(allDates ? Array.from(cur.dates.keys()).map(date => createElement('th', date, {rowSpan: 2})) : []),
        createElement('th', '发车时间', {colSpan: cur.maxCols}),
      ]);
      let directionShortNames = [directions[0].direction, directions[1].direction];
      for (let i = 0; i < Math.min(directionShortNames[0].length, directionShortNames[1].length); ++i) {
        if (directionShortNames[0][i] == directionShortNames[1][i])
          continue;
        directionShortNames[0] = directionShortNames[0].substr(0, i + 1);
        directionShortNames[1] = directionShortNames[1].substr(0, i + 1);
      }
      let header2 = createElement('tr', new Array(cur.maxCols).fill(0).map((_, i) =>
          createElement('th', directionShortNames[i % 2], {title: directions[i % 2].direction})));
      let allLicenseIds = allDates ? Array.from(Array.from(cur.dates.values()).reduce((set, cur) =>
          (cur.forEach(licenseId => set.add(licenseId)), set), new Set())).sort() : [];
      appendChildren(content, [
        createElement('table', [
          createElement('thead', [header1, header2]),
          createElement('tbody',
            cur.timetable.map((runs, timetableIndex) => createElement('tr', [
              ...(allDates && timetableIndex == 0 ? [createElement('th', '车牌号', {rowSpan: cur.timetable.length})] : []),
              ...Array.from(cur.dates.values()).map(licenseIds => {
                let lindex = allLicenseIds.indexOf(licenseIds[timetableIndex]);
                let attr = {};
                if (allDates && lindex >=0 && lindex < PALETTE.length)
                  attr.style = 'background-color:' + PALETTE[lindex];
                return createElement('td', licenseIds[timetableIndex], attr);
              }),
              ...renderTimeTableRow(runs, cur.maxCols),
            ])),
          ),
        ], {border: 1}),
        createElement('p'),
      ]);
    });
  }
}
