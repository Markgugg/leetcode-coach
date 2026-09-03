// inject.js — runs in the PAGE context so it can read Monaco's selection API.
// The content script asks for the current selection via window.postMessage.
(function () {
  function readSelection() {
    try {
      if (window.monaco && window.monaco.editor && monaco.editor.getEditors) {
        var eds = monaco.editor.getEditors() || [];
        for (var i = 0; i < eds.length; i++) {
          var ed = eds[i];
          if (ed && ed.getSelection && ed.getModel) {
            var sel = ed.getSelection();
            if (sel && !(sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn)) {
              var t = ed.getModel().getValueInRange(sel);
              if (t && t.trim()) return t;
            }
          }
        }
      }
    } catch (e) {}
    // Fallback: native browser selection.
    try {
      var s = window.getSelection();
      if (s && s.toString().trim()) return s.toString();
    } catch (e) {}
    return "";
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || e.data.type !== "LCC_GET_SELECTION") return;
    window.postMessage({ type: "LCC_SELECTION", text: readSelection() }, "*");
  });
})();
