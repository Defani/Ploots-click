// Panel docking: the left rail + sidebar and the Design/Layers panel sit
// together on one side of the window (left or right), so the canvas keeps
// one clean edge and the most room. The Design/Layers panel is moved out of
// the layout pane into its own column of .app, next to the sidebar; it no
// longer floats over the canvas, so rulers, scrollbars and page fit never
// run underneath it. Two topbar buttons switch the side and hide/show the
// Design/Layers panel; both choices are remembered in localStorage.
(function () {
  'use strict';

  var KEY_SIDE = 'ploots.panelDock', KEY_HIDE = 'ploots.rightPanelHidden';

  function load(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  var app = document.querySelector('.app');
  var panel = document.getElementById('layersPanel');
  var main = document.querySelector('.main');
  if (!app || !panel || !main) return;
  app.insertBefore(panel, main);

  var side = load(KEY_SIDE, 'left') === 'right' ? 'right' : 'left';
  var hidden = load(KEY_HIDE, '0') === '1';

  function refit() {
    if (typeof syncStageSize === 'function') setTimeout(syncStageSize, 30);
    if (typeof updateRulers === 'function') setTimeout(updateRulers, 60);
  }

  function apply() {
    document.body.classList.toggle('dock-right', side === 'right');
    document.body.classList.toggle('dock-left', side === 'left');
    document.body.classList.toggle('rp-hidden', hidden);
    var sideBtn = document.getElementById('dockSideBtn'), hideBtn = document.getElementById('rightPanelBtn');
    if (sideBtn) {
      sideBtn.title = side === 'left' ? 'Move panels to the right' : 'Move panels to the left';
      sideBtn.querySelector('.material-symbols-outlined').textContent = side === 'left' ? 'dock_to_right' : 'dock_to_left';
    }
    if (hideBtn) {
      hideBtn.title = hidden ? 'Show Design / Layers panel' : 'Hide Design / Layers panel';
      hideBtn.classList.toggle('active', !hidden);
    }
    refit();
  }

  function button(id, icon) {
    var b = document.createElement('button');
    b.className = 'theme-toggle-btn';
    b.id = id;
    b.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span>';
    return b;
  }
  var right = document.querySelector('.topbar-right');
  if (right) {
    var hb = button('rightPanelBtn', 'view_sidebar'), sb = button('dockSideBtn', 'dock_to_right');
    right.insertBefore(sb, right.firstChild);
    right.insertBefore(hb, right.firstChild);
    sb.addEventListener('click', function () { side = side === 'left' ? 'right' : 'left'; save(KEY_SIDE, side); apply(); });
    hb.addEventListener('click', function () { hidden = !hidden; save(KEY_HIDE, hidden ? '1' : '0'); apply(); });
  }

  // The Design/Layers panel belongs to the layout view; hide it in Data View.
  var setView = window.setView;
  if (typeof setView === 'function') {
    window.setView = function (v) {
      var out = setView.apply(this, arguments);
      document.body.classList.toggle('data-view-active', v === 'data');
      refit();
      return out;
    };
  }

  apply();
})();
