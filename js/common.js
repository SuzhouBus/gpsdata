function createElement(tagName, childOrChildren, attributes) {
  var element = document.createElement(tagName);
  appendChildren(element, childOrChildren);
  for (const [name, value] of Object.entries(attributes || {})) {
    if (name == 'style' && typeof value == 'object') {
      for (const [styleKey, styleValue] of Object.entries(value || {})) {
        element.style[styleKey] = styleValue;
      }
    } else {
      element.setAttribute(name == 'className' ? 'class' : name, value);
    }
  }
  return element;
}

function appendChildren(parentElement, childOrChildren, internal) {
  if (!childOrChildren)
    return;
  if (typeof parentElement == 'string')
    parentElement = document.getElementById(parentElement);

  if (typeof childOrChildren == 'string') {
    parentElement.appendChild(document.createTextNode(childOrChildren));
  } else if (childOrChildren instanceof Node) {
    parentElement.appendChild(childOrChildren);
  } else if (childOrChildren.length && !internal) {
    [].forEach.call(childOrChildren, child => appendChildren(parentElement, child, true));
  }

  return parentElement;
}

function removeChildren(parentElement) {
  if (typeof parentElement == 'string')
    parentElement = document.getElementById(parentElement);

  while(parentElement.hasChildNodes())
    parentElement.removeChild(parentElement.childNodes[0]);
}

function replaceChildren(parentElement, childOrChildren) {
  if (typeof parentElement == 'string')
    parentElement = document.getElementById(parentElement);

  removeChildren(parentElement);
  appendChildren(parentElement, childOrChildren);
}

function fillSelect(select, labels, values) {
  if (typeof select == 'string')
    select = document.getElementById(select);

  removeChildren(select);
  labels.forEach((label, index) => {
    let option = document.createElement('option');
    option.value = values ? (values[index] || label) : label;
    option.appendChild(document.createTextNode(label));
    select.appendChild(option);
  });
}
