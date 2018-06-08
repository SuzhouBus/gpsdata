const lineSeparatorRegEx = /\r|\n|\r\n/;
var allData = {};

fetch('/wj_all.guid').then(x => x.text()).then(data => {
  let lineChooser = document.getElementById('lineChooser');
  let lines = data.split(lineSeparatorRegEx).filter(x => x).map(x => x.split(/\t/));
  fillSelect(lineChooser, lines.map(line => line[1] + ' (' + line[2] + ')'), lines.map(line => line[0]));
}).then(_ =>
fetch('/wj_timetable.csv')).then(x => x.text()).then(data => {
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
  let lineChooser = document.getElementById('lineChooser');
  let dateChooser = document.getElementById('dateChooser');
  lineChooser.addEventListener('change', function() {
    fillSelect(dateChooser, Object.keys(allData[lineChooser.value]).sort());
  });
  dateChooser.addEventListener('change', function() {
    let timetable = allData[lineChooser.value][dateChooser.value].reduce((result, current) => {
      if (!result[current.licenseId])
        result[current.licenseId] = [];
      result[current.licenseId].push(current.time);
      return result;
    }, {});
    let order = Object.keys(timetable).sort((a, b) => {
      if (timetable[a][0] > timetable[b][0])
        return 1;
      else if (timetable[a][0] < timetable[b][0])
        return -1;
      else
        return 0;
    });

    let table = document.createElement('table');
    let tbody = document.createElement('tbody');
    let tr = document.createElement('tr');
    let th = document.createElement('th');
    th.appendChild(document.createTextNode('车牌号'));
    let th2 = document.createElement('th');
    th2.colSpan = Object.keys(timetable).reduce((max, cur) => timetable[cur].length > max ? timetable[cur].length : max, 0);
    th2.appendChild(document.createTextNode('发车时间'));
    tr.appendChild(th);
    tr.appendChild(th2);
    tbody.appendChild(tr);
    order.forEach(licenseId => {
      let tr = document.createElement('tr');
      let td = document.createElement('td');
      td.appendChild(document.createTextNode(licenseId));
      tr.appendChild(td);
      timetable[licenseId].forEach(time => {
        let td = document.createElement('td');
        td.appendChild(document.createTextNode(time));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    let content = document.getElementById('content');
    removeChildren(content);
    content.appendChild(table);
  });
});
