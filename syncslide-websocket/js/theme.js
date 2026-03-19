(function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return; // Button absent on pages without nav — safe no-op

    function label(theme) {
        return theme === 'dark' ? 'Enable light mode' : 'Enable dark mode';
    }

    // Defensive sync in case theme-init.js ran before DOM was fully available
    var html = document.documentElement;
    btn.textContent = label(html.getAttribute('data-theme'));

    btn.addEventListener('click', function () {
        var current = html.getAttribute('data-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        btn.textContent = label(next);

        try {
            localStorage.setItem('theme', next);
        } catch (e) { /* private browsing — fall back to session-only state */ }
    });
}());
