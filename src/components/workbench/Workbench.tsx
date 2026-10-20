'use client';

import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { OperationCatalog } from '@/components/catalog/OperationCatalog';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { StatusMessage } from '@/components/common/StatusMessage';
import { InputPane } from '@/components/data/InputPane';
import { OutputPane } from '@/components/data/OutputPane';
import { PipelineBuilder } from '@/components/pipeline/PipelineBuilder';
import { RestoreNotice } from '@/components/sharing/RestoreNotice';
import { ShareDialog } from '@/components/sharing/ShareDialog';
import {
  PipelineWorkerClient,
  type WorkerFactory,
} from '@/engine/worker-client';
import {
  DetectionWorkerClient,
  type DetectionCandidate,
  type DetectionWorkerFactory,
} from '@/lib/detection';
import { AUTO_RUN_DEBOUNCE_MS, THEME_STORAGE_KEY } from '@/lib/limits';
import { importWorkspaceFromUrlFragment } from '@/lib/url-state';
import {
  createInitialWorkspaceState,
  isResultStale,
  isWorkspaceNonEmpty,
  workspaceReducer,
  type ThemePreference,
} from '@/state/workspace';
import { ResponsiveShell } from './ResponsiveShell';
import { RunToolbar } from './RunToolbar';

export interface WorkbenchProps {
  workerFactory?: WorkerFactory;
  detectionWorkerFactory?: DetectionWorkerFactory;
}

interface CapabilityCheckResult {
  hasWorkers: boolean;
  hasTextCodec: boolean;
  hasSubtleCrypto: boolean;
}

function detectBrowserCapabilities(): CapabilityCheckResult {
  if (typeof window === 'undefined') {
    return {
      hasWorkers: true,
      hasTextCodec: true,
      hasSubtleCrypto: true,
    };
  }
  const hasWorkers = typeof window.Worker === 'function';
  const hasTextCodec =
    typeof window.TextEncoder === 'function' &&
    typeof window.TextDecoder === 'function';
  const hasSubtleCrypto =
    typeof window.crypto !== 'undefined' &&
    typeof window.crypto.subtle !== 'undefined' &&
    typeof window.crypto.getRandomValues === 'function';

  return {
    hasWorkers,
    hasTextCodec,
    hasSubtleCrypto,
  };
}

function applyDocumentTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}

export function Workbench({
  workerFactory,
  detectionWorkerFactory,
}: WorkbenchProps = {}) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    createInitialWorkspaceState,
  );

  const [shareOpen, setShareOpen] = useState(false);
  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false);
  const [isDesktopCatalogVisible, setIsDesktopCatalogVisible] = useState(true);
  const [capabilities, setCapabilities] = useState<CapabilityCheckResult>({
    hasWorkers: true,
    hasTextCodec: true,
    hasSubtleCrypto: true,
  });
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');
  const [initialUrlChecked, setInitialUrlChecked] = useState(false);

  const workerClientRef = useRef<PipelineWorkerClient | null>(null);
  const inputDetectionClientRef = useRef<DetectionWorkerClient | null>(null);
  const outputDetectionClientRef = useRef<DetectionWorkerClient | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const announce = useCallback((message: string) => {
    setLiveAnnouncement(message);
  }, []);

  // Initialize worker clients and clean up on unmount
  useEffect(() => {
    workerClientRef.current = new PipelineWorkerClient(
      workerFactory ? { workerFactory } : undefined,
    );
    inputDetectionClientRef.current = new DetectionWorkerClient(
      detectionWorkerFactory,
    );
    outputDetectionClientRef.current = new DetectionWorkerClient(
      detectionWorkerFactory,
    );

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      workerClientRef.current?.destroy();
      inputDetectionClientRef.current?.destroy();
      outputDetectionClientRef.current?.destroy();
    };
  }, [workerFactory, detectionWorkerFactory]);

  // Detect browser capabilities, viewport breakpoint, and stored theme preference
  useEffect(() => {
    setCapabilities(detectBrowserCapabilities());

    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === 'light' || savedTheme === 'dark') {
        dispatch({ type: 'set-theme', theme: savedTheme });
        applyDocumentTheme(savedTheme);
      } else {
        applyDocumentTheme('system');
      }
    } catch {
      // Ignore storage access errors in restricted contexts
    }

    if (typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(min-width: 1200px)');
      const updateBreakpoint = () => {
        setIsDesktopCatalogVisible(mql.matches);
        if (mql.matches) {
          setCatalogDrawerOpen(false);
        }
      };
      updateBreakpoint();
      mql.addEventListener('change', updateBreakpoint);
      return () => {
        mql.removeEventListener('change', updateBreakpoint);
      };
    }
    return undefined;
  }, []);

  // Restore from URL fragment on initial mount and hashchange
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const processUrlLocation = () => {
      const imported = importWorkspaceFromUrlFragment(
        window.location.hash,
        window.location.search,
      );
      if (imported.kind === 'ok') {
        workerClientRef.current?.cancelActiveRun();
        dispatch({
          type: 'restore-from-url',
          steps: imported.steps,
          inputBytes: imported.inputBytes,
          missingSecrets: imported.missingSecrets,
        });
        announce(
          'Restored pipeline from shared URL fragment. Execution is paused until you press Run.',
        );
      } else if (imported.kind === 'error') {
        dispatch({
          type: 'set-import-error',
          error: imported.error,
        });
        announce(`Rejected invalid shared URL: ${imported.error.message}`);
      }
    };

    processUrlLocation();
    setInitialUrlChecked(true);

    window.addEventListener('hashchange', processUrlLocation);
    return () => {
      window.removeEventListener('hashchange', processUrlLocation);
    };
  }, [announce]);

  const executeRevisionNow = useCallback(
    async (
      targetRevision: number,
      inputBytes: Uint8Array,
      steps: typeof state.steps,
    ) => {
      const client = workerClientRef.current;
      if (!client) {
        return;
      }
      const runId = `run-${targetRevision}-${Date.now()}`;
      dispatch({ type: 'run-started', runId, revision: targetRevision });

      const result = await client.run({
        runId,
        revision: targetRevision,
        input: inputBytes,
        steps,
      });

      if (stateRef.current.revision !== targetRevision) {
        return;
      }

      dispatch({ type: 'run-completed', result });

      if (result.status === 'success') {
        announce(
          `Pipeline completed (${result.output.byteLength.toLocaleString()} bytes in ${result.durationMs.toFixed(1)} ms).`,
        );
      } else if (result.status === 'error') {
        announce(`Pipeline failed: ${result.error.message}`);
      }
    },
    [announce],
  );

  // Watch state.revision & state.autoRun: terminate obsolete worker immediately and debounce auto-run
  useEffect(() => {
    if (!initialUrlChecked) {
      return undefined;
    }

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Terminate any previous revision worker immediately when revision changes
    workerClientRef.current?.cancelActiveRun();

    if (!state.autoRun) {
      return undefined;
    }

    const currentRev = state.revision;
    const currentInput = state.inputBytes;
    const currentSteps = state.steps;

    // Run initial empty workspace immediately on revision 1, debounce edits by 200ms
    const delayMs = currentRev === 1 ? 0 : AUTO_RUN_DEBOUNCE_MS;

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void executeRevisionNow(currentRev, currentInput, currentSteps);
    }, delayMs);

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    initialUrlChecked,
    state.revision,
    state.autoRun,
    state.inputBytes,
    state.steps,
    executeRevisionNow,
  ]);

  // Run input format detection in bounded worker when inputRevision changes
  useEffect(() => {
    const client = inputDetectionClientRef.current;
    if (!client) {
      return;
    }
    const targetRev = state.inputRevision;
    void client.detect(state.inputBytes, targetRev).then((res) => {
      if (stateRef.current.inputRevision === targetRev) {
        dispatch({ type: 'set-input-detection', result: res });
      }
    });
  }, [state.inputBytes, state.inputRevision]);

  // Run output format detection in bounded worker when a successful result completes
  useEffect(() => {
    const client = outputDetectionClientRef.current;
    if (
      !client ||
      !state.executionResult ||
      state.executionResult.status !== 'success' ||
      state.resultRevision === null
    ) {
      return;
    }
    // Only suggest output formats when the pipeline actually transformed data (steps.length > 0)
    // or when output is non-empty
    const targetRev = state.resultRevision;
    const outputBytes = state.executionResult.output;
    void client.detect(outputBytes, targetRev).then((res) => {
      if (stateRef.current.resultRevision === targetRev) {
        dispatch({ type: 'set-output-detection', result: res });
      }
    });
  }, [state.executionResult, state.resultRevision]);

  const handleManualRun = () => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void executeRevisionNow(state.revision, state.inputBytes, state.steps);
  };

  const handleCancelRun = () => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const cancelledResult = workerClientRef.current?.cancelActiveRun();
    if (cancelledResult) {
      dispatch({ type: 'run-completed', result: cancelledResult });
    } else {
      dispatch({ type: 'run-cancelled', revision: state.revision });
    }
    announce('Pipeline execution cancelled.');
  };

  const handleChangeTheme = (nextTheme: ThemePreference) => {
    dispatch({ type: 'set-theme', theme: nextTheme });
    applyDocumentTheme(nextTheme);
    try {
      if (nextTheme === 'light' || nextTheme === 'dark') {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } else {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures
    }
  };

  const clearUrlFragment = () => {
    if (
      typeof window !== 'undefined' &&
      (window.location.hash || window.location.search)
    ) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const handleClearWorkspace = () => {
    workerClientRef.current?.cancelActiveRun();
    clearUrlFragment();
    dispatch({ type: 'clear-workspace' });
    announce('Cleared workspace and removed any shared URL fragment.');
  };

  const handleApplyDetection = (candidate: DetectionCandidate) => {
    dispatch({
      type: 'add-step',
      operationId: candidate.operationId,
      params: { ...candidate.params },
    });
    announce(`Appended ${candidate.actionLabel} step to pipeline.`);
  };

  const stale = isResultStale(state);
  const nonEmpty = isWorkspaceNonEmpty(state);

  return (
    <ErrorBoundary sectionName="Cipher Lab Workbench">
      {/* Screen-reader live announcement region (single polite region for completion/status) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="workbench-live-region"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>

      <ResponsiveShell
        isDesktopCatalogVisible={isDesktopCatalogVisible}
        catalogDrawerOpen={catalogDrawerOpen}
        onOpenCatalogDrawer={() => setCatalogDrawerOpen(true)}
        onCloseCatalogDrawer={() => setCatalogDrawerOpen(false)}
        stepCount={state.steps.length}
        toolbar={
          <RunToolbar
            runStatus={state.runStatus}
            autoRun={state.autoRun}
            isResultStale={stale}
            isNonEmpty={nonEmpty}
            theme={state.theme}
            isDesktopCatalogVisible={isDesktopCatalogVisible}
            onRun={handleManualRun}
            onCancel={handleCancelRun}
            onToggleAutoRun={(next) =>
              dispatch({ type: 'set-auto-run', autoRun: next })
            }
            onLoadPreset={(preset) => {
              clearUrlFragment();
              dispatch({ type: 'load-preset', preset });
              announce(`Loaded preset: ${preset.label}.`);
            }}
            onOpenShare={() => setShareOpen(true)}
            onClearWorkspace={handleClearWorkspace}
            onChangeTheme={handleChangeTheme}
            onOpenCatalogDrawer={() => setCatalogDrawerOpen(true)}
          />
        }
        notices={
          <>
            {!capabilities.hasWorkers || !capabilities.hasTextCodec ? (
              <StatusMessage
                tone="error"
                title="Unsupported Browser Environment"
                message="Cipher Lab requires Web Workers, TextEncoder, and TextDecoder. Please use a current stable release of Chrome, Firefox, or Safari."
                code="UNSUPPORTED_ENVIRONMENT"
                testId="capability-error-banner"
              />
            ) : !capabilities.hasSubtleCrypto ? (
              <StatusMessage
                tone="warning"
                title="Web Crypto Unavailable"
                message="window.crypto.subtle is unavailable (HTTPS or localhost is required). Non-cryptographic operations remain usable, while SHA, HMAC, and AES-GCM will return UNSUPPORTED_ENVIRONMENT."
                code="UNSUPPORTED_ENVIRONMENT"
                testId="capability-crypto-warning-banner"
              />
            ) : null}

            <RestoreNotice
              restoredNotice={state.restoredNotice}
              importError={state.importError}
              onRunRestored={() => {
                dispatch({ type: 'dismiss-restore-notice' });
                handleManualRun();
              }}
              onClearRestored={handleClearWorkspace}
              onDismissNotice={() =>
                dispatch({ type: 'dismiss-restore-notice' })
              }
              onDismissError={() => {
                clearUrlFragment();
                dispatch({ type: 'set-import-error', error: null });
              }}
            />
          </>
        }
        catalog={
          <ErrorBoundary sectionName="Operation Catalog">
            <OperationCatalog
              stepCount={state.steps.length}
              onAddOperation={(operationId) => {
                dispatch({ type: 'add-step', operationId });
                setCatalogDrawerOpen(false);
                announce(`Added ${operationId} step to pipeline.`);
              }}
            />
          </ErrorBoundary>
        }
        pipeline={
          <ErrorBoundary sectionName="Transformation Pipeline">
            <PipelineBuilder
              steps={state.steps}
              selectedStepId={state.selectedStepId}
              executionResult={state.executionResult}
              isResultStale={stale}
              onAddOperation={(operationId) => {
                dispatch({ type: 'add-step', operationId });
                announce(`Added ${operationId} step to pipeline.`);
              }}
              onSelectStep={(stepId) =>
                dispatch({ type: 'select-step', stepId })
              }
              onToggleStepEnabled={(stepId) =>
                dispatch({ type: 'toggle-step-enabled', stepId })
              }
              onMoveStep={(stepId, direction) =>
                dispatch({ type: 'move-step', stepId, direction })
              }
              onDuplicateStep={(stepId) =>
                dispatch({ type: 'duplicate-step', stepId })
              }
              onRemoveStep={(stepId) =>
                dispatch({ type: 'remove-step', stepId })
              }
              onChangeStepParam={(stepId, key, value) =>
                dispatch({ type: 'update-step-param', stepId, key, value })
              }
              onOpenCatalogDrawer={() => setCatalogDrawerOpen(true)}
            />
          </ErrorBoundary>
        }
        inputPane={
          <ErrorBoundary sectionName="Input Pane">
            <InputPane
              inputBytes={state.inputBytes}
              inputRevision={state.inputRevision}
              entryMode={state.inputEntryMode}
              draftText={state.inputDraftText}
              draftError={state.inputDraftError}
              viewMode={state.inputViewMode}
              detection={state.inputDetection}
              dismissedDetectionRevision={state.dismissedInputDetectionRevision}
              stepCount={state.steps.length}
              onChangeText={(text) =>
                dispatch({ type: 'set-input-text', text })
              }
              onChangeHexDraft={(hexDraft) =>
                dispatch({ type: 'set-input-hex-draft', hexDraft })
              }
              onChangeEntryMode={(mode) =>
                dispatch({ type: 'set-input-entry-mode', mode })
              }
              onChangeViewMode={(mode) =>
                dispatch({ type: 'set-input-view-mode', mode })
              }
              onLoadSample={() => {
                dispatch({ type: 'load-sample-input' });
                announce('Loaded sample UTF-8 input.');
              }}
              onClearInput={() => {
                dispatch({ type: 'set-input-text', text: '' });
                announce('Cleared input buffer.');
              }}
              onApplyDetection={handleApplyDetection}
              onDismissDetection={() =>
                dispatch({ type: 'dismiss-input-detection' })
              }
              onAnnounce={(msg) => announce(msg)}
            />
          </ErrorBoundary>
        }
        outputPane={
          <ErrorBoundary sectionName="Output Pane">
            <OutputPane
              executionResult={state.executionResult}
              currentRevision={state.revision}
              resultRevision={state.resultRevision}
              runStatus={state.runStatus}
              viewMode={state.outputViewMode}
              detection={state.outputDetection}
              dismissedDetectionRevision={
                state.dismissedOutputDetectionRevision
              }
              stepCount={state.steps.length}
              onChangeViewMode={(mode) =>
                dispatch({ type: 'set-output-view-mode', mode })
              }
              onPromoteToInput={() => {
                dispatch({ type: 'promote-output-to-input' });
                announce('Promoted output bytes into input buffer.');
              }}
              onApplyDetection={handleApplyDetection}
              onDismissDetection={() =>
                dispatch({ type: 'dismiss-output-detection' })
              }
              onAnnounce={(msg) => announce(msg)}
            />
          </ErrorBoundary>
        }
      />

      <ShareDialog
        open={shareOpen}
        steps={state.steps}
        inputBytes={state.inputBytes}
        onClose={() => setShareOpen(false)}
        onAnnounce={(msg) => announce(msg)}
      />
    </ErrorBoundary>
  );
}
