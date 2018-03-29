if (!window.console) {
  window.console = {
    error: function() {},
    warn: function() {},
    log: function() {},
    debug: function() {},
  };
}

if (!history.pushState) {
  history.pushState = function() {};
}
