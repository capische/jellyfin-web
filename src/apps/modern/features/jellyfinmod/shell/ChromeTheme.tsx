import { ThemeProvider, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import React, { useMemo, type FC, type PropsWithChildren } from 'react';

import layoutManager from 'components/layoutManager';

/** Timers must match the CSS: Grow must not unmount a menu before its exit finishes. */
const ChromeTheme: FC<PropsWithChildren<{ enabled: boolean }>> = ({ enabled, children }) => {
    const theme = useTheme();
    const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
    const enter = layoutManager.mobile ? 618 : 382;
    const exit = layoutManager.mobile ? 382 : 236;
    const chromeTheme = useMemo(() => {
        let transitionDuration: number | { enter: number; exit: number } = { enter, exit };
        if (layoutManager.tv) transitionDuration = { enter: 146, exit: 1 };
        if (reduced) transitionDuration = 146;
        return ({
            ...theme,
            components: {
                ...theme.components,
                MuiTooltip: {
                    ...theme.components?.MuiTooltip,
                    defaultProps: {
                        ...theme.components?.MuiTooltip?.defaultProps,
                        enterDelay: 382,
                        enterNextDelay: 382,
                        leaveDelay: 0,
                        slotProps: { transition: { timeout: reduced ? 0 : 236 } }
                    }
                },
                MuiPopover: {
                    ...theme.components?.MuiPopover,
                    defaultProps: {
                        ...theme.components?.MuiPopover?.defaultProps,
                        transitionDuration
                    }
                }
            }
        });
    }, [theme, reduced, enter, exit]);
    return <ThemeProvider theme={enabled ? chromeTheme : theme}>{children}</ThemeProvider>;
};

export default ChromeTheme;
