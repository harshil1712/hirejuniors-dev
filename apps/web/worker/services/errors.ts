export type ServiceErrorCode =
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "upstream_failed"
  | "unavailable";

/** Errors callers translate into HTTP status. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly details?: { path: string; message: string }[];

  constructor(
    code: ServiceErrorCode,
    message: string,
    details?: { path: string; message: string }[],
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
