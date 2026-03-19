(function () {
    var theme = null;

    // localStorage can throw in private browsing and some AT browser profiles
    try {
        var stored = localStorage.getItem('theme');
        if (stored === 'dark' || stored === 'light') {
            theme = stored;
        }
    } catch (e) { /* ignore */ }

    // Fall back to OS preference
    if (!theme) {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.documentElement.setAttribute('data-theme', theme);

    // Sync aria-pressed on the toggle button.
    // Uses both DOMContentLoaded (normal load) and pageshow (back-forward cache
    // restore, where DOMContentLoaded does not re-fire).
    function syncPressed() {
        var btn = document.getElementById('theme-toggle');
        if (btn) {
            btn.setAttribute('aria-pressed',
                document.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
        }
    }

    document.addEventListener('DOMContentLoaded', syncPressed);
    window.addEventListener('pageshow', syncPressed);
}());
