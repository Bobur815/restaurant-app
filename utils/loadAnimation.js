function showActionAnim(type = 'open', title = 'Processing…', symbol = '✔') {
    const overlay = document.getElementById('action-anim');
    const titleEl = document.getElementById('anim-title');
    const iconEl = document.getElementById('anim-icon');
    if (!overlay) return;

    // reset classes
    overlay.classList.remove('open', 'close', 'edit', 'hidden');
    overlay.classList.add(type);
    titleEl.textContent = title;
    iconEl.textContent = symbol;

    // restart progress bar animation
    const bar = overlay.querySelector('.anim-bar span');
    if (bar) {
        bar.style.animation = 'none';
        // force reflow
        // eslint-disable-next-line no-unused-expressions
        bar.offsetHeight;
        bar.style.animation = null; // uses fill-2s
    }

    overlay.classList.add('show');
}

function hideActionAnim() {
    const overlay = document.getElementById('action-anim');
    if (!overlay) return;
    overlay.classList.remove('show');
    // small delay to avoid flash
    setTimeout(() => overlay.classList.add('hidden'), 200);
}

/**
 * Ensures at least 2s animation while promise runs.
 * Usage: await withActionAnimation(fetchPromise, { type:'close', title:'Smena yopilmoqda…', icon:'🔒' })
 */
async function withActionAnimation(promiseFactory, { type = 'open', title = 'Processing…', icon = '✔' } = {}) {
    showActionAnim(type, title, icon);
    const start = Date.now();
    try {
        const p = promiseFactory(); // create the promise now
        const [res] = await Promise.all([
            p,
            new Promise(r => setTimeout(r, 2000)), // minimum 2s
        ]);
        return res;
    } finally {
        const elapsed = Date.now() - start;
        const rest = Math.max(0, 2000 - elapsed); // safety (usually 0)
        setTimeout(hideActionAnim, rest);
    }
}
export { showActionAnim, hideActionAnim, withActionAnimation };