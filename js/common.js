function createElement(tagName, childOrChildren, attributes) {
  var element = document.createElement(tagName);
  appendChildren(element, childOrChildren);
  for (const [name, value] of Object.entries(attributes || {})) {
    element.setAttribute(name, value);
  }
  return element;
}

function appendChildren(parent, childOrChildren) {
  if (typeof childOrChildren == 'string') {
    parent.appendChild(document.createTextNode(childOrChildren));
  } else if (childOrChildren instanceof Node) {
    parent.appendChild(childOrChildren);
  } else if (childOrChildren && childOrChildren.length) {
    [].forEach.call(childOrChildren, child => parent.appendChild(child));
  }

  return parent;
}

function removeChildren(parent) {
  while(parent.hasChildNodes())
    parent.removeChild(parent.childNodes[0]);
}

function replaceChildren(parent, childOrChildren) {
  removeChildren(parent);
  appendChildren(parent, childOrChildren);
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
