import { DesignContext } from 'apps/modern/features/jellyfinmod/design/Root';
import { Cell } from 'apps/modern/features/jellyfinmod/design/Cell';
import React, { type FC, useContext } from 'react';
import useCard from './useCard';
import CardWrapper from './CardWrapper';
import CardBox from './CardBox';

import type { CardOptions } from 'types/cardOptions';
import type { ItemDto } from 'types/base/models/item-dto';

interface CardProps {
    item: ItemDto;
    cardOptions: CardOptions;
}

const Card: FC<CardProps> = ({ item, cardOptions }) => {
    const { getCardWrapperProps, getCardBoxProps } = useCard({ item, cardOptions } );
    const cardWrapperProps = getCardWrapperProps();
    const cardBoxProps = getCardBoxProps();
    const design = useContext(DesignContext);
    if (design) return <Cell row={{ kind: 'native', nativeItem: item }} options={cardOptions} />;

    return (
        <CardWrapper {...cardWrapperProps}>
            <CardBox {...cardBoxProps} />
        </CardWrapper>
    );
};

export default Card;
