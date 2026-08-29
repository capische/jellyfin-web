import { attachSliderValue } from 'components/subtitlesettings/sliderValue';
import { DEFAULT_SUBTITLE_POSITION } from 'components/subtitlesettings/subtitlePlacement';
import layoutManager from 'components/layoutManager';
import globalize from 'lib/globalize';
import keyboardnavigation from 'scripts/keyboardNavigation';
import {
    currentSettings as userSettings,
    SECONDARY_SUBTITLE_APPEARANCE_KEY
} from 'scripts/settings/userSettings';

import '../../elements/emby-button/emby-button';
import '../../elements/emby-button/paper-icon-button-light';
import '../../elements/emby-input/emby-input';
import '../../elements/emby-select/emby-select';
import '../../elements/emby-slider/emby-slider';
import './playerSubtitleSettings.scss';
import template from './playerSubtitleSettings.template.html';

const PROFILE_KEYS = {
    primary: undefined,
    secondary: SECONDARY_SUBTITLE_APPEARANCE_KEY
};

export default class PlayerSubtitleSettings {
    constructor(options) {
        this.options = options;
        this.activeProfile = 'primary';
        this.element = document.createElement('div');
        // 'boxedSelectMenus' keeps the select action sheets compact so the panel
        // and the video behind it stay visible while picking a value.
        this.element.classList.add('playerSubtitleSettings', 'boxedSelectMenus');
        this.element.innerHTML = globalize.translateHtml(template, 'core');

        this.onClick = this.onClick.bind(this);
        this.onFieldChange = this.onFieldChange.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.updateSubtitleLayout = this.updateSubtitleLayout.bind(this);

        this.element.addEventListener('click', this.onClick);
        this.element.addEventListener('keydown', this.onKeyDown);
        // Bound per field rather than delegated: where a native dropdown is unavailable
        // (webOS, Tizen) emby-select dispatches a non-bubbling synthetic 'change', which
        // would never reach a listener on the container.
        this.fields = Array.from(this.element.querySelectorAll('.playerSubtitleSettings-field'));
        this.fields.forEach((field) => {
            field.addEventListener('change', this.onFieldChange);
            field.addEventListener('input', this.onFieldChange);
        });
        document.documentElement.classList.add('playerSubtitleSettings-open');
        options.container.appendChild(this.element);
        window.addEventListener('resize', this.updateSubtitleLayout);

        this.sliderValue = attachSliderValue(
            this.element.querySelector('[data-setting="verticalPosition"]'));
        this.loadProfile();
        this.setupTvNavigation();
        this.updateSubtitleLayout();
        this.element.querySelector('.playerSubtitleSettings-close').focus();
    }

    /**
     * Open the panel up to a remote.
     *
     * Spatial navigation skips a range input outright, and skips anything carrying
     * tabindex="-1" - which between them hid the vertical position slider and whichever
     * profile tab was not currently selected. Both are opt-in, so only the TV layout pays
     * for them.
     */
    setupTvNavigation() {
        if (!layoutManager.tv) return;

        // Without this the panel is not a focus container, so spatial navigation resolves
        // against the whole document: it wanders off into the player controls behind the
        // panel - SyncPlay and friends - and several of the panel's own stops become
        // unreachable because something in the background wins on distance. Dialogs get
        // this from dialogHelper; the panel is not one, so it says so itself.
        this.element.classList.add('focuscontainer');

        this.element.querySelectorAll('.playerSubtitleSettings-profile').forEach((button) => {
            button.tabIndex = 0;
        });

        const slider = this.element.querySelector('[data-setting="verticalPosition"]');

        // The custom element is only upgraded once the panel is in the document, so its
        // methods are not there yet on this tick.
        setTimeout(() => {
            slider.classList.add('focusable');
            slider.enableKeyboardDragging?.();
        }, 0);
    }

    get appearanceKey() {
        return PROFILE_KEYS[this.activeProfile];
    }

    loadProfile() {
        const settings = userSettings.getSubtitleAppearanceSettings(this.appearanceKey);
        const fields = this.element.querySelectorAll('.playerSubtitleSettings-field');
        fields.forEach((field) => {
            const value = settings[field.dataset.setting];
            if (field.type === 'color') {
                field.value = value || '#ffffff';
            } else if (field.dataset.setting === 'verticalPosition') {
                field.value = value ?? 0;
            } else if (field.dataset.setting === 'textWeight') {
                field.value = value || 'normal';
            } else if (field.dataset.setting === 'position') {
                field.value = value || DEFAULT_SUBTITLE_POSITION;
            } else {
                field.value = value || '';
            }
        });

        this.sliderValue?.update();
    }

    selectProfile(profile) {
        if (!Object.prototype.hasOwnProperty.call(PROFILE_KEYS, profile) || profile === this.activeProfile) return;

        this.activeProfile = profile;
        let selectedButton;
        this.element.querySelectorAll('.playerSubtitleSettings-profile').forEach((button) => {
            const selected = button.dataset.profile === profile;
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            // A roving tabindex is what a keyboard expects, but it hides the unselected tab
            // from spatial navigation, which is the only way a remote can reach it.
            button.tabIndex = selected || layoutManager.tv ? 0 : -1;
            if (selected) {
                selectedButton = button;
            }
        });
        this.element.querySelector('.playerSubtitleSettings-fields').setAttribute('aria-labelledby', selectedButton.id);
        this.loadProfile();
    }

    onFieldChange(event) {
        const field = event.currentTarget;

        const settings = userSettings.getSubtitleAppearanceSettings(this.appearanceKey);
        settings[field.dataset.setting] = field.value;
        userSettings.setSubtitleAppearanceSettings(settings, this.appearanceKey);
        this.options.player?.updateSubtitleAppearance?.();
    }

    onClick(event) {
        const profileButton = event.target.closest('.playerSubtitleSettings-profile');
        if (profileButton) {
            this.selectProfile(profileButton.dataset.profile);
            return;
        }

        if (event.target.closest('.playerSubtitleSettings-reset')) {
            userSettings.setSubtitleAppearanceSettings({}, this.appearanceKey);
            this.loadProfile();
            this.options.player?.updateSubtitleAppearance?.();
            return;
        }

        if (event.target.closest('.playerSubtitleSettings-close')
            || event.target.closest('.playerSubtitleSettings-save')) {
            this.options.onClose?.();
        }
    }

    onKeyDown(event) {
        // Remotes and gamepads report keys a browser keyboard never would, so the name has
        // to be normalised before it can be compared.
        const key = keyboardnavigation.getKeyName(event);
        const profileButton = event.target.closest('.playerSubtitleSettings-profile');
        const tabKeys = [ 'ArrowLeft', 'ArrowRight', 'Home', 'End' ];

        if (profileButton && tabKeys.includes(key)) {
            const tabs = Array.from(this.element.querySelectorAll('.playerSubtitleSettings-profile'));
            const currentIndex = tabs.indexOf(profileButton);
            let nextIndex = key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1;
            if (key === 'Home') nextIndex = 0;
            if (key === 'End') nextIndex = tabs.length - 1;
            nextIndex = (nextIndex + tabs.length) % tabs.length;

            event.preventDefault();
            tabs[nextIndex].focus();
            this.selectProfile(tabs[nextIndex].dataset.profile);
            return;
        }

        // 'Back' is what a webOS or Tizen remote sends, and it is not aliased to Escape.
        // Without it the panel ignores the key and the player's global handler takes it as
        // a request to leave playback altogether - and now that focus cannot wander out of
        // the panel, this is the way out of it.
        if (key === 'Escape' || key === 'Back') {
            event.preventDefault();
            this.options.onClose?.();
        }
    }

    updateSubtitleLayout() {
        this.options.player?.setSubtitleSettingsOpen?.(true, this.element.getBoundingClientRect().width);
    }

    destroy() {
        this.element.removeEventListener('click', this.onClick);
        this.element.removeEventListener('keydown', this.onKeyDown);
        this.fields.forEach((field) => {
            field.removeEventListener('change', this.onFieldChange);
            field.removeEventListener('input', this.onFieldChange);
        });
        this.sliderValue?.destroy();
        window.removeEventListener('resize', this.updateSubtitleLayout);
        this.options.player?.setSubtitleSettingsOpen?.(false);
        document.documentElement.classList.remove('playerSubtitleSettings-open');
        this.element.remove();
        this.options = null;
    }
}
