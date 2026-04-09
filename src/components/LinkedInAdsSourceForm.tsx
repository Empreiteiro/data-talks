import { forwardRef, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface LinkedInAdsSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface LinkedInAdsSourceFormHandle {
  connect(): Promise<void>;
}

export const LinkedInAdsSourceForm = forwardRef<LinkedInAdsSourceFormHandle, LinkedInAdsSourceFormProps>(
  function LinkedInAdsSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [accessToken, setAccessToken] = useState("");
    const [adAccountId, setAdAccountId] = useState("");

    const canConnect = accessToken.trim().length > 0 && adAccountId.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("LinkedIn Ads", "linkedin_ads", {
            accessToken: accessToken.trim(),
            adAccountId: adAccountId.trim(),
          }, agentId);
          toast.success("LinkedIn Ads connected");
          onSourceAdded?.(source?.id || "");
          onClose();
        } catch (err: unknown) {
          toast.error("Failed to connect", { description: err instanceof Error ? err.message : String(err) });
        } finally {
          onConnectingChange?.(false);
        }
      },
    }));

    if (onCanConnectChange) onCanConnectChange(canConnect);

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Access Token</Label>
          <Input type="password" placeholder="LinkedIn OAuth access token" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Ad Account ID</Label>
          <Input placeholder="Sponsored account ID (numeric)" value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Generate an access token from the LinkedIn Marketing Developer Portal with Ads reporting permissions.
        </p>
      </div>
    );
  }
);
