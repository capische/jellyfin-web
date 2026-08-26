/**
 * Subtitle settings visual helper.
 * @module components/subtitleSettings/subtitleAppearanceHelper
 */
import { getFlexAlign, resolvePlacement } from './subtitlePlacement';

/**
 * Approximate line height of a subtitle line, used to convert the spacing setting from lines
 * to em. Ideally this would be measured from the element rather than assumed.
 */
export const LINE_HEIGHT = 1.35;

/**
 * The text size setting as a plain multiplier, for callers that need to reason about the
 * rendered line height in pixels rather than emit CSS.
 */
export function getTextScale(settings) {
    const fontSize = getTextStyles(settings).find((style) => style.name === 'font-size')?.value;
    return fontSize === 'inherit' ? 1 : (parseFloat(fontSize) || 1);
}

function getTextStyles(settings) {
    const list = [];

    switch (settings.textSize || '') {
        case 'tiniest':
            list.push({ name: 'font-size', value: '.4em' });
            break;
        case 'tinier':
            list.push({ name: 'font-size', value: '.5em' });
            break;
        case 'tiny':
            list.push({ name: 'font-size', value: '.6em' });
            break;
        case 'extrasmaller':
            list.push({ name: 'font-size', value: '.7em' });
            break;
        case 'smaller':
            list.push({ name: 'font-size', value: '.8em' });
            break;
        case 'small':
            list.push({ name: 'font-size', value: 'inherit' });
            break;
        case 'larger':
            list.push({ name: 'font-size', value: '2em' });
            break;
        case 'extralarge':
            list.push({ name: 'font-size', value: '2.2em' });
            break;
        case 'large':
            list.push({ name: 'font-size', value: '1.72em' });
            break;
        case 'medium':
        default:
            list.push({ name: 'font-size', value: '1.36em' });
            break;
    }

    switch (settings.textWeight || '') {
        case 'thinnest':
            list.push({ name: 'font-weight', value: '100' });
            break;
        case 'thinner':
            list.push({ name: 'font-weight', value: '200' });
            break;
        case 'thin':
            list.push({ name: 'font-weight', value: '300' });
            break;
        case 'bold':
            list.push({ name: 'font-weight', value: 'bold' });
            break;
        case 'normal':
        default:
            list.push({ name: 'font-weight', value: 'normal' });
            break;
    }

    switch (settings.dropShadow || '') {
        case 'raised':
            list.push({ name: 'text-shadow', value: '-0.04em -0.04em #fff, 0px -0.04em #fff, -0.04em 0px #fff, 0.04em 0.04em #000, 0px 0.04em #000, 0.04em 0px #000' });
            break;
        case 'depressed':
            list.push({ name: 'text-shadow', value: '0.04em 0.04em #fff, 0px 0.04em #fff, 0.04em 0px #fff, -0.04em -0.04em #000, 0px -0.04em #000, -0.04em 0px #000' });
            break;
        case 'uniform':
            list.push({ name: 'text-shadow', value: '#000 0px 0.03em, #000 0px -0.03em, #000 0px 0.05em, #000 0px -0.05em, #000 0.03em 0px, #000 -0.03em 0px, #000 0.03em 0.03em, #000 -0.03em 0.03em, #000 0.03em -0.03em, #000 -0.03em -0.03em, #000 0.03em 0.05em, #000 -0.03em 0.05em, #000 0.03em -0.05em, #000 -0.03em -0.05em, #000 0.05em 0px, #000 -0.05em 0px, #000 0.05em 0.03em, #000 -0.05em 0.03em, #000 0.05em -0.03em, #000 -0.05em -0.03em' });
            break;
        case 'none':
            list.push({ name: 'text-shadow', value: 'none' });
            break;
        case 'dropshadow':
        default:
            list.push({ name: 'text-shadow', value: '#000000 0px 0px 7px' });
            break;
    }

    const background = settings.textBackground || 'transparent';
    if (background) {
        list.push({ name: 'background-color', value: background });
    }

    const textColor = settings.textColor || '#ffffff';
    if (textColor) {
        list.push({ name: 'color', value: textColor });
    }

    switch (settings.font || '') {
        case 'typewriter':
            list.push({ name: 'font-family', value: '"Courier New",monospace' });
            list.push({ name: 'font-variant', value: 'none' });
            break;
        case 'print':
            list.push({ name: 'font-family', value: 'Georgia,Times New Roman,Arial,Helvetica,serif' });
            list.push({ name: 'font-variant', value: 'none' });
            break;
        case 'console':
            list.push({ name: 'font-family', value: 'Consolas,Lucida Console,Menlo,Monaco,monospace' });
            list.push({ name: 'font-variant', value: 'none' });
            break;
        case 'cursive':
            list.push({ name: 'font-family', value: 'Lucida Handwriting,Brush Script MT,Segoe Script,cursive,Quintessential,system-ui,-apple-system,BlinkMacSystemFont,sans-serif' });
            list.push({ name: 'font-variant', value: 'none' });
            break;
        case 'casual':
            list.push({ name: 'font-family', value: 'Gabriola,Segoe Print,Comic Sans MS,Chalkboard,Short Stack,system-ui,-apple-system,BlinkMacSystemFont,sans-serif' });
            list.push({ name: 'font-variant', value: 'none' });
            break;
        case 'smallcaps':
            list.push({ name: 'font-family', value: 'Copperplate Gothic,Copperplate Gothic Bold,Copperplate,system-ui,-apple-system,BlinkMacSystemFont,sans-serif' });
            list.push({ name: 'font-variant', value: 'small-caps' });
            break;
        default:
            list.push({ name: 'font-family', value: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol' });
            list.push({ name: 'font-variant', value: 'none' });
            break;
    }

    return list;
}

/**
 * Styles for the layer element, which owns placement.
 *
 * The band the layer is appended to anchors it to the top or bottom of the screen and stacks
 * its children, so all that is left here is alignment within the band and the spacing value.
 *
 * The margin always goes on the side facing the band's edge, which makes it do double duty:
 * on the layer nearest the edge it is the distance from the screen, and on the layer stacked
 * beyond it the same margin becomes the gap between the two. It stays in this profile's own
 * em, which is what keeps the spacing predictable when its text size changes.
 */
function getWindowStyles(settings, preview) {
    const list = [];

    if (preview) return list;

    const placement = resolvePlacement(settings.position);
    // Placement is done with justify-content only. Setting align-self would stop the layer
    // stretching across its band, leaving it shrink-to-fit - and the inner element's
    // max-width percentage would then resolve against that, collapsing the text.
    list.push({ name: 'justify-content', value: getFlexAlign(placement.align) });

    const lines = Math.abs(parseInt(settings.verticalPosition, 10) || 0);
    const margin = `${lines * LINE_HEIGHT}em`;

    if (placement.band === 'bottom') {
        list.push({ name: 'margin-bottom', value: margin });
        list.push({ name: 'margin-top', value: '' });
    } else {
        list.push({ name: 'margin-bottom', value: '' });
        list.push({ name: 'margin-top', value: margin });
    }

    return list;
}

export function getStyles(settings, preview) {
    return {
        text: getTextStyles(settings),
        window: getWindowStyles(settings, preview)
    };
}

function applyStyleList(styles, elem) {
    for (let i = 0, length = styles.length; i < length; i++) {
        const style = styles[i];

        elem.style[style.name] = style.value;
    }
}

export function applyStyles(elements, appearanceSettings) {
    const styles = getStyles(appearanceSettings, !!elements.preview);

    if (elements.text) {
        applyStyleList(styles.text, elements.text);
    }
    if (elements.window) {
        applyStyleList(styles.window, elements.window);
    }
}
export default {
    getStyles: getStyles,
    applyStyles: applyStyles,
    getTextScale: getTextScale
};
