'use client';

import React from 'react';
import { CATEGORY_METADATA } from '@/engine/registry';
import type { OperationCategory } from '@/engine/types';

export type CategoryFilter = OperationCategory | 'all';

export interface CategoryTabsProps {
  activeCategory: CategoryFilter;
  onSelectCategory: (category: CategoryFilter) => void;
}

const CATEGORIES: readonly { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'encoding', label: CATEGORY_METADATA.encoding.shortLabel },
  { id: 'ciphers', label: CATEGORY_METADATA.ciphers.shortLabel },
  { id: 'crypto', label: CATEGORY_METADATA.crypto.shortLabel },
  { id: 'text', label: CATEGORY_METADATA.text.shortLabel },
];

export function CategoryTabs({
  activeCategory,
  onSelectCategory,
}: CategoryTabsProps) {
  return (
    <div
      role="group"
      aria-label="Filter operations by category"
      className="flex flex-wrap gap-1"
    >
      {CATEGORIES.map((cat) => {
        const isActive = activeCategory === cat.id;
        return (
          <button
            key={cat.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelectCategory(cat.id)}
            data-testid={`catalog-category-${cat.id}`}
            className={`${
              isActive ? 'cl-btn-primary' : 'cl-btn-secondary'
            } rounded px-2 py-1 text-[11px] font-medium`}
          >
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}
