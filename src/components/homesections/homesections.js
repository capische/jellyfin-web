import layoutManager from 'components/layoutManager';
import { DEFAULT_SECTIONS, HomeSectionType } from 'constants/homeSectionType';
import { getUserViewsQuery } from 'hooks/api/useUserViews';
import globalize from 'lib/globalize';
import ServerConnections from 'lib/jellyfin-apiclient/ServerConnections';
import Dashboard from 'utils/dashboard';
import { queryClient } from 'utils/query/queryClient';

import { loadRecordings } from './sections/activeRecordings';
import { loadLibraryButtons } from './sections/libraryButtons';
import { loadLibraryTiles } from './sections/libraryTiles';
import { loadLiveTV } from './sections/liveTv';
import { loadRecentlyAdded } from './sections/recentlyAdded';
import { loadResume } from './sections/resume';
import { mountContinueRow, mountRecentRow, unmountHomeRows } from 'apps/modern/features/jellyfinmod/integration/homeSections';

import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-itemscontainer/emby-itemscontainer';
import 'elements/emby-scroller/emby-scroller';
import 'elements/emby-button/emby-button';

import './homesections.scss';

const MAX_SECTIONS = 10;
const MAX_SECTIONS_TV = MAX_SECTIONS + 1; // TV layout can have an extra section to ensure a library section is always visible

export function getDefaultSection(index) {
    if (index < 0 || index > DEFAULT_SECTIONS.length) return '';
    return DEFAULT_SECTIONS[index];
}

function getAllSectionsToShow(userSettings) {
    const sections = [];
    for (let i = 0, length = MAX_SECTIONS; i < length; i++) {
        let section = userSettings.get('homesection' + i) || getDefaultSection(i);
        if (section === 'folders') {
            section = getDefaultSection(0);
        }

        sections.push(section);
    }

    // Ensure libraries are visible in TV layout
    if (
        layoutManager.tv
            && !sections.includes(HomeSectionType.SmallLibraryTiles)
            && !sections.includes(HomeSectionType.LibraryButtons)
    ) {
        return [
            HomeSectionType.SmallLibraryTiles,
            ...sections
        ];
    }

    return sections;
}

export function loadSections(elem, apiClient, user, userSettings) {
    const api = ServerConnections.getApi(apiClient.serverId());
    const userId = user.Id || apiClient.getCurrentUserId();
    return queryClient
        .fetchQuery(getUserViewsQuery(api, { userId }))
        .then(result => result.Items || [])
        .then(function (userViews) {
            let html = '';

            if (userViews.length) {
                // TV layout can have an extra section to ensure libraries are visible
                const totalSectionCount = layoutManager.tv ? MAX_SECTIONS_TV : MAX_SECTIONS;
                for (let i = 0; i < totalSectionCount; i++) {
                    html += '<div class="verticalSection section' + i + '"></div>';
                }

                elem.innerHTML = html;
                elem.classList.add('homeSectionsContainer');

                const selectedSections = getAllSectionsToShow(userSettings);
                const promises = selectedSections
                    .map((section, index) => (
                        loadSection(elem, apiClient, user, userSettings, userViews, section, index, selectedSections)
                    ));

                return Promise.all(promises)
                    // Timeout for polyfilled CustomElements (webOS 1.2)
                    .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
                    .then(() => resume(elem, { refresh: true }));
            } else {
                let noLibDescription;
                if (user.Policy?.IsAdministrator) {
                    noLibDescription = globalize.translate('NoCreatedLibraries', '<br><a id="button-createLibrary" class="button-link">', '</a>');
                } else {
                    noLibDescription = globalize.translate('AskAdminToCreateLibrary');
                }

                html += '<div class="centerMessage padded-left padded-right">';
                html += '<h2>' + globalize.translate('MessageNothingHere') + '</h2>';
                html += '<p>' + noLibDescription + '</p>';
                html += '</div>';
                elem.innerHTML = html;

                const createNowLink = elem.querySelector('#button-createLibrary');
                if (createNowLink) {
                    createNowLink.addEventListener('click', function () {
                        Dashboard.navigate('dashboard/libraries');
                    });
                }
            }
        });
}

export function destroySections(elem) {
    unmountHomeRows(elem);
    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.fetchData = null;
        e.parentContainer = null;
        e.getItemsHtml = null;
    }

    elem.innerHTML = '';
}

export function pause(elem) {
    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.pause();
    }
}

export function resume(elem, options) {
    const elems = elem.querySelectorAll('.itemsContainer');
    const promises = [];

    Array.prototype.forEach.call(elems, section => {
        if (section.resume) {
            promises.push(section.resume(options));
        }
    });

    return Promise.all(promises);
}

// Home composition needs both the selected slot and the complete selection to preserve ordering.
// eslint-disable-next-line max-params
function loadSection(page, apiClient, user, userSettings, userViews, section, index, selectedSections) {
    const elem = page.querySelector('.section' + index);
    const options = { enableOverflow: enableScrollX() };

    switch (section) {
        case HomeSectionType.ActiveRecordings:
            loadRecordings(elem, true, apiClient, options);
            break;
        case HomeSectionType.LatestMedia: {
            elem.classList.add('jfmod-homeSectionMount');
            const visibleViews = userViews.filter(view => !(user.Configuration?.LatestItemsExcludes ?? []).includes(view.Id));
            mountRecentRow(elem, visibleViews);
            const otherViews = visibleViews.filter(view => view.CollectionType !== 'movies' && view.CollectionType !== 'tvshows');
            if (otherViews.length) {
                const other = document.createElement('div');
                elem.appendChild(other);
                loadRecentlyAdded(other, apiClient, user, otherViews, options);
            }
            break;
        }
        case HomeSectionType.LibraryButtons:
            loadLibraryButtons(elem, userViews);
            break;
        case HomeSectionType.LiveTv:
            return loadLiveTV(elem, apiClient, user, options);
        case HomeSectionType.NextUp:
            if (index === selectedSections.findIndex(value => value === HomeSectionType.NextUp || value === HomeSectionType.Resume)) {
                elem.classList.add('jfmod-homeSectionMount');
                mountContinueRow(elem, selectedSections.includes(HomeSectionType.Resume), true);
            } else {
                elem.innerHTML = '';
            }
            break;
        case HomeSectionType.Resume:
            if (index === selectedSections.findIndex(value => value === HomeSectionType.NextUp || value === HomeSectionType.Resume)) {
                elem.classList.add('jfmod-homeSectionMount');
                mountContinueRow(elem, true, selectedSections.includes(HomeSectionType.NextUp));
            } else {
                elem.innerHTML = '';
            }
            break;
        case HomeSectionType.ResumeAudio:
            loadResume(elem, apiClient, 'HeaderContinueListening', 'Audio', userSettings, options);
            break;
        case HomeSectionType.ResumeBook:
            loadResume(elem, apiClient, 'HeaderContinueReading', 'Book', userSettings, options);
            break;
        case HomeSectionType.SmallLibraryTiles:
            loadLibraryTiles(elem, userViews, options);
            break;
        default:
            elem.innerHTML = '';
    }

    return Promise.resolve();
}

function enableScrollX() {
    return true;
}

export default {
    getDefaultSection,
    loadSections,
    destroySections,
    pause,
    resume
};
