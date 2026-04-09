import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface RdStationSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface RdStationSourceFormHandle {
  connect(): Promise<void>;
}

export const RdStationSourceForm = forwardRef<RdStationSourceFormHandle, RdStationSourceFormProps>(
  function RdStationSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [apiToken, setApiToken] = useState("");

    const canConnect = apiToken.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("RD Station", "rdstation", {
            apiToken: apiToken.trim(),
          }, agentId);
          toast.success("RD Station connected");
          onSourceAdded?.(source?.id || "");
          onClose();
        } catch (err: unknown) {
          toast.error("Failed to connect", { description: err instanceof Error ? err.message : String(err) });
        } finally {
          onConnectingChange?.(false);
        }
      },
    }));

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>API Token</Label>
          <Input type="password" placeholder="Your RD Station API token" value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Find your API token in RD Station under Account &gt; Integrations &gt; API Tokens.
        </p>
      </div>
    );
  }
);
