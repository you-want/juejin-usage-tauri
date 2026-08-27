export type AutoUpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'not-available'
  | 'error';

export type AutoUpdateState = {
  status: AutoUpdateStatus;
  currentVersion: string;
  version?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  message?: string;
  checkedAt?: string;
  completedVersion?: string;
};

export const AUTO_UPDATE_GET_STATE_CHANNEL = 'auto-update:get-state';
export const AUTO_UPDATE_CHECK_CHANNEL = 'auto-update:check';
export const AUTO_UPDATE_ACK_COMPLETED_CHANNEL = 'auto-update:ack-completed';
export const AUTO_UPDATE_STATE_CHANGED_CHANNEL = 'auto-update:state-changed';
