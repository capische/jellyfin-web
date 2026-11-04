/** Use the mockup's transition classes while dialogHelper retains removal and focus timing. */
export const openDesignDialog = (host: HTMLElement) => {
    const surface = host.querySelector('.mn, .msheet');
    if (!surface) return;
    surface.getBoundingClientRect();
    surface.classList.add('open');
};

export const closeDesignDialog = (host: HTMLElement, done: () => void) => {
    const surface = host.querySelector('.mn, .msheet');
    if (!surface) {
        done();
        return;
    }
    surface.classList.remove('open');
    const durations = getComputedStyle(surface).transitionDuration.split(',').map(value => parseFloat(value) * 1000);
    const duration = Math.max(...durations);
    if (duration) setTimeout(done, duration);
    else done();
};
