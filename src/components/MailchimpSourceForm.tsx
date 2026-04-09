import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface MailchimpSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface MailchimpSourceFormHandle {
  connect(): Promise<void>;
}

export const MailchimpSourceForm = forwardRef<MailchimpSourceFormHandle, MailchimpSourceFormProps>(
  function MailchimpSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [apiKey, setApiKey] = useState("");

    const canConnect = apiKey.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("Mailchimp", "mailchimp", {
            apiKey: apiKey.trim(),
          }, agentId);
          toast.success("Mailchimp connected");
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
          <Label>API Key</Label>
          <Input type="password" placeholder="xxxxxxxx-us21 (key-datacenter)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Generate an API key in Mailchimp &gt; Account &gt; Extras &gt; API keys. The datacenter suffix (e.g. us21) is included in the key.
        </p>
      </div>
    );
  }
);
