'use client';

import React, { useMemo } from 'react';
import { formatHexDump } from '@/lib/bytes';

export interface HexViewProps {
  bytes: Uint8Array;
  maxBytes?: number;
  emptyLabel?: string;
  testId?: string;
}

export function HexView({
  bytes,
  maxBytes = 16384,
  emptyLabel = '0 bytes (empty buffer)',
  testId = 'hex-view',
}: HexViewProps) {
  const dump = useMemo(
    () => formatHexDump(bytes, 16, maxBytes),
    [bytes, maxBytes],
  );

  if (bytes.byteLength === 0) {
    return (
      <div
        data-testid={testId}
        className="cl-surface-alt cl-mono cl-text-muted rounded border p-3 text-xs"
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      className="cl-surface-alt max-w-full overflow-x-auto rounded border p-3"
    >
      <pre className="cl-mono m-0 text-[11px] leading-relaxed whitespace-pre">
        {dump}
      </pre>
    </div>
  );
}
