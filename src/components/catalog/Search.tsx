'use client';

import React, { useId } from 'react';

export interface SearchProps {
  query: string;
  onChange: (nextQuery: string) => void;
  resultCount: number;
}

export function Search({ query, onChange, resultCount }: SearchProps) {
  const inputId = useId();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-xs font-semibold">
          Search operations
        </label>
        <span className="cl-text-muted text-[11px]" aria-live="polite">
          {resultCount} {resultCount === 1 ? 'operation' : 'operations'}
        </span>
      </div>
      <div className="relative flex items-center">
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Filter by name, category, or keyword..."
          data-testid="catalog-search-input"
          className="cl-input w-full rounded px-2.5 py-1.5 text-xs"
        />
        {query.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search query"
            data-testid="catalog-search-clear"
            className="cl-btn-secondary ml-1.5 shrink-0 rounded px-2 py-1 text-[11px] font-medium"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
