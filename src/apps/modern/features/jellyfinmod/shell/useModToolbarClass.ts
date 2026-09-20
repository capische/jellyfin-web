import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/** Scroll distance, in px, past which Home's transparent bar becomes solid. */
const SOLID_AFTER = 40;

/**
 * The extra app-bar classes Home wears in the JellyfinMod interface (UX §7.3, the one deliberate restyle).
 *
 * Feature-local on purpose: the toolbar asks for a class name and knows nothing about why. Everywhere except
 * Home the answer is the empty string, so the bar is the ordinary opaque one.
 */
export const useModToolbarClass = (): string => {
    const location = useLocation();
    const isHome = location.pathname === '/home';
    const [isScrolled, setIsScrolled] = useState(false);

    useEffect(() => {
        if (!isHome) {
            setIsScrolled(false);
            return;
        }
        const onScroll = () => setIsScrolled(window.scrollY > SOLID_AFTER);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, [isHome]);

    if (!isHome) return '';
    return isScrolled ? ' jfmod-topbar jfmod-topbarSolid' : ' jfmod-topbar';
};
