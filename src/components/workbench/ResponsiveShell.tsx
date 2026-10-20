'use client';

import React, { useState } from 'react';
import { Dialog } from '@/components/common/Dialog';

export type MobileActiveTab = 'input' | 'pipeline' | 'output';

export interface ResponsiveShellProps {
  toolbar: React.ReactNode;
  notices?: React.ReactNode;
  catalog: React.ReactNode;
  pipeline: React.ReactNode;
  inputPane: React.ReactNode;
  outputPane: React.ReactNode;
  stepCount: number;
  isDesktopCatalogVisible: boolean;
  catalogDrawerOpen: boolean;
  onOpenCatalogDrawer: () => void;
  onCloseCatalogDrawer: () => void;
}

export function ResponsiveShell({
  toolbar,
  notices,
  catalog,
  pipeline,
  inputPane,
  outputPane,
  stepCount,
  isDesktopCatalogVisible,
  catalogDrawerOpen,
  onOpenCatalogDrawer,
  onCloseCatalogDrawer,
}: ResponsiveShellProps) {
  const [mobileTab, setMobileTab] = useState<MobileActiveTab>('input');

  return (
    <div
      data-testid="responsive-shell"
      className="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col gap-3 p-2.5 sm:p-4"
    >
      {toolbar}

      {notices}

      {/* Mobile Tab Navigation (< 768px) */}
      <nav
        aria-label="Mobile workspace panes"
        data-testid="mobile-tab-bar"
        className="cl-surface flex flex-wrap items-center justify-between gap-1.5 rounded-lg border p-2 md:hidden"
      >
        <div role="tablist" aria-label="Workspace sections" className="flex flex-1 gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'input'}
            onClick={() => setMobileTab('input')}
            data-testid="mobile-tab-input"
            className={`${
              mobileTab === 'input' ? 'cl-btn-primary' : 'cl-btn-secondary'
            } flex-1 rounded px-2 py-1 text-xs font-semibold`}
          >
            Input
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'pipeline'}
            onClick={() => setMobileTab('pipeline')}
            data-testid="mobile-tab-pipeline"
            className={`${
              mobileTab === 'pipeline' ? 'cl-btn-primary' : 'cl-btn-secondary'
            } flex-1 rounded px-2 py-1 text-xs font-semibold`}
          >
            Pipeline ({stepCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'output'}
            onClick={() => setMobileTab('output')}
            data-testid="mobile-tab-output"
            className={`${
              mobileTab === 'output' ? 'cl-btn-primary' : 'cl-btn-secondary'
            } flex-1 rounded px-2 py-1 text-xs font-semibold`}
          >
            Output
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenCatalogDrawer}
          data-testid="mobile-open-catalog-btn"
          className="cl-btn-secondary shrink-0 rounded px-2.5 py-1 text-xs font-semibold"
        >
          + Catalog
        </button>
      </nav>

      {/* Main Responsive Grid */}
      <main
        data-testid="workbench-main"
        className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-12"
      >
        {/* Desktop Catalog Column (>= 1200px) */}
        {isDesktopCatalogVisible ? (
          <div
            data-testid="desktop-catalog-column"
            className="hidden min-[1200px]:col-span-3 min-[1200px]:block"
          >
            {catalog}
          </div>
        ) : null}

        {/* Pipeline Column */}
        <div
          data-testid="pipeline-column"
          className={`${
            mobileTab === 'pipeline' ? 'block' : 'hidden'
          } min-w-0 md:block md:max-[1199px]:col-span-5 min-[1200px]:col-span-4`}
        >
          {pipeline}
        </div>

        {/* Input + Output Data Column */}
        <div
          data-testid="data-column"
          className="flex min-w-0 flex-col gap-3 md:max-[1199px]:col-span-7 min-[1200px]:col-span-5"
        >
          <div
            data-testid="input-pane-wrapper"
            className={`${mobileTab === 'input' ? 'block' : 'hidden'} md:block`}
          >
            {inputPane}
          </div>
          <div
            data-testid="output-pane-wrapper"
            className={`${mobileTab === 'output' ? 'block' : 'hidden'} md:block`}
          >
            {outputPane}
          </div>
        </div>
      </main>

      {/* Tablet / Mobile Collapsible Catalog Drawer (< 1200px) */}
      {!isDesktopCatalogVisible ? (
        <Dialog
          open={catalogDrawerOpen}
          onClose={onCloseCatalogDrawer}
          title="Operation Catalog"
          description="Select an operation to append it to your transformation pipeline."
          maxWidthClass="max-w-lg"
          testId="catalog-drawer-dialog"
        >
          <div className="max-h-[70vh] overflow-y-auto">{catalog}</div>
        </Dialog>
      ) : null}

      <footer className="cl-surface cl-text-muted flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px]">
        <span>
          All transformations run locally in isolated browser workers. No input,
          output, or keys are transmitted to any server.
        </span>
        <span>
          Note: Browser and OS memory cannot be guaranteed securely erased after
          closing a tab.
        </span>
      </footer>
    </div>
  );
}
