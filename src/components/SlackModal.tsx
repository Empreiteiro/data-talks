import { SlackConnectionPanel } from "@/components/SlackConnectionPanel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { Hash } from "lucide-react";

interface SlackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

export function SlackModal({ open, onOpenChange, agentId }: SlackModalProps) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-words pr-8">
            <Hash className="h-5 w-5 shrink-0 text-primary" />
            {t("slack.title")}
          </DialogTitle>
          <DialogDescription className="pr-8">
            {t("slack.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <SlackConnectionPanel agentId={agentId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
