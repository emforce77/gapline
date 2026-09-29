import { ZodError } from "zod";
import type { RunErrorCode } from "../api-contract";
import { ModelOutputError, ServiceError } from "../errors";
import { ProviderError } from "../llm/gemini";
import { FfmpegError } from "../media/ffmpeg";
import { BudgetExhaustedError } from "./budget";

/** What the browser learns about a failed run or edit: a stable code, never internal text. */
export interface FailureInfo {
  code: RunErrorCode;
  retryable?: boolean;
  retryAfterSeconds?: number;
  resetAt?: string;
}

export function describeFailure(error: unknown): FailureInfo {
  if (error instanceof BudgetExhaustedError)
    return {
      code: error.code,
      retryable: error.code === "budget_busy",
      ...(error.resetAt ? { resetAt: error.resetAt } : {}),
    };
  if (error instanceof ProviderError)
    return error.retryable
      ? {
          code: "provider_busy",
          retryable: true,
          retryAfterSeconds: Math.ceil(error.retryAfterSeconds),
        }
      : { code: "provider_failed", retryable: false };
  if (error instanceof ServiceError) return { code: error.code, retryable: error.retryable };
  // JSON.parse (SyntaxError) and zod reject what the model streamed back.
  if (
    error instanceof ModelOutputError ||
    error instanceof ZodError ||
    error instanceof SyntaxError
  )
    return { code: "model_output", retryable: true };
  if (error instanceof FfmpegError) return { code: "media_failed", retryable: false };
  return { code: "internal" };
}
