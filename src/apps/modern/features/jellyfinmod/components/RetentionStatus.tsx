import React, { type FC } from 'react';

import { retentionMessage } from '../constants/fileState';
import type { RetentionSummary } from '../types/entry';

const RetentionStatus: FC<{ retention?: RetentionSummary | null; compact?: boolean }> = ({ retention, compact = false }) => (
    <p className={compact ? 'jfmod-retentionStatus jfmod-retentionStatus--compact' : 'jfmod-retentionStatus'}>
        {retentionMessage(retention)}
    </p>
);

export default RetentionStatus;
