function removeChildren(parent) {
  while(parent.hasChildNodes())
    parent.removeChild(parent.childNodes[0]);
}

function fillSelect(select, labels, values) {
  removeChildren(select);
  labels.forEach((label, index) => {
    let option = document.createElement('option');
    option.value = values ? (values[index] || label) : label;
    option.appendChild(document.createTextNode(label));
    select.appendChild(option);
  });
}
