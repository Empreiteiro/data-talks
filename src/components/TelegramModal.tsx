import { TelegramConnectionPanel } from "@/components/TelegramConnectionPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { Send } from "lucide-react";

interface TelegramModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

export function TelegramModal({ open, onOpenChange, agentId }: TelegramModalProps) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-words pr-8">
            <Send className="h-5 w-5 shrink-0 text-blue-500" />
            {t("telegram.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <TelegramConnectionPanel agentId={agentId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
