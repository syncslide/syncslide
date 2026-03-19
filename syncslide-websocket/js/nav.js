(function () {
  'use strict';

  var headerBtnSelector = 'header nav button[aria-expanded]';

  function closeAll() {
    document.querySelectorAll(headerBtnSelector).forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      var controlled = document.getElementById(btn.getAttribute('aria-controls'));
      if (controlled) { controlled.classList.remove('is-open'); }
    });
  }

  function toggle(btn) {
    var expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    var controlled = document.getElementById(btn.getAttribute('aria-controls'));
    if (controlled) { controlled.classList.toggle('is-open', !expanded); }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest(headerBtnSelector);
    if (btn) { toggle(btn); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') { return; }
    var hamburger = document.querySelector(
      'nav[aria-label="Primary navigation"] button[aria-expanded]'
    );
    closeAll();
    // Only focus the hamburger if it is visible (mobile). On desktop it is
    // display:none; sending focus there would move focus to a hidden element.
    if (hamburger && hamburger.offsetParent !== null) { hamburger.focus(); }
  });
}());
