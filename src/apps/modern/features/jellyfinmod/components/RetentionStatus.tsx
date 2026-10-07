import React, { type FC } from 'react';

import { retentionMessage } from '../constants/fileState';
import type { RetentionSummary } from '../types/entry';

/**
 * One retention line. Says nothing while automatic removal is off: "Automatic removal is off." was dropped from every
 * detail page by the user on 2026-10-07 (the 95% case shows nothing, UX Principle 1).
 */
const RetentionStatus: FC<{ retention?: RetentionSummary | null; compact?: boolean }> = ({ retention, compact = false }) => {
    if (retention?.reason !== 'kept' && (!retention?.enabled || retention.state === 'disabled')) return null;
    return <p className={compact ? 'jfmod-retentionStatus jfmod-retentionStatus--compact' : 'jfmod-retentionStatus'}>
        {retentionMessage(retention)}
    </p>;
};

export default RetentionStatus;
