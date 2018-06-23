function createElement(tagName, childOrChildren, attributes) {
  var element = document.createElement(tagName);
  appendChildren(element, childOrChildren);
  for (const [name, value] of Object.entries(attributes || {})) {
    if (name == 'style' && typeof value == 'object') {
      for (const [styleKey, styleValue] of Object.entries(value || {})) {
        element.style[styleKey] = styleValue;
      }
    } else {
      element.setAttribute(name, value);
    }
  }
  return element;
}

function appendChildren(parent, childOrChildren, internal) {
  if (!childOrChildren)
    return;

  if (typeof childOrChildren == 'string') {
    parent.appendChild(document.createTextNode(childOrChildren));
  } else if (childOrChildren instanceof Node) {
    parent.appendChild(childOrChildren);
  } else if (childOrChildren.length && !internal) {
    [].forEach.call(childOrChildren, child => appendChildren(parent, child, true));
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
