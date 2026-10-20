'use client';

import React, { useMemo, useState } from 'react';
import {
  ALL_OPERATIONS,
  CATEGORY_METADATA,
  filterOperations,
} from '@/engine/registry';
import { MAX_PIPELINE_STEPS } from '@/lib/limits';
import { CategoryTabs, type CategoryFilter } from './CategoryTabs';
import { Search } from './Search';

export interface OperationCatalogProps {
  stepCount: number;
  onAddOperation: (operationId: string) => void;
}

export function OperationCatalog({
  stepCount,
  onAddOperation,
}: OperationCatalogProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const filteredOperations = useMemo(
    () => filterOperations(ALL_OPERATIONS, query, category),
    [query, category],
  );

  const atStepCap = stepCount >= MAX_PIPELINE_STEPS;

  const handleDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    operationId: string,
  ) => {
    if (atStepCap) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(
      'application/x-cipher-lab-operation',
      operationId,
    );
    event.dataTransfer.setData('text/plain', operationId);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <section
      aria-label="Operation catalog"
      data-testid="operation-catalog"
      className="cl-surface flex h-full flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--cl-border)' }}>
        <h2 className="text-sm font-semibold">Operation Catalog</h2>
        <span className="cl-text-muted text-xs">
          {stepCount}/{MAX_PIPELINE_STEPS} steps
        </span>
      </div>

      <Search
        query={query}
        onChange={setQuery}
        resultCount={filteredOperations.length}
      />

      <CategoryTabs
        activeCategory={category}
        onSelectCategory={setCategory}
      />

      {atStepCap ? (
        <div
          role="status"
          data-testid="catalog-step-limit-notice"
          className="cl-badge-warning rounded px-2.5 py-1.5 text-xs"
        >
          [Limit] Pipeline reached the {MAX_PIPELINE_STEPS}-step maximum. Remove
          a step to add more.
        </div>
      ) : null}

      <div
        role="list"
        aria-label="Available operations"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5"
      >
        {filteredOperations.length === 0 ? (
          <p
            data-testid="catalog-empty-state"
            className="cl-text-muted py-6 text-center text-xs"
          >
            No operations match your filter.
          </p>
        ) : (
          filteredOperations.map((op) => {
            const catMeta = CATEGORY_METADATA[op.category];
            return (
              <div
                key={op.id}
                role="listitem"
                draggable={!atStepCap}
                onDragStart={(e) => handleDragStart(e, op.id)}
                data-testid={`catalog-item-${op.id}`}
                className="cl-surface-alt flex flex-col gap-1.5 rounded border p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold">{op.label}</span>
                      <span className="cl-surface rounded border px-1.5 py-0.5 text-[10px] font-medium">
                        {catMeta.shortLabel}
                      </span>
                      <span className="cl-mono cl-surface rounded border px-1.5 py-0.5 text-[10px]">
                        {op.inputKind === 'utf8' ? 'UTF-8' : 'Bytes'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={atStepCap}
                    onClick={() => onAddOperation(op.id)}
                    aria-label={`Add ${op.label} to pipeline`}
                    data-testid={`add-op-${op.id}`}
                    className="cl-btn-primary shrink-0 rounded px-2.5 py-1 text-xs font-medium"
                  >
                    + Add
                  </button>
                </div>
                <p className="cl-text-muted text-[11px] leading-snug">
                  {op.description}
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
