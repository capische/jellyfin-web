import React, { type FC } from 'react';

import LegacyAppLayout from 'apps/legacy/AppLayout';
import { Component as ModernAppLayout } from 'apps/modern/AppLayout';
import layoutManager from 'components/layoutManager';

/**
 * The layout every embedded upstream screen renders inside (P7.S2, §2.1).
 *
 * This is the seam the JellyfinMod shell arrives through. Upstream's app route table reaches its layout through
 * `lazy`/`Component`; `ModAppRouter` substitutes this component and keeps upstream's children, so replacing the
 * chrome never means touching an upstream route or screen.
 *
 * For now it renders the upstream layout that matches the active layout mode, so the mod entry behaves exactly
 * like the stock entry while the entry, the router and the asset rooting are proved. The shell's own top bar,
 * navigation and user menu replace the body of this component in the next slice; everything it wraps stays
 * untouched when that happens.
 */
const ModAppLayout: FC = () => (
    layoutManager.modern ? <ModernAppLayout /> : <LegacyAppLayout />
);

export default ModAppLayout;
