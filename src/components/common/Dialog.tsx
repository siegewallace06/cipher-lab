'use client';

import React, { useEffect, useId, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
  testId?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  maxWidthClass = 'max-w-lg',
  testId,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open) {
      if (
        typeof document !== 'undefined' &&
        document.activeElement instanceof HTMLElement
      ) {
        triggerRef.current = document.activeElement;
      }
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') {
          try {
            dialog.showModal();
          } catch {
            dialog.setAttribute('open', '');
          }
        } else {
          dialog.setAttribute('open', '');
        }
      }
    } else if (dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
      }
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const handleNativeClose = () => {
      onClose();
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
      }
    };
    dialog.addEventListener('close', handleNativeClose);
    return () => {
      dialog.removeEventListener('close', handleNativeClose);
    };
  }, [onClose]);

  const handleBackdropClick = (
    event: React.MouseEvent<HTMLDialogElement>,
  ) => {
    // Progressive fallback for browsers where closedby="any" is not yet active:
    // Because inner content is wrapped in a container div, clicking the backdrop
    // targets the <dialog> element directly.
    if (event.target === dialogRef.current) {
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      // @ts-expect-error -- HTML5 closedby="any" attribute per modern-web-guidance light-dismiss-a-dialog
      closedby="any"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={handleBackdropClick}
      data-testid={testId}
      className={`cl-surface fixed inset-0 m-auto w-[calc(100%-2rem)] ${maxWidthClass} rounded-lg border p-0 shadow-xl`}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--cl-border)' }}>
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="cl-text-muted mt-1 text-xs">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="cl-btn-secondary rounded px-2.5 py-1 text-xs font-medium"
          >
            Close
          </button>
        </div>
        <div>{children}</div>
      </div>
    </dialog>
  );
}
