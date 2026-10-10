(function(){
  if (typeof document === "undefined") return;
  var isBad = function(name) {
    return name.indexOf("bis_") === 0 || name.indexOf("__processed_") === 0;
  };
  var clean = function(el) {
    if (!el || el.nodeType !== 1 || !el.attributes) return;
    for (var i = el.attributes.length - 1; i >= 0; i--) {
      var attr = el.attributes[i];
      if (isBad(attr.name)) el.removeAttribute(attr.name);
    }
  };
  var sweep = function() {
    clean(document.documentElement);
    clean(document.body);
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) clean(all[i]);
  };
  sweep();
  try {
    var obs = new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "attributes") {
          clean(m.target);
        } else if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.nodeType === 1) {
              clean(node);
              if (node.querySelectorAll) {
                var inner = node.querySelectorAll("*");
                for (var k = 0; k < inner.length; k++) clean(inner[k]);
              }
            }
          }
        }
      }
    });
    obs.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  } catch (e) {}
})();