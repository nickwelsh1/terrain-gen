// Keeps a --value custom property (0%–100%) on range inputs in sync so the
// track fill gradient in styles/shared.css can follow the thumb position.

export function updateSliderFill(slider) {
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const percent = ((slider.value - min) / (max - min)) * 100;
    slider.style.setProperty('--value', `${percent}%`);
}

// Delegated input listener catches sliders added later (e.g. gallery cards);
// the initial sweep positions fills for sliders already in the DOM.
export function initSliderFill(root = document) {
    root.addEventListener('input', (event) => {
        if (event.target.matches?.('input[type="range"]')) {
            updateSliderFill(event.target);
        }
    });
    root.querySelectorAll('input[type="range"]').forEach(updateSliderFill);
}
