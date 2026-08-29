import globalize from '../../lib/globalize';

import './sliderValue.scss';

/**
 * Slider value badge.
 *
 * Draws a slider's current value on its thumb, with its bounds under the ends of the track.
 *
 * A native range input cannot be made to carry text in its thumb, so the number is a
 * separate element laid over it. It is placed the way emby-slider places its own bubble: a
 * track inset by half a thumb at each end, with the badge at a percentage along that track.
 * Taking the inset from the component's own convention is what keeps the two in step.
 *
 * Percentages rather than calc(): a TV browser that cannot parse calc() drops the whole
 * declaration rather than falling back to something sensible.
 *
 * @module components/subtitleSettings/sliderValue
 */

/**
 * @param {HTMLInputElement} slider - An upgraded emby-slider.
 * @returns {{ update: () => void, destroy: () => void }} Call `update` after setting the
 * slider's value in code, which fires no input event of its own.
 */
export function attachSliderValue(slider) {
    // emby-slider turns the slider's parent into the .mdl-slider-container the badge is
    // positioned within.
    const container = slider.parentNode;
    container.classList.add('sliderValueContainer');

    const track = document.createElement('div');
    track.classList.add('sliderValueTrack');

    const badge = document.createElement('div');
    badge.classList.add('sliderValue');
    // The badge repeats the slider's own value, so it is noise to a screen reader.
    badge.setAttribute('aria-hidden', 'true');

    track.appendChild(badge);
    container.appendChild(track);

    // The bounds flank the track rather than sitting under it, so the row reads as
    // 'min - value - max' left to right. That means wrapping the slider: the two labels have
    // to be its siblings in a flex row, not children of the field.
    const row = document.createElement('div');
    row.classList.add('sliderValueRow');
    container.parentNode.insertBefore(row, container);

    const makeEnd = (text) => {
        const end = document.createElement('span');
        end.classList.add('sliderEnd');
        end.setAttribute('aria-hidden', 'true');
        end.textContent = text;
        return end;
    };

    row.appendChild(makeEnd(slider.min));
    row.appendChild(container);
    row.appendChild(makeEnd(slider.max));

    const update = () => {
        const min = parseFloat(slider.min) || 0;
        const max = parseFloat(slider.max) || 0;
        const value = parseFloat(slider.value) || 0;
        const fraction = max > min ? (value - min) / (max - min) : 0;
        const percent = (globalize.getIsElementRTL(slider) ? 1 - fraction : fraction) * 100;

        badge.textContent = value;
        badge.style.left = `${percent}%`;
    };

    slider.addEventListener('input', update);
    update();

    return {
        update,
        destroy() {
            slider.removeEventListener('input', update);
            track.remove();
            // Put the slider back where it was before unwrapping it.
            row.parentNode?.insertBefore(container, row);
            row.remove();
        }
    };
}

export default attachSliderValue;
