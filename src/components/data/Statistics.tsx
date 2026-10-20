'use client';

import React, { useMemo } from 'react';
import { computeByteStatistics } from '@/lib/bytes';

export interface StatisticsProps {
  bytes: Uint8Array;
  testIdPrefix?: string;
}

export function Statistics({
  bytes,
  testIdPrefix = 'stats',
}: StatisticsProps) {
  const stats = useMemo(() => computeByteStatistics(bytes), [bytes]);

  return (
    <dl
      data-testid={`${testIdPrefix}-bar`}
      className="cl-surface-alt flex flex-wrap items-center gap-x-4 gap-y-1 rounded border px-2.5 py-1.5 text-[11px]"
    >
      <div className="flex items-center gap-1">
        <dt className="cl-text-muted font-medium">Bytes:</dt>
        <dd
          data-testid={`${testIdPrefix}-bytes`}
          className="cl-mono font-semibold"
        >
          {stats.byteLength.toLocaleString()}
        </dd>
      </div>
      <div className="flex items-center gap-1">
        <dt className="cl-text-muted font-medium">Code points:</dt>
        <dd
          data-testid={`${testIdPrefix}-chars`}
          className="cl-mono font-semibold"
        >
          {stats.isUtf8 && stats.charCount !== null
            ? stats.charCount.toLocaleString()
            : 'Unavailable (binary)'}
        </dd>
      </div>
      <div className="flex items-center gap-1">
        <dt className="cl-text-muted font-medium">Lines:</dt>
        <dd
          data-testid={`${testIdPrefix}-lines`}
          className="cl-mono font-semibold"
        >
          {stats.isUtf8 && stats.lineCount !== null
            ? stats.lineCount.toLocaleString()
            : 'Unavailable (binary)'}
        </dd>
      </div>
      <div className="flex items-center gap-1">
        <dt className="cl-text-muted font-medium">Encoding:</dt>
        <dd
          data-testid={`${testIdPrefix}-encoding`}
          className="cl-mono font-semibold"
        >
          {stats.isUtf8 ? 'Valid UTF-8' : 'Arbitrary Bytes'}
        </dd>
      </div>
    </dl>
  );
}
