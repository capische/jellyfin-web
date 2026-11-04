import React, { FC, useCallback } from 'react';
import Add from '@mui/icons-material/Add';
import Button from '@mui/material/Button';
import type { QueryKey } from '@tanstack/react-query';

import type { ActionRenderer } from 'apps/modern/features/jellyfinmod/design/Action';
import globalize from 'lib/globalize';
import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

interface NewCollectionButtonProps {
    isTextVisible: boolean
    queryKey: QueryKey
    renderButton?: ActionRenderer
}

const NewCollectionButton: FC<NewCollectionButtonProps> = ({
    isTextVisible,
    queryKey,
    renderButton
}) => {
    const { serverId } = useApi();

    const showCollectionEditor = useCallback(() => {
        import('components/collectionEditor/collectionEditor')
            .then(async ({ default: CollectionEditor }) => {
                const collectionEditor = new CollectionEditor();
                try {
                    await collectionEditor.show({
                        items: [],
                        serverId
                    });
                    void queryClient.invalidateQueries({ queryKey });
                } catch {
                    //closed collection editor
                }
            })
            .catch(err => {
                console.error('[NewCollection] failed to load collection editor', err);
            });
    }, [ queryKey, serverId ]);

    if (renderButton) return renderButton({ onClick: showCollectionEditor, title: globalize.translate('NewCollection') });

    return (
        <Button
            variant='contained'
            size={isTextVisible ? undefined : 'small'}
            startIcon={isTextVisible ? <Add /> : undefined}
            onClick={showCollectionEditor}
        >
            {isTextVisible ? (
                globalize.translate('NewCollection')
            ) : (
                <Add />
            )}
        </Button>
    );
};

export default NewCollectionButton;
