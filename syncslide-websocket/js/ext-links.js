function markExternalLinks(container) {
    const svg = '<svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ext-icon"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    container.querySelectorAll('a[href^="http"]').forEach(a => {
        if (!a.querySelector('.ext-icon')) {
            a.insertAdjacentHTML('beforeend', svg + '<span class="ext-label">(external)</span>');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    markExternalLinks(document.body);
});
