'use client';

import React, { useState } from 'react';
import { Dialog } from '@/components/common/Dialog';
import {
  getPresetById,
  PIPELINE_PRESETS,
  type PipelinePreset,
} from '@/lib/presets';
import type { RunLifecycleStatus, ThemePreference } from '@/state/workspace';

export interface RunToolbarProps {
  runStatus: RunLifecycleStatus;
  autoRun: boolean;
  isResultStale: boolean;
  isNonEmpty: boolean;
  theme: ThemePreference;
  isDesktopCatalogVisible: boolean;
  onRun: () => void;
  onCancel: () => void;
  onToggleAutoRun: (next: boolean) => void;
  onLoadPreset: (preset: PipelinePreset) => void;
  onOpenShare: () => void;
  onClearWorkspace: () => void;
  onChangeTheme: (theme: ThemePreference) => void;
  onOpenCatalogDrawer: () => void;
}

export function RunToolbar({
  runStatus,
  autoRun,
  isResultStale,
  isNonEmpty,
  theme,
  isDesktopCatalogVisible,
  onRun,
  onCancel,
  onToggleAutoRun,
  onLoadPreset,
  onOpenShare,
  onClearWorkspace,
  onChangeTheme,
  onOpenCatalogDrawer,
}: RunToolbarProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    PIPELINE_PRESETS[0].id,
  );
  const [pendingPreset, setPendingPreset] = useState<PipelinePreset | null>(
    null,
  );
  const [activePresetNotice, setActivePresetNotice] = useState<string | null>(
    null,
  );

  const isRunning = runStatus === 'running';

  const handleTriggerPreset = () => {
    const preset = getPresetById(selectedPresetId);
    if (!preset) {
      return;
    }
    if (isNonEmpty) {
      setPendingPreset(preset);
    } else {
      onLoadPreset(preset);
      setActivePresetNotice(preset.demoNotice ?? null);
    }
  };

  const handleConfirmPreset = () => {
    if (!pendingPreset) {
      return;
    }
    const preset = pendingPreset;
    setPendingPreset(null);
    onLoadPreset(preset);
    setActivePresetNotice(preset.demoNotice ?? null);
  };

  return (
    <header
      data-testid="workbench-toolbar"
      className="cl-surface flex flex-col gap-2.5 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div>
            <h1 className="text-base font-bold tracking-tight">Cipher Lab</h1>
            <p className="cl-text-muted text-xs">
              Stateless Local Data Transformation, Encoding &amp; Cryptography
              Workbench
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isDesktopCatalogVisible ? (
            <button
              type="button"
              onClick={onOpenCatalogDrawer}
              data-testid="toolbar-catalog-drawer-btn"
              className="cl-btn-secondary rounded px-2.5 py-1.5 text-xs font-semibold"
            >
              Operations Catalog
            </button>
          ) : null}

          <div className="cl-surface-alt flex flex-wrap items-center gap-1.5 rounded border px-2 py-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => onToggleAutoRun(e.target.checked)}
                data-testid="toolbar-autorun-toggle"
                className="h-3.5 w-3.5 rounded"
              />
              <span>Auto-run</span>
            </label>

            <button
              type="button"
              disabled={isRunning}
              onClick={onRun}
              data-testid="toolbar-run-btn"
              className="cl-btn-primary rounded px-3 py-1 text-xs font-semibold"
            >
              {isRunning
                ? 'Running...'
                : isResultStale
                  ? 'Run (Stale)'
                  : 'Run'}
            </button>

            <button
              type="button"
              disabled={!isRunning}
              onClick={onCancel}
              data-testid="toolbar-cancel-btn"
              className="cl-btn-secondary rounded px-2.5 py-1 text-xs font-medium"
            >
              Cancel
            </button>
          </div>

          <div className="cl-surface-alt flex flex-wrap items-center gap-1.5 rounded border px-2 py-1">
            <label htmlFor="preset-select" className="text-xs font-medium">
              Preset:
            </label>
            <select
              id="preset-select"
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
              data-testid="toolbar-preset-select"
              className="cl-input max-w-[13rem] rounded px-2 py-1 text-xs"
            >
              {PIPELINE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleTriggerPreset}
              data-testid="toolbar-load-preset-btn"
              className="cl-btn-secondary rounded px-2.5 py-1 text-xs font-semibold"
            >
              Load Preset
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenShare}
            data-testid="toolbar-share-btn"
            className="cl-btn-secondary rounded px-2.5 py-1.5 text-xs font-semibold"
          >
            Share URL
          </button>

          <button
            type="button"
            disabled={!isNonEmpty}
            onClick={() => {
              setActivePresetNotice(null);
              onClearWorkspace();
            }}
            data-testid="toolbar-clear-btn"
            className="cl-btn-secondary rounded px-2.5 py-1.5 text-xs font-medium"
          >
            Clear All
          </button>

          <div className="cl-surface-alt flex items-center gap-1 rounded border px-2 py-1">
            <label htmlFor="theme-select" className="text-xs font-medium">
              Theme:
            </label>
            <select
              id="theme-select"
              value={theme}
              onChange={(e) =>
                onChangeTheme(e.target.value as ThemePreference)
              }
              aria-label="Color theme preference"
              data-testid="toolbar-theme-select"
              className="cl-input rounded px-1.5 py-0.5 text-xs"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </div>

      {activePresetNotice ? (
        <div
          role="status"
          data-testid="preset-demo-secret-notice"
          className="cl-badge-warning flex items-center justify-between gap-2 rounded px-3 py-1.5 text-xs"
        >
          <span>[Demonstration Preset] {activePresetNotice}</span>
          <button
            type="button"
            onClick={() => setActivePresetNotice(null)}
            className="cl-btn-secondary shrink-0 rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <Dialog
        open={pendingPreset !== null}
        onClose={() => setPendingPreset(null)}
        title="Replace Current Workspace with Preset?"
        description="Loading a preset replaces your current input payload and transformation pipeline steps."
        testId="preset-confirm-dialog"
      >
        {pendingPreset ? (
          <div className="flex flex-col gap-3 text-xs">
            <div className="cl-surface-alt rounded border p-3">
              <p className="font-semibold">{pendingPreset.label}</p>
              <p className="cl-text-muted mt-1">{pendingPreset.description}</p>
              {pendingPreset.demoNotice ? (
                <p className="cl-badge-warning mt-2 rounded p-2 font-medium">
                  {pendingPreset.demoNotice}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingPreset(null)}
                data-testid="preset-confirm-cancel-btn"
                className="cl-btn-secondary rounded px-3 py-1.5 text-xs font-medium"
              >
                Keep Current Work
              </button>
              <button
                type="button"
                onClick={handleConfirmPreset}
                data-testid="preset-confirm-accept-btn"
                className="cl-btn-primary rounded px-3 py-1.5 text-xs font-semibold"
              >
                Replace with Preset
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </header>
  );
}
