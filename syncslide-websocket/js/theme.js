(function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return; // Button absent on pages without nav — safe no-op

    // Defensive sync in case theme-init.js ran before DOM was fully available
    var html = document.documentElement;
    btn.setAttribute('aria-pressed', html.getAttribute('data-theme') === 'dark' ? 'true' : 'false');

    btn.addEventListener('click', function () {
        var current = html.getAttribute('data-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');

        try {
            localStorage.setItem('theme', next);
        } catch (e) { /* private browsing — fall back to session-only state */ }
    });
}());
