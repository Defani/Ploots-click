// Collapsible sidebar sections (Custom Size/Templates, Axis Range/Tick Marks/Grid Lines, LaTeX/Symbols).
// Pure UI chrome - does not touch any chart state.
(function () {
  function toggleSection(head) {
    var section = head.closest('.side-section');
    if (section) section.classList.toggle('open');
  }
  document.addEventListener('click', function (e) {
    var head = e.target.closest('.side-section-head');
    if (head) toggleSection(head);
  });
})();
