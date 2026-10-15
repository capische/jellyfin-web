import type { Api } from '@jellyfin/sdk/lib/api';
import Button from '@mui/material/Button';
import React, { type FC, useCallback, useEffect, useState } from 'react';

import { request } from './settingsApi';

/** One download client Prowlarr knows, as `GET Settings/Prowlarr/{id}/DownloadClients` answers it: never a password. */
export interface ProwlarrClient {
    implementation: string;
    name: string;
    enabled: boolean;
    host: string | null;
    port: number | null;
    useSsl: boolean;
    urlBase: string | null;
    username: string | null;
    /** Set only for a client this plugin can drive (Transmission). */
    kind: string | null;
    /** The RPC address the plugin's Transmission client expects, built from Prowlarr's fields. */
    baseUrl: string | null;
}

interface FoundClients {
    code: string;
    clients: ProwlarrClient[];
    gateway: string | null;
}

/** Test failures that mean the address did not answer from this server, as the client Test records them. */
const UNREACHABLE = ['client_unreachable', 'timeout'];

/** The same address with Jellyfin's default gateway as its host, or null when it cannot be built. */
const onGateway = (baseUrl: string, gateway: string) => {
    try {
        const url = new URL(baseUrl);
        url.hostname = gateway;
        return url.toString();
    } catch {
        return null;
    }
};

const UseButton: FC<{ client: ProwlarrClient; onFill: (client: ProwlarrClient) => void }> = ({ client, onFill }) => {
    const use = useCallback(() => onFill(client), [client, onFill]);
    return (
        <Button variant='contained' color='inherit' onClick={use} data-prowlarr-client={client.name}>
            {`Use ${client.name} from Prowlarr (${client.host}:${client.port})`}
        </Button>
    );
};

/**
 * The Download Client step's "Found in Prowlarr" (P6.FU1, user 2026-10-15): once the Indexers step has a Prowlarr source
 * with a saved key, the download clients that Prowlarr knows are offered here, one button each, and a button only fills the
 * form; the admin types the password, and the section's own Save and Test decide. When the saved client came from Prowlarr
 * and its Test could not reach it, the same port on this server's default gateway is offered once, as a suggestion. With
 * no Prowlarr, no client in it, a Prowlarr that does not answer, or a client already verified, nothing is shown.
 */
export const FoundInProwlarr: FC<{
    api: Api;
    source?: { id: string; apiKeyConfigured?: boolean; revision?: number };
    client?: { verified?: boolean; lastError?: string | null; baseUrl?: string };
    onFill: (client: ProwlarrClient) => void;
}> = ({ api, source, client, onFill }) => {
    const [found, setFound] = useState<FoundClients | null>(null);
    const wanted = !!source?.apiKeyConfigured && !client?.verified;
    const sourceId = source?.id;
    const sourceRevision = source?.revision;
    useEffect(() => {
        if (!wanted || !sourceId) {
            setFound(null);
            return;
        }
        let live = true;
        // A plugin without the read (404), or a Prowlarr that fails, shows nothing: no error noise here.
        request<FoundClients>(api, 'GET', `Settings/Prowlarr/${sourceId}/DownloadClients`)
            .then(answer => { if (live) setFound(answer); })
            .catch(() => { if (live) setFound(null); });
        return () => {
            live = false;
        };
    }, [api, wanted, sourceId, sourceRevision]);
    const usable = (found?.clients ?? []).filter(item => item.kind && item.baseUrl);
    const unsupported = (found?.clients ?? []).filter(item => !item.kind);
    // The saved client is one Prowlarr gave, its Test could not reach it, and the gateway is another host: try that, once.
    const from = client && !client.verified && UNREACHABLE.includes(client.lastError ?? '') && found?.gateway ?
        usable.find(item => item.baseUrl === (client.baseUrl ?? null) && item.host !== found.gateway) : undefined;
    const gatewayUrl = from && found?.gateway ? onGateway(from.baseUrl!, found.gateway) : null;
    const tryGateway = useCallback(() => {
        if (from && gatewayUrl && found?.gateway) onFill({ ...from, host: found.gateway, baseUrl: gatewayUrl });
    }, [from, gatewayUrl, found, onFill]);
    if (!wanted || (!usable.length && !unsupported.length)) return null;
    return (
        <div className='jfmod-group' data-prowlarr='found'>
            <h3 className='jfmod-grouptitle'>Found in Prowlarr</h3>
            {from && gatewayUrl && (
                // A sentence and a button below it rather than a notice with its action beside it, which squeezed the
                // sentence into a narrow column on a phone.
                <div data-prowlarr='gateway'>
                    <p className='jfmod-lead fieldDescription'>
                        {`${from.host}:${from.port}, Prowlarr's address for it, did not answer from this server. `
                            + 'A client published on the Docker host often answers on the gateway instead.'}
                    </p>
                    <div className='jfmod-inlineactions'>
                        <Button variant='contained' color='inherit' onClick={tryGateway}>{`Try ${found!.gateway}:${from.port}`}</Button>
                    </div>
                </div>
            )}
            {!!usable.length && (
                <>
                    <p className='jfmod-lead fieldDescription'>Fills the form below. Type the password if the client has one, then Save and Test.</p>
                    <div className='jfmod-inlineactions'>
                        {usable.map(item => <UseButton key={item.name} client={item} onFill={onFill} />)}
                    </div>
                </>
            )}
            {!!unsupported.length && (
                <p className='jfmod-lead fieldDescription' data-prowlarr='unsupported'>
                    {'Not supported yet: ' + unsupported.map(item => `${item.name} (${item.implementation})`).join(', ') + '.'}
                </p>
            )}
        </div>
    );
};
