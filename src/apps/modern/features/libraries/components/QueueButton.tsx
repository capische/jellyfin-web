import React, { FC, useCallback } from 'react';
import Button from '@mui/material/Button';
import Queue from '@mui/icons-material/Queue';

import { playbackManager } from 'components/playback/playbackmanager';
import type { ActionRenderer } from 'apps/modern/features/jellyfinmod/design/Action';
import globalize from 'lib/globalize';
import type { ItemDto } from 'types/base/models/item-dto';

interface QueueButtonProps {
    item: ItemDto | undefined
    items: ItemDto[]
    hasFilters: boolean
    isTextVisible: boolean
    renderButton?: ActionRenderer
}

const QueueButton: FC<QueueButtonProps> = ({
    item,
    items,
    hasFilters,
    isTextVisible,
    renderButton
}) => {
    const queue = useCallback(() => {
        if (item && !hasFilters) {
            playbackManager.queue({
                items: [item]
            }).catch(err => {
                console.error('[QueueButton] failed to add to queue', err);
            });
        } else {
            playbackManager.queue({
                items
            }).catch(err => {
                console.error('[QueueButton] failed to add to queue', err);
            });
        }
    }, [hasFilters, item, items]);

    if (renderButton) return renderButton({ onClick: queue, title: globalize.translate('AddToPlayQueue') });

    return (
        <Button
            title={globalize.translate('AddToPlayQueue')}
            startIcon={isTextVisible ? <Queue /> : undefined}
            onClick={queue}
        >
            {isTextVisible ? (
                globalize.translate('AddToPlayQueue')
            ) : (
                <Queue />
            )}
        </Button>
    );
};

export default QueueButton;
