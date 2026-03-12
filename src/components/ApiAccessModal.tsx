import { ApiAccessPanel } from "@/components/ApiAccessPanel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { Terminal } from "lucide-react";

interface ApiAccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

export function ApiAccessModal({ open, onOpenChange, agentId }: ApiAccessModalProps) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-words pr-8">
            <Terminal className="h-5 w-5 shrink-0 text-primary" />
            {t("apiAccess.title")}
          </DialogTitle>
          <DialogDescription className="pr-8">
            {t("apiAccess.description")}
          </DialogDescription>
        </DialogHeader>

        <ApiAccessPanel agentId={agentId} />
      </DialogContent>
    </Dialog>
  );
}
