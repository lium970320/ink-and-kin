import { ChannelPersonaDiagnostics } from "@/components/ChannelPersonaDiagnostics";
import { MotionModal } from "@/components/ui/motion";

export interface PersonaStatePanelProps {
  personaId: number;
  onClose: () => void;
  open?: boolean;
}

export default function PersonaStatePanel({ personaId, onClose, open = true }: PersonaStatePanelProps) {
  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="角色运行诊断"
      containerClassName="p-3 sm:p-5"
      className="flex h-full max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border-border/80 bg-card/98 p-0 text-foreground shadow-2xl"
    >
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <ChannelPersonaDiagnostics
          key={personaId}
          personaId={personaId}
          enabled={open && personaId > 0}
          onClose={onClose}
        />
      </aside>
    </MotionModal>
  );
}
