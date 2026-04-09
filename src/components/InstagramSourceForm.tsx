import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface InstagramSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface InstagramSourceFormHandle {
  connect(): Promise<void>;
}

export const InstagramSourceForm = forwardRef<InstagramSourceFormHandle, InstagramSourceFormProps>(
  function InstagramSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [accessToken, setAccessToken] = useState("");
    const [accountId, setAccountId] = useState("");

    const canConnect = accessToken.trim().length > 0 && accountId.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("Instagram Insights", "instagram", {
            accessToken: accessToken.trim(),
            accountId: accountId.trim(),
          }, agentId);
          toast.success("Instagram Insights connected");
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
          <Label>Access Token</Label>
          <Input type="password" placeholder="Facebook/Instagram access token" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Instagram Account ID</Label>
          <Input placeholder="Numeric account ID" value={accountId} onChange={(e) => setAccountId(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Requires a Facebook App with Instagram Graph API access. Get tokens from developers.facebook.com.
        </p>
      </div>
    );
  }
);
