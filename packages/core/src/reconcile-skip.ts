/** Browser-safe reconcile skip helpers (no Node builtins). */

export interface ReconcileSkippedEvent {
  event_id: string;
  reason: string;
  existing_device_id?: string | null;
  existing_occurred_at?: string;
}

/** Human-readable skip line for calibrate UI / logs (includes event_id). */
export function formatReconcileSkipReason(row: ReconcileSkippedEvent): string {
  let detail: string;
  switch (row.reason) {
    case 'occurred_at_outside_window':
      // Batch [from,to) miss — not the product 90-day range.
      detail = '不在本次校对日期窗口内';
      break;
    case 'owned_by_other_device':
      // Legacy: current server reclaims these via local-wins.
      detail = row.existing_device_id
        ? `已归属其他设备 ${row.existing_device_id}`
        : '已归属其他设备（device_id 为空）';
      break;
    case 'owned_by_other_window':
      detail = row.existing_occurred_at
        ? `线上时间 ${row.existing_occurred_at} 不在本次窗口`
        : '线上时间不在本次窗口';
      break;
    default:
      detail = row.reason;
  }
  return `${row.event_id}：${detail}`;
}
