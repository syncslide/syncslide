(function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return; // Button absent on pages without nav — safe no-op

    function label(theme) {
        return theme === 'dark' ? 'Enable light mode' : 'Enable dark mode';
    }

    function syncBtn(theme) {
        btn.textContent = label(theme);
        btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }

    // Defensive sync in case theme-init.js ran before DOM was fully available
    syncBtn(document.documentElement.getAttribute('data-theme'));

    btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        syncBtn(next);

        try {
            localStorage.setItem('theme', next);
        } catch (e) { /* private browsing — fall back to session-only state */ }
    });
}());
