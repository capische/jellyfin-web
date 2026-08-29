import escapeHtml from 'escape-html';
import dialogHelper from '../dialogHelper/dialogHelper';
import layoutManager from '../layoutManager';
import globalize from '../../lib/globalize';
import dom from '../../utils/dom';
import '../../elements/emby-button/emby-button';
import './actionSheet.scss';
import 'material-design-icons-iconfont';
import '../../styles/scrollstyles.scss';
import '../../components/listview/listview.scss';

interface OptionItem {
    asideText?: string;
    divider?: boolean;
    icon?: string;
    id?: string;
    innerText?: string;
    name?: string;
    secondaryText?: string;
    selected?: boolean;
    textContent?: string;
    value?: string;
}

interface TitleButton {
    icon: string;
    id: string;
    title: string;
}

interface Options {
    items: OptionItem[];
    /**
     * Render as a compact translucent box instead of taking over the whole
     * screen in the TV layout. Used by the player menus so the video stays
     * visible behind them.
     */
    boxed?: boolean;
    border?: boolean;
    callback?: (id: string) => void;
    dialogClass?: string;
    enableHistory?: boolean;
    entryAnimationDuration?: number;
    entryAnimation?: string;
    exitAnimationDuration?: number;
    exitAnimation?: string;
    menuItemClass?: string;
    offsetLeft?: number;
    offsetTop?: number;
    positionTo?: Element | null;
    positionY?: string;
    resolveOnClick?: boolean | (string | null)[];
    shaded?: boolean;
    showCancel?: boolean;
    text?: string;
    timeout?: number;
    title?: string;
    titleButton?: TitleButton;
}

interface Offset {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface DialogOptions {
    autoFocus?: boolean;
    enableHistory?: boolean;
    entryAnimationDuration?: number;
    entryAnimation?: string;
    exitAnimationDuration?: number;
    exitAnimation?: string;
    modal?: boolean;
    removeOnClose?: boolean;
    scrollY?: boolean;
    size?: string;
}

function getOffsets(elems: Element[]): Offset[] {
    const results: Offset[] = [];

    if (!document) {
        return results;
    }

    for (const elem of elems) {
        const box = elem.getBoundingClientRect();

        results.push({
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height
        });
    }

    return results;
}

function getPosition(positionTo: Element, options: Options, dlg: HTMLElement) {
    const windowSize = dom.getWindowSize();
    const windowHeight = windowSize.innerHeight;
    const windowWidth = windowSize.innerWidth;

    const pos = getOffsets([positionTo])[0];

    if (options.positionY !== 'top') {
        pos.top += (pos.height || 0) / 2;
    }

    pos.left += (pos.width || 0) / 2;

    const height = dlg.offsetHeight || 300;
    const width = dlg.offsetWidth || 160;

    // Account for popup size
    pos.top -= height / 2;
    pos.left -= width / 2;

    // Avoid showing too close to the bottom
    const overflowX = pos.left + width - windowWidth;
    const overflowY = pos.top + height - windowHeight;

    if (overflowX > 0) {
        pos.left -= (overflowX + 20);
    }
    if (overflowY > 0) {
        pos.top -= (overflowY + 20);
    }

    pos.top += (options.offsetTop || 0);
    pos.left += (options.offsetLeft || 0);

    // Do some boundary checking
    pos.top = Math.max(pos.top, 10);
    pos.left = Math.max(pos.left, 10);

    return pos;
}

function centerFocus(elem: Element, horiz: boolean, on: boolean) {
    import('../../scripts/scrollHelper').then((scrollHelper) => {
        const fn = on ? 'on' : 'off';
        scrollHelper.centerFocus[fn](elem, horiz);
    }).catch(e => {
        console.warn('Error in centerFocus', e);
    });
}

/* eslint-disable-next-line sonarjs/cognitive-complexity */
export function show(options: Options) {
    // items
    // positionTo
    // showCancel
    // title
    const dialogOptions: DialogOptions = {
        removeOnClose: true,
        enableHistory: options.enableHistory,
        scrollY: false
    };

    const boxed = !!options.boxed;
    // On TV the box is centered on screen rather than anchored to the button,
    // which would otherwise push it into a corner.
    const isCenteredBox = boxed && layoutManager.tv;
    let isFullscreen;

    if (layoutManager.tv && !boxed) {
        dialogOptions.size = 'fullscreen';
        isFullscreen = true;
        dialogOptions.autoFocus = true;
    } else {
        dialogOptions.modal = false;
        dialogOptions.entryAnimation = options.entryAnimation;
        dialogOptions.exitAnimation = options.exitAnimation;
        dialogOptions.entryAnimationDuration = options.entryAnimationDuration || 140;
        dialogOptions.exitAnimationDuration = options.exitAnimationDuration || 100;
        dialogOptions.autoFocus = layoutManager.tv;
    }

    const dlg = dialogHelper.createDialog(dialogOptions);

    if (isFullscreen) {
        dlg.classList.add('actionsheet-fullscreen');
    } else {
        dlg.classList.add('actionsheet-not-fullscreen');
    }

    dlg.classList.add('actionSheet');

    if (boxed) {
        dlg.classList.add('actionSheet-boxed');
    }

    if (options.dialogClass) {
        dlg.classList.add(options.dialogClass);
    }

    let html = '';

    const scrollClassName = layoutManager.tv ? 'scrollY smoothScrollY hiddenScrollY' : 'scrollY';
    let style = '';

    // Admittedly a hack but right now the scrollbar is being factored into the width which is causing truncation
    if (options.items.length > 20) {
        const minWidth = dom.getWindowSize().innerWidth >= 300 ? 240 : 200;
        style += 'min-width:' + minWidth + 'px;';
    }

    let renderIcon = false;
    const icons = [];
    let itemIcon;
    for (const item of options.items) {
        itemIcon = item.icon || (item.selected ? 'check' : null);

        if (itemIcon) {
            renderIcon = true;
        }
        icons.push(itemIcon || '');
    }

    if (isFullscreen) {
        html += `<button is="paper-icon-button-light" class="btnCloseActionSheet hide-mouse-idle-tv" tabindex="-1" title="${globalize.translate('ButtonBack')}">
                     <span class="material-icons arrow_back" aria-hidden="true"></span>
                 </button>`;
    }

    // If any items have an icon, give them all an icon just to make sure they're all lined up evenly
    const center = options.title && (!renderIcon /*|| itemsWithIcons.length != options.items.length*/);

    if (center || isFullscreen) {
        html += '<div class="actionSheetContent actionSheetContent-centered">';
    } else {
        html += '<div class="actionSheetContent">';
    }

    let titleHtml = '';
    if (options.title) {
        if (options.titleButton) {
            titleHtml += '<div class="actionSheetTitleRow">';
        }

        titleHtml += '<h1 class="actionSheetTitle">' + escapeHtml(options.title) + '</h1>';

        if (options.titleButton) {
            titleHtml += `<button is="paper-icon-button-light" type="button" class="actionSheetTitleButton" data-id="${escapeHtml(options.titleButton.id)}" title="${escapeHtml(options.titleButton.title)}" aria-label="${escapeHtml(options.titleButton.title)}">
                         <span class="material-icons ${escapeHtml(options.titleButton.icon)}" aria-hidden="true"></span>
                     </button>`;
            titleHtml += '</div>';
        }
    }

    // Spatial navigation cannot cross out of the scroller, which is a focus container, so a
    // title button left outside it is unreachable by remote however visible it looks. On TV
    // the title goes inside the scroller with the items, where the button is just another
    // focus stop above them.
    const titleInScroller = layoutManager.tv && !!options.titleButton;
    if (!titleInScroller) {
        html += titleHtml;
    }

    if (options.text) {
        html += '<p class="actionSheetText">' + escapeHtml(options.text) + '</p>';
    }

    let scrollerClassName = 'actionSheetScroller';
    if (layoutManager.tv) {
        scrollerClassName += ' focuscontainer-x focuscontainer-y';
    }
    if (isFullscreen) {
        scrollerClassName += ' actionSheetScroller-tv';
    }
    html += '<div class="' + scrollerClassName + ' ' + scrollClassName + '" style="' + style + '">';

    if (titleInScroller) {
        html += titleHtml;
    }

    let menuItemClass = 'listItem listItem-button actionSheetMenuItem';

    if (options.border || options.shaded) {
        menuItemClass += ' listItem-border';
    }

    if (options.menuItemClass) {
        menuItemClass += ' ' + options.menuItemClass;
    }

    if (layoutManager.tv) {
        menuItemClass += ' listItem-focusscale';
    }

    if (layoutManager.mobile) {
        menuItemClass += ' actionsheet-xlargeFont';
    }

    // 'options.items' is HTMLOptionsCollection, so no fancy loops
    for (let i = 0; i < options.items.length; i++) {
        const item = options.items[i];

        if (item.divider) {
            html += '<div class="actionsheetDivider"></div>';
            continue;
        }

        const autoFocus = item.selected && layoutManager.tv ? ' autoFocus' : '';

        // Check for null in case int 0 was passed in
        const optionId = item.id == null || item.id === '' ? item.value : item.id;
        html += '<button' + autoFocus + ' is="emby-button" type="button" class="' + menuItemClass + '" data-id="' + optionId + '">';

        itemIcon = icons[i];

        if (itemIcon) {
            html += `<span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons ${itemIcon}" aria-hidden="true"></span>`;
        } else if (renderIcon && !center) {
            html += '<span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons check" aria-hidden="true" style="visibility:hidden;"></span>';
        }

        html += '<div class="listItemBody actionsheetListItemBody">';

        html += '<div class="listItemBodyText actionSheetItemText">';
        html += escapeHtml(item.name || item.textContent || item.innerText);
        html += '</div>';

        if (item.secondaryText) {
            html += `<div class="listItemBodyText secondary">${escapeHtml(item.secondaryText)}</div>`;
        }

        html += '</div>';

        if (item.asideText) {
            html += `<div class="listItemAside actionSheetItemAsideText">${escapeHtml(item.asideText)}</div>`;
        }

        html += '</button>';
    }

    if (options.showCancel) {
        html += '<div class="buttons">';
        html += `<button is="emby-button" type="button" class="btnCloseActionSheet">${globalize.translate('ButtonCancel')}</button>`;
        html += '</div>';
    }
    html += '</div>';

    dlg.innerHTML = html;

    if (layoutManager.tv) {
        const scroller = dlg.querySelector('.actionSheetScroller');
        if (scroller) {
            centerFocus(scroller, false, true);
        }
    }

    const btnCloseActionSheet = dlg.querySelector('.btnCloseActionSheet');
    if (btnCloseActionSheet) {
        btnCloseActionSheet.addEventListener('click', function () {
            dialogHelper.close(dlg);
        });
    }

    let selectedId: string | null = null;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (options.timeout) {
        timeout = setTimeout(function () {
            dialogHelper.close(dlg);
        }, options.timeout);
    }

    return new Promise(function (resolve, reject) {
        let isResolved = false;

        dlg.addEventListener('click', function (e) {
            const actionSheetMenuItem = dom.parentWithClass(e.target as HTMLElement, 'actionSheetMenuItem')
                || dom.parentWithClass(e.target as HTMLElement, 'actionSheetTitleButton');

            if (actionSheetMenuItem) {
                selectedId = actionSheetMenuItem.getAttribute('data-id');

                if (options.resolveOnClick) {
                    if (Array.isArray(options.resolveOnClick)) {
                        if (options.resolveOnClick.indexOf(selectedId) !== -1) {
                            resolve(selectedId);
                            isResolved = true;
                        }
                    } else {
                        resolve(selectedId);
                        isResolved = true;
                    }
                }

                dialogHelper.close(dlg);
            }
        });

        dlg.addEventListener('close', function () {
            if (layoutManager.tv) {
                const scroller = dlg.querySelector('.actionSheetScroller');
                if (scroller) {
                    centerFocus(scroller, false, false);
                }
            }

            if (timeout) {
                clearTimeout(timeout);
                timeout = undefined;
            }

            if (!isResolved) {
                if (selectedId != null) {
                    if (options.callback) {
                        options.callback(selectedId);
                    }

                    resolve(selectedId);
                } else {
                    reject(new Error('ActionSheet closed without resolving'));
                }
            }
        });

        dialogHelper.open(dlg).catch(e => {
            console.warn('DialogHelper.open error', e);
        });

        const pos = options.positionTo && !isCenteredBox && dialogOptions.size !== 'fullscreen' ?
            getPosition(options.positionTo, options, dlg) :
            null;

        if (pos) {
            dlg.style.position = 'fixed';
            dlg.style.margin = '0';
            dlg.style.left = pos.left + 'px';
            dlg.style.top = pos.top + 'px';
        }
    });
}

export default {
    show: show
};
