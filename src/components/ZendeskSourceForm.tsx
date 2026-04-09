import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface ZendeskSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface ZendeskSourceFormHandle {
  connect(): Promise<void>;
}

export const ZendeskSourceForm = forwardRef<ZendeskSourceFormHandle, ZendeskSourceFormProps>(
  function ZendeskSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [subdomain, setSubdomain] = useState("");
    const [email, setEmail] = useState("");
    const [apiToken, setApiToken] = useState("");

    const canConnect = subdomain.trim().length > 0 && email.trim().length > 0 && apiToken.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("Zendesk", "zendesk", {
            subdomain: subdomain.trim(),
            email: email.trim(),
            apiToken: apiToken.trim(),
          }, agentId);
          toast.success("Zendesk connected");
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
          <Label>Subdomain</Label>
          <Input placeholder="yourcompany (from yourcompany.zendesk.com)" value={subdomain} onChange={(e) => setSubdomain(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" placeholder="admin@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>API Token</Label>
          <Input type="password" placeholder="Zendesk API token" value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Generate an API token in Zendesk Admin &gt; Apps and integrations &gt; APIs &gt; Zendesk API.
        </p>
      </div>
    );
  }
);
