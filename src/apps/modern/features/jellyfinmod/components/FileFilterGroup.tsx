import React, { useCallback } from 'react';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import type { LibraryViewSettings } from 'types/library';

const options = [
    { label: 'On disk', states: ['onDisk'] },
    { label: 'Not downloaded', states: ['none'] },
    { label: 'Downloading', states: ['searching', 'grabbed', 'downloading'] },
    { label: 'Reclaimed', states: ['reclaimed'] }
];

interface Props {
    libraryViewSettings: LibraryViewSettings;
    setLibraryViewSettings: React.Dispatch<React.SetStateAction<LibraryViewSettings>>;
}

export default function FileFilterGroup({ libraryViewSettings, setLibraryViewSettings }: Readonly<Props>) {
    const selected = libraryViewSettings.Filters?.FileStates ?? [];
    const change = useCallback((event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
        const states = options.find(option => option.label === event.target.value)?.states;
        if (!states) return;
        setLibraryViewSettings(previous => {
            const values = (previous.Filters?.FileStates ?? []).filter(state => !states.includes(state));
            if (checked) values.push(...states);
            return {
                ...previous,
                StartIndex: 0,
                Filters: { ...previous.Filters, FileStates: values.length ? values : undefined }
            };
        });
    }, [setLibraryViewSettings]);
    return (
        <FormGroup>
            {options.map(({ label, states }) => (
                <FormControlLabel
                    key={label}
                    label={label}
                    control={
                        <Checkbox
                            checked={states.every(state => selected.includes(state))}
                            value={label}
                            onChange={change}
                        />
                    }
                />
            ))}
        </FormGroup>
    );
}
