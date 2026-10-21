import { Modal } from '@heroui/react';
import { EmbedUsageSettings } from '@/components/EmbedUsageSettings';

/** Dedicated Web-only modal for embeddable usage cards (not part of Settings). */
export function EmbedUsageModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container className="w-full max-w-none" scroll="inside" size="lg">
        <Modal.Dialog
          aria-label="用量卡片"
          className="flex min-h-0 flex-col overflow-hidden font-sans"
          style={{
            width: 960,
            height: 760,
            maxWidth: 'calc(100vw - 2rem)',
            maxHeight: 'calc(100dvh - 5rem)',
          }}
        >
          <Modal.CloseTrigger aria-label="关闭用量卡片" />
          <Modal.Header>
            <Modal.Heading>用量卡片</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="min-h-0 flex-1 overflow-y-auto p-5">
            {isOpen ? <EmbedUsageSettings /> : null}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
