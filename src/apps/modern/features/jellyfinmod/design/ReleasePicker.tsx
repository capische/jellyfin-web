import React, { type FC, useContext, useEffect, useState } from 'react';
import ReleasePickerDialog, { type ReleasePickerProps } from '../components/ReleasePickerDialog';
import { getDownloadClientLink } from '../api/modApi';
import { DesignContext, Root } from './Root';
import { ReleaseGlyph } from './Release';

const NAMES_KEY = 'jfmod-releaseNames';
const readNames = () => {
    try {
        return localStorage.getItem(NAMES_KEY) === '1';
    } catch {
        return false;
    }
};
const Picker: FC<ReleasePickerProps & { close: () => void }> = props => {
    const [names, setNames] = useState(readNames);
    const [slot, setSlot] = useState<HTMLSpanElement | null>(null);
    const [client, setClient] = useState<{ name: string; openUrl: string } | null>(null);
    const device = useContext(DesignContext);
    useEffect(() => {
        let live = true;
        getDownloadClientLink(props.api).then(value => {
            if (live) setClient(value);
        }).catch(() => undefined);
        return () => {
            live = false;
        };
    }, [props.api]);
    const toggle = () => {
        setNames(current => {
            try {
                localStorage.setItem(NAMES_KEY, current ? '0' : '1');
            } catch { /* A browser without storage forgets the choice. */ }
            return !current;
        });
    };
    const label = names ? 'Hide Names' : 'Show Names';
    return <div data-ds-dialog='' className='dialog wide pickerDialog' role='dialog' aria-modal='true' aria-label={props.intent === 'addVersion' ? 'Get Another Quality' : 'Get a Release'}>
        <div className='dlghead'><h3>{props.intent === 'addVersion' ? 'Get Another Quality' : 'Get a Release'}<small>{props.title}</small></h3>
            <span ref={setSlot} className='sourcesSlot' />
            <button type='button' className={'rb focusable' + (names ? ' on' : '')} title={label} aria-label={label} aria-pressed={names} onClick={toggle}><ReleaseGlyph name='names' /></button>
            {client && device !== 'tv' && <a className='rb focusable' href={client.openUrl} target='_blank' rel='noopener noreferrer' title={'Open ' + client.name} aria-label={'Open ' + client.name}><ReleaseGlyph name='client' /></a>}
            <button type='button' className='rb focusable' title='Close' aria-label='Close' onClick={props.close}><ReleaseGlyph name='close' /></button>
        </div>
        <div className='dlgbody'><ReleasePickerDialog {...props} sourcesSlot={slot ?? undefined} showNames={names} /></div>
    </div>;
};
export const ReleasePicker: FC<ReleasePickerProps & { close: () => void }> = props => <Root className='dialogportal'><Picker {...props} /></Root>;
