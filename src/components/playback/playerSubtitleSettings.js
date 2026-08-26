import {
    DEFAULT_SUBTITLE_POSITION,
    getLayerRoles
} from 'components/subtitlesettings/subtitlePlacement';
import globalize from 'lib/globalize';
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

        this.loadProfile();
        this.updateSubtitleLayout();
        this.element.querySelector('.playerSubtitleSettings-close').focus();
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

        this.updateSpacingLabel();
    }

    /**
     * The vertical position value means one of two things depending on how the two subtitles
     * are placed, so the label follows it: a distance from the screen edge normally, or the
     * gap to the subtitle below when this profile is stacked on top of the other one.
     */
    updateSpacingLabel() {
        const slider = this.element.querySelector('[data-setting="verticalPosition"]');
        const label = slider && this.element.querySelector(`label[for="${slider.id}"]`);
        if (!label) return;

        const roles = getLayerRoles(
            userSettings.getSubtitleAppearanceSettings().position,
            userSettings.getSubtitleAppearanceSettings(SECONDARY_SUBTITLE_APPEARANCE_KEY).position,
            this.options.hasSecondarySubtitle !== false
        );

        label.textContent = roles[this.activeProfile] === 'stacked' ?
            globalize.translate('LabelSubtitleSpacing') :
            globalize.translate('LabelSubtitleVerticalPosition');
    }

    selectProfile(profile) {
        if (!Object.prototype.hasOwnProperty.call(PROFILE_KEYS, profile) || profile === this.activeProfile) return;

        this.activeProfile = profile;
        let selectedButton;
        this.element.querySelectorAll('.playerSubtitleSettings-profile').forEach((button) => {
            const selected = button.dataset.profile === profile;
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            button.tabIndex = selected ? 0 : -1;
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

        if (field.dataset.setting === 'position') {
            this.updateSpacingLabel();
        }
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
        const profileButton = event.target.closest('.playerSubtitleSettings-profile');
        const tabKeys = [ 'ArrowLeft', 'ArrowRight', 'Home', 'End' ];
        if (profileButton && tabKeys.includes(event.key)) {
            const tabs = Array.from(this.element.querySelectorAll('.playerSubtitleSettings-profile'));
            const currentIndex = tabs.indexOf(profileButton);
            let nextIndex = event.key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = tabs.length - 1;
            nextIndex = (nextIndex + tabs.length) % tabs.length;

            event.preventDefault();
            tabs[nextIndex].focus();
            this.selectProfile(tabs[nextIndex].dataset.profile);
            return;
        }

        if (event.key === 'Escape') {
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
        window.removeEventListener('resize', this.updateSubtitleLayout);
        this.options.player?.setSubtitleSettingsOpen?.(false);
        document.documentElement.classList.remove('playerSubtitleSettings-open');
        this.element.remove();
        this.options = null;
    }
}
