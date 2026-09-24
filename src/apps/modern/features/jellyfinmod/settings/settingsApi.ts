import type { Api } from '@jellyfin/sdk/lib/api';
import { isAxiosError } from 'axios';

/**
 * The typed settings contract of P7.S7, as the settings area and the first-run wizard use it. Every read is
 * write-only for secrets: the server reports `...Configured`, never a value, and nothing here ever holds one
 * longer than the request that sends it.
 */

const BASE = '/JellyfinMod/';

/** A refused request, carrying the server's own code and sentence (and blockers for `acquisition_not_ready`). */
export interface SettingsProblem {
    jfmodSettingsProblem: true;
    status: number;
    type: string;
    message: string;
    blockers: string[];
}

// A plain object rather than an Error subclass: the build transpiles classes, and `instanceof` on a transpiled
// subclass of Error is unreliable, which would turn every 409 into a generic failure.
const problem = (status: number, type: string, message: string, blockers: string[] = []): SettingsProblem =>
    ({ jfmodSettingsProblem: true, status, type, message, blockers });

export const isSettingsProblem = (error: unknown): error is SettingsProblem =>
    typeof error === 'object' && error !== null && (error as SettingsProblem).jfmodSettingsProblem === true;

const headers = (api: Api) => (api.authorizationHeader ? { Authorization: api.authorizationHeader } : undefined);

export const request = async <T>(api: Api, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown): Promise<T> => {
    try {
        const response = await api.axiosInstance.request<T>({ method, url: api.basePath + BASE + path, data, headers: headers(api) });
        return response.data;
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            const body = (error.response.data ?? {}) as { type?: string; title?: string; blockers?: string[] };
            throw problem(error.response.status, body.type ?? '', body.title ?? `The request failed (${error.response.status}).`,
                body.blockers ?? []);
        }
        throw problem(0, 'unreachable', 'The server could not be reached.');
    }
};

export interface SecretChange {
    action: 'unchanged' | 'replace' | 'clear';
    value?: string | null;
}

export interface ConnectionTest {
    ok: boolean;
    code: string;
    message: string;
    version?: string | null;
    apiVersion?: string | null;
}

export interface SettingsArea {
    id: string;
    ready: boolean;
    enabled?: boolean;
    blockers: string[];
    revision?: number;
}

export interface SetupStep {
    id: string;
    status: 'done' | 'pending' | 'blocked';
    optional: boolean;
    reasons: string[];
}

export interface SetupState {
    complete: boolean;
    completedAt?: string;
    dismissedAt?: string;
    steps: SetupStep[];
}

export interface Overview {
    plugin: { version?: string; revision?: string };
    web?: { bundleId?: string; webCommit?: string; builtAt?: string; retainedBundleIds?: string[]; takeover?: string; takeoverBlocker?: string };
    areas: SettingsArea[];
    setup: SetupState;
}

// ---- Copy. One sentence per machine code, shared by the rail, the sections and the wizard (PHASE7 §5.1). ----

export const BLOCKER_SENTENCES: Record<string, string> = {
    no_verified_indexer: 'No enabled indexer has verified its capabilities.',
    no_download_client: 'No download client is selected.',
    download_client_disabled: 'The download client is turned off.',
    download_client_unverified: 'The download client changed since its last successful test.',
    download_client_driver_missing: 'This plugin build has no driver for that download client kind.',
    no_default_profile: 'No default quality profile is selected.',
    discovery_token_missing: 'No TMDB Read Access Token is saved.',
    discovery_unverified: 'The TMDB token has not passed a test since it changed.',
    path_mapping_unverified: 'A path mapping has not been verified.',
    acquisition_disabled: 'Grabbing is turned off.',
    acquisition_not_ready: 'Grabbing cannot be turned on yet.',
    seed_protection_unconfigured: 'Seed protection has no Transmission to read, so reclamation is blocked.',
    retention_selected_user_missing: 'The user retention waits for is unavailable.'
};

export const BLOCKER_SECTIONS: Record<string, string> = {
    no_verified_indexer: 'indexers',
    no_download_client: 'client',
    download_client_disabled: 'client',
    download_client_unverified: 'client',
    download_client_driver_missing: 'client',
    path_mapping_unverified: 'client',
    no_default_profile: 'profiles',
    discovery_token_missing: 'discovery',
    discovery_unverified: 'discovery',
    acquisition_disabled: 'grabbing',
    acquisition_not_ready: 'grabbing',
    seed_protection_unconfigured: 'retention',
    retention_selected_user_missing: 'retention'
};

export const PAUSE_SENTENCES: Record<string, string> = {
    disabled: 'automation is off',
    budget_grabs: 'the daily automatic grab budget is used up',
    budget_indexer: 'an indexer is out of searches for today',
    breaker_open: 'an indexer is paused by its circuit breaker',
    free_space_floor: 'the library disk is at its free-space floor',
    too_many_open_imports: 'too many imports are still open',
    client_unreachable: 'the download client could not be reached on the last run',
    acquisition_not_ready: 'grabbing is not ready'
};

export const PATH_SENTENCES: Record<string, string> = {
    ok: 'The folder can receive a hardlink from the library mount.',
    linked: 'A test hardlink was created and removed.',
    path_unmapped: 'No mapping turns this client path into a local path.',
    local_path_missing: 'The mapped folder does not exist or cannot be read.',
    cross_filesystem: 'This folder is on a different filesystem from every library, so imports through it cannot hardlink.',
    library_root_missing: 'No movie or TV library folder was found to link into.',
    mapping_inside_library: 'A mapped download folder must not be inside a library folder; the library would scan partial downloads.',
    mapping_contains_library: 'A mapped download folder must not contain a library folder.',
    destination_inside_library: 'The download folder is inside a library folder.',
    destination_not_same_filesystem: 'The download folder is on a different filesystem from the libraries.'
};

export const CONFLICT_MESSAGE = 'These settings changed somewhere else since this page loaded. Reload to see the current values, then save again.';

export const blockerSentence = (code: string) => BLOCKER_SENTENCES[code] ?? `Blocked: ${code}.`;
export const pathSentence = (code: string) => PATH_SENTENCES[code] ?? `The probe reported ${code}.`;

/** The failure text a section shows: the conflict sentence for a stale revision, else the server's own title. */
export const problemText = (error: unknown) => {
    if (isSettingsProblem(error)) {
        if (error.type === 'revision_conflict') return CONFLICT_MESSAGE;
        const blockers = error.blockers.map(blockerSentence).join(' ');
        return blockers ? `${error.message} ${blockers}` : `${error.message}${error.type ? ` (${error.type})` : ''}`;
    }
    return 'The request failed.';
};

export const when = (value?: string | null) => (value ? new Date(value).toLocaleString() : 'never');
