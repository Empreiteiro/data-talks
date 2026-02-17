import { LogsModal } from "@/components/LogsModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Terminal } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";

interface LogsPanelProps {
  /** Log count to show in badge (e.g. after fetching). Optional. */
  logCount?: number;
}

export function LogsPanel({ logCount = 0 }: LogsPanelProps) {
  const { t } = useLanguage();
  const { isAuthenticated, loginRequired } = useAuth();
  const [expanded, setExpanded] = useState(false);

  if (!isAuthenticated && loginRequired) return null;

  return (
    <>
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          variant="secondary"
          size="sm"
          className="h-11 gap-2 rounded-full shadow-lg border bg-background/95 backdrop-blur hover:bg-accent"
          onClick={() => setExpanded(true)}
        >
          <Terminal className="h-4 w-4" />
          <span className="hidden sm:inline">{t("logs.button")}</span>
          {logCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-xs">
              {logCount}
            </Badge>
          )}
        </Button>
      </div>

      <LogsModal open={expanded} onOpenChange={setExpanded} />
    </>
  );
}
