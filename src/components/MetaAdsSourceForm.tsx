import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface MetaAdsSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface MetaAdsSourceFormHandle {
  connect(): Promise<void>;
}

export const MetaAdsSourceForm = forwardRef<MetaAdsSourceFormHandle, MetaAdsSourceFormProps>(
  function MetaAdsSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [accessToken, setAccessToken] = useState("");
    const [adAccountId, setAdAccountId] = useState("");

    const canConnect = accessToken.trim().length > 0 && adAccountId.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("Meta Ads", "meta_ads", {
            accessToken: accessToken.trim(),
            adAccountId: adAccountId.trim(),
          }, agentId);
          toast.success("Meta Ads connected");
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
          <Input type="password" placeholder="Facebook Marketing API access token" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Ad Account ID</Label>
          <Input placeholder="act_123456789" value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Generate a token in Meta Business Suite &gt; Business Settings &gt; System Users with ads_read permission.
        </p>
      </div>
    );
  }
);
