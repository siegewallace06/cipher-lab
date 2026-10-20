'use client';

import React, { useId, useState } from 'react';
import type {
  OperationError,
  ParameterField,
  Parameters,
  ParameterValue,
} from '@/engine/types';

export interface ParameterFormProps {
  stepId: string;
  fields: readonly ParameterField[];
  params: Parameters;
  errors: readonly OperationError[];
  onChangeParam: (key: string, value: ParameterValue) => void;
}

export function ParameterForm({
  stepId,
  fields,
  params,
  errors,
  onChangeParam,
}: ParameterFormProps) {
  const baseId = useId();
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});

  if (fields.length === 0) {
    return (
      <p className="cl-text-muted text-[11px]">
        No configurable parameters for this operation.
      </p>
    );
  }

  const toggleReveal = (key: string) => {
    setRevealedSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {fields.map((field) => {
        const controlId = `${baseId}-${stepId}-${field.key}`;
        const errorId = `${controlId}-error`;
        const fieldError = errors.find((e) => e.field === field.key);
        const value = params[field.key] ?? field.defaultValue ?? '';

        return (
          <div key={field.key} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <label htmlFor={controlId} className="text-xs font-medium">
                {field.label}
                {field.required ? (
                  <span aria-hidden="true" className="ml-0.5 font-bold">
                    *
                  </span>
                ) : null}
              </label>
              {field.secret ? (
                <span className="cl-badge-warning rounded px-1.5 py-0.2 text-[10px] font-semibold">
                  Secret (never shared)
                </span>
              ) : null}
            </div>

            {field.kind === 'select' && field.options ? (
              <select
                id={controlId}
                value={String(value)}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? errorId : undefined}
                data-testid={`param-${stepId}-${field.key}`}
                onChange={(e) => {
                  const raw = e.target.value;
                  const matched = field.options?.find(
                    (opt) => String(opt) === raw,
                  );
                  onChangeParam(field.key, matched !== undefined ? matched : raw);
                }}
                className="cl-input rounded px-2 py-1 text-xs"
              >
                {field.options.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            ) : field.kind === 'boolean' ? (
              <div className="flex items-center gap-2 pt-0.5">
                <input
                  id={controlId}
                  type="checkbox"
                  checked={Boolean(value)}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={fieldError ? errorId : undefined}
                  data-testid={`param-${stepId}-${field.key}`}
                  onChange={(e) => onChangeParam(field.key, e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <span className="cl-text-muted text-xs">
                  {value ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            ) : field.kind === 'number' ? (
              <input
                id={controlId}
                type="number"
                min={field.min}
                max={field.max}
                step={1}
                value={typeof value === 'number' && !Number.isNaN(value) ? value : ''}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? errorId : undefined}
                data-testid={`param-${stepId}-${field.key}`}
                onChange={(e) => {
                  const raw = e.target.value;
                  const parsed = raw === '' ? Number.NaN : Number(raw);
                  onChangeParam(field.key, parsed);
                }}
                className="cl-input cl-mono rounded px-2 py-1 text-xs"
              />
            ) : field.kind === 'secret' ? (
              <div className="flex items-center gap-1">
                <input
                  id={controlId}
                  type={revealedSecrets[field.key] ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={String(value)}
                  placeholder={field.placeholder ?? 'Enter secret value...'}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={fieldError ? errorId : undefined}
                  data-testid={`param-${stepId}-${field.key}`}
                  onChange={(e) => onChangeParam(field.key, e.target.value)}
                  className="cl-input cl-mono min-w-0 flex-1 rounded px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => toggleReveal(field.key)}
                  aria-label={
                    revealedSecrets[field.key]
                      ? `Hide ${field.label}`
                      : `Show ${field.label}`
                  }
                  data-testid={`param-reveal-${stepId}-${field.key}`}
                  className="cl-btn-secondary shrink-0 rounded px-2 py-1 text-[11px] font-medium"
                >
                  {revealedSecrets[field.key] ? 'Hide' : 'Show'}
                </button>
              </div>
            ) : (
              <input
                id={controlId}
                type="text"
                spellCheck={false}
                value={String(value)}
                placeholder={field.placeholder ?? ''}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? errorId : undefined}
                data-testid={`param-${stepId}-${field.key}`}
                onChange={(e) => onChangeParam(field.key, e.target.value)}
                className="cl-input cl-mono rounded px-2 py-1 text-xs"
              />
            )}

            {field.description ? (
              <span className="cl-text-muted text-[10px]">
                {field.description}
              </span>
            ) : null}

            {fieldError ? (
              <p
                id={errorId}
                role="alert"
                data-testid={`param-error-${stepId}-${field.key}`}
                className="cl-badge-error rounded px-2 py-1 text-[11px] font-medium"
              >
                [Error] {fieldError.message}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
