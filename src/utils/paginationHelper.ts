/**
 * Shared, dependency-free guards for Firestore list pagination and archival.
 * Keeping these rules here makes the limits easy to test without Firestore.
 */

/** Firestore permits at most 500 writes in one atomic batch. */
export const FIRESTORE_MAX_BATCH_WRITES = 500;

/** Archiving one audit log writes its archive copy and deletes its live copy. */
export const AUDIT_ARCHIVE_WRITES_PER_RECORD = 2;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 250;
export const DEFAULT_AUDIT_ARCHIVE_BATCH_SIZE = 200;

/**
 * Clamp a requested page size so a malformed UI value cannot produce an
 * unexpectedly expensive query.
 */
export function normalizePageSize(
  requestedSize: number | undefined,
  fallback = DEFAULT_PAGE_SIZE,
  maximum = MAX_PAGE_SIZE
): number {
  const parsed = Number(requestedSize);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

/**
 * Derive page metadata from a Firestore query that requested one extra
 * sentinel document. The next Firestore cursor itself remains opaque, but this
 * pure decision is shared by the service and tests.
 */
export function getCursorPageMetadata(
  returnedRecordCount: number,
  requestedPageSize?: number
): { pageSize: number; itemCount: number; hasMore: boolean } {
  const pageSize = normalizePageSize(requestedPageSize);
  const safeCount = Math.max(0, Math.floor(Number(returnedRecordCount) || 0));
  return {
    pageSize,
    itemCount: Math.min(safeCount, pageSize),
    hasMore: safeCount > pageSize
  };
}

/**
 * Converts inclusive YYYY-MM-DD controls to lexicographically safe bounds for
 * Firestore string timestamps. A stored plain date and a full ISO timestamp on
 * the same calendar day are both included by the end bound.
 */
export function getInclusiveDateBounds(
  startDate?: string,
  endDate?: string
): { start?: string; end?: string } {
  const start = startDate?.trim() || undefined;
  const cleanEnd = endDate?.trim();

  return {
    start,
    end: cleanEnd ? `${cleanEnd.slice(0, 10)}T23:59:59.999Z` : undefined
  };
}

/**
 * An archive batch has two writes per source audit record. Clamp it below the
 * Firestore atomic-write ceiling so a completed batch can never leave a record
 * copied without its matching source deletion (or the reverse).
 */
export function getSafeArchiveBatchSize(requestedSize?: number): number {
  const maximumRecords = Math.floor(FIRESTORE_MAX_BATCH_WRITES / AUDIT_ARCHIVE_WRITES_PER_RECORD);
  const requested = normalizePageSize(
    requestedSize,
    DEFAULT_AUDIT_ARCHIVE_BATCH_SIZE,
    maximumRecords
  );
  return Math.min(requested, maximumRecords);
}

/** The exclusive archive cutoff is the start of the selected calendar day. */
export function getArchiveCutoffTimestamp(cutoffDate: string): string {
  const clean = cutoffDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw new Error('A data de arquivo deve estar no formato AAAA-MM-DD.');
  }
  return `${clean}T00:00:00.000Z`;
}
