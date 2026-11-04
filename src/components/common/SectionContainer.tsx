import React, { type FC, type PropsWithChildren, useContext } from 'react';
import { DesignContext } from 'apps/modern/features/jellyfinmod/design/Root';
import { Section } from 'apps/modern/features/jellyfinmod/design/Section';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import classNames from 'classnames';
import ItemsContainer, {
    type ItemsContainerProps
} from 'elements/emby-itemscontainer/ItemsContainer';
import Scroller, { type ScrollerProps } from 'elements/emby-scroller/Scroller';
import Cards from 'components/cardbuilder/Card/Cards';
import Lists from 'components/listview/List/Lists';
import type { CardOptions } from 'types/cardOptions';
import type { ListOptions } from 'types/listOptions';
import type { ItemDto } from 'types/base/models/item-dto';

interface SectionHeaderProps {
    className?: string;
    itemsLength?: number;
    url?: string;
    title: string;
}

const SectionHeader: FC<SectionHeaderProps> = ({
    title,
    className,
    itemsLength = 0,
    url
}) => {
    const sectionHeaderClass = classNames(
        'sectionTitleContainer sectionTitleContainer-cards',
        'padded-left',
        className
    );

    return (
        <Box className={sectionHeaderClass}>
            {url && itemsLength > 1 ? (
                <Link
                    className='clearLink button-flat sectionTitleTextButton'
                    underline='none'
                    href={url}
                >
                    <Typography
                        className='sectionTitle sectionTitle-cards'
                        variant='h2'
                    >
                        {title}
                    </Typography>
                    <ChevronRightIcon sx={{ pt: '5px' }} />
                </Link>
            ) : (
                <Typography
                    className='sectionTitle sectionTitle-cards'
                    variant='h2'
                >
                    {title}
                </Typography>
            )}
        </Box>
    );
};

interface SectionContainerProps {
    className?: string;
    items?: ItemDto[];
    sectionHeaderProps?: Omit<SectionHeaderProps, 'itemsLength'>;
    scrollerProps?: ScrollerProps;
    itemsContainerProps?: ItemsContainerProps;
    isListMode?: boolean;
    isScrollerMode?: boolean;
    noPadding?: boolean;
    cardOptions?: CardOptions;
    listOptions?: ListOptions;
}

const SectionContainer: FC<PropsWithChildren<SectionContainerProps>> = ({
    className,
    sectionHeaderProps,
    scrollerProps,
    itemsContainerProps,
    isListMode = false,
    isScrollerMode = true,
    noPadding = false,
    items = [],
    cardOptions = {},
    listOptions = {},
    children
}) => {
    const design = useContext(DesignContext);
    const sectionClass = classNames('verticalSection', className);

    const renderItems = () => {
        if (React.isValidElement(children)) {
            return children;
        }

        if (isListMode && !isScrollerMode) {
            return <Lists items={items} listOptions={listOptions} />;
        } else {
            return <Cards items={items} cardOptions={cardOptions} />;
        }
    };

    // JellyfinMod: on the mod's painted pages a row is the mockup's section; its items are already the mockup's cells.
    if (design && isScrollerMode) {
        const title = sectionHeaderProps?.title ?? '';
        return <Section title={sectionHeaderProps?.url && items.length > 1 ? <a href={sectionHeaderProps.url}>{title}</a> : title}
            queryKey={itemsContainerProps?.queryKey} reload={itemsContainerProps?.reloadItems}>{renderItems()}</Section>;
    }

    const content = (
        <ItemsContainer
            className={classNames(
                { scrollSlider: isScrollerMode },
                itemsContainerProps?.className
            )}
            {...itemsContainerProps}
        >
            {renderItems()}
        </ItemsContainer>
    );

    return (
        <Box className={sectionClass}>
            {sectionHeaderProps?.title && (
                <SectionHeader
                    className={classNames(
                        { 'no-padding': noPadding },
                        sectionHeaderProps?.className
                    )}
                    itemsLength={items.length}
                    {...sectionHeaderProps}
                />
            )}
            {isScrollerMode && !isListMode ? (
                <Scroller
                    className={classNames(
                        { 'no-padding': noPadding },
                        scrollerProps?.className
                    )}
                    {...scrollerProps}
                >
                    {content}
                </Scroller>
            ) : (
                content
            )}
        </Box>
    );
};

export default SectionContainer;
