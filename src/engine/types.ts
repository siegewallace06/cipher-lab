export type ParameterValue = string | number | boolean;
export type Parameters = Readonly<Record<string, ParameterValue>>;

export type ErrorCode =
  | 'INVALID_PARAMETERS'
  | 'INVALID_UTF8'
  | 'INVALID_INPUT'
  | 'LIMIT_EXCEEDED'
  | 'UNSUPPORTED_ENVIRONMENT'
  | 'AUTHENTICATION_FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export interface OperationError {
  code: ErrorCode;
  message: string; // static, safe user message, never input or secret values
  field?: string;
}

export interface ParameterField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'select' | 'secret';
  required: boolean;
  secret: boolean;
  defaultValue?: ParameterValue;
  options?: readonly ParameterValue[];
  min?: number;
  max?: number;
  maxBytes?: number;
  placeholder?: string;
  description?: string;
}

export interface OperationContext {
  signal: AbortSignal;
  crypto: Pick<Crypto, 'subtle' | 'getRandomValues'>;
  maxOutputBytes: number;
}

export type OperationCategory = 'encoding' | 'ciphers' | 'crypto' | 'text';

export interface OperationDefinition {
  id: string;
  label: string;
  category: OperationCategory;
  description: string;
  inputKind: 'bytes' | 'utf8';
  parameters: readonly ParameterField[];
  securityNote?: string;
  validate(params: Parameters): readonly OperationError[];
  execute(
    input: Uint8Array,
    params: Parameters,
    context: OperationContext,
  ): Promise<Uint8Array>;
}

export interface PipelineStep {
  id: string; // random instance identity, independent of operation ID
  operationId: string;
  enabled: boolean;
  params: Parameters;
}

export type StepResult =
  | {
      stepId: string;
      status: 'success' | 'bypassed';
      output: Uint8Array;
      byteLength: number;
      durationMs: number;
    }
  | {
      stepId: string;
      status: 'error';
      error: OperationError;
      durationMs: number;
    }
  | {
      stepId: string;
      status: 'not-run';
    };

export type PipelineExecutionResult =
  | {
      runId: string;
      revision: number;
      status: 'success';
      steps: StepResult[];
      output: Uint8Array;
      durationMs: number;
    }
  | {
      runId: string;
      revision: number;
      status: 'error' | 'cancelled';
      steps: StepResult[];
      error: OperationError;
      durationMs: number;
    };

export class OperationFailure extends Error {
  public readonly operationError: OperationError;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'OperationFailure';
    this.operationError = field ? { code, message, field } : { code, message };
  }
}

export type WorkerRunMessage = {
  type: 'run';
  runId: string;
  revision: number;
  input: Uint8Array;
  steps: PipelineStep[];
};

export type WorkerOutboundMessage =
  | {
      type: 'step-start';
      runId: string;
      revision: number;
      stepId: string;
      operationId: string;
    }
  | {
      type: 'step-result';
      runId: string;
      revision: number;
      result: StepResult;
    }
  | {
      type: 'complete';
      result: PipelineExecutionResult;
    };
