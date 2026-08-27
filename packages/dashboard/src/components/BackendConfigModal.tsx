import { Gear } from "@gravity-ui/icons";
import { Button, Modal } from "@heroui/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import {
  OPEN_SETTINGS_EVENT,
  type OpenSettingsDetail,
  type SettingsTabId,
} from "@/lib/shell-events";

interface BackendConfigModalProps {
  /** Custom trigger; when omitted and uncontrolled, renders a default tertiary button. */
  trigger?: ReactNode;
  /** Controlled open state. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Listen for `tud:open-settings` to open (default true when uncontrolled or when shell mounts). */
  listenForOpenEvent?: boolean;
  /** Hide the default trigger (shell-owned modal with event / external open only). */
  hideTrigger?: boolean;
  activeTab?: SettingsTabId;
  onTabChange?: (tab: SettingsTabId) => void;
}

/** Backend configuration trigger and controlled modal. */
export function BackendConfigModal({
  trigger,
  isOpen: controlledOpen,
  onOpenChange,
  listenForOpenEvent = true,
  hideTrigger = false,
  activeTab: controlledTab,
  onTabChange,
}: BackendConfigModalProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [uncontrolledTab, setUncontrolledTab] = useState<SettingsTabId>("sync");
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const activeTab = controlledTab ?? uncontrolledTab;

  const setOpen = useCallback(
    (open: boolean) => {
      if (!isControlled) setUncontrolledOpen(open);
      onOpenChange?.(open);
    },
    [isControlled, onOpenChange],
  );

  const setTab = useCallback(
    (tab: SettingsTabId) => {
      if (controlledTab === undefined) setUncontrolledTab(tab);
      onTabChange?.(tab);
    },
    [controlledTab, onTabChange],
  );

  useEffect(() => {
    if (!listenForOpenEvent) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenSettingsDetail>).detail;
      if (detail?.tab) setTab(detail.tab);
      setOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, [listenForOpenEvent, setOpen, setTab]);

  return (
    <>
      {!hideTrigger &&
        (trigger ?? (
          <Button
            aria-label="设置"
            onPress={() => setOpen(true)}
            variant="tertiary"
          >
            <Gear />
            设置
          </Button>
        ))}

      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={setOpen}
        variant="blur"
      >
        <Modal.Container
          className="w-[760px] max-w-[min(760px,92vw)]"
          scroll="inside"
          size="lg"
        >
          <Modal.Dialog aria-label="设置" className="overflow-hidden p-0">
            <Modal.CloseTrigger aria-label="关闭设置" className="z-20" />
            <Modal.Body className="m-0 flex-none overflow-hidden p-0">
              <SettingsPanel activeTab={activeTab} onTabChange={setTab} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
