import { forwardRef, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface GoogleAdsSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface GoogleAdsSourceFormHandle {
  connect(): Promise<void>;
}

export const GoogleAdsSourceForm = forwardRef<GoogleAdsSourceFormHandle, GoogleAdsSourceFormProps>(
  function GoogleAdsSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [developerToken, setDeveloperToken] = useState("");
    const [customerId, setCustomerId] = useState("");
    const [refreshToken, setRefreshToken] = useState("");
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");

    const canConnect =
      developerToken.trim().length > 0 && customerId.trim().length > 0 &&
      refreshToken.trim().length > 0 && clientId.trim().length > 0 && clientSecret.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("Google Ads", "google_ads", {
            developerToken: developerToken.trim(),
            customerId: customerId.trim(),
            refreshToken: refreshToken.trim(),
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          }, agentId);
          toast.success("Google Ads connected");
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
          <Label>Developer Token</Label>
          <Input type="password" placeholder="Google Ads developer token" value={developerToken} onChange={(e) => setDeveloperToken(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Customer ID</Label>
          <Input placeholder="123-456-7890 (no dashes)" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Refresh Token</Label>
          <Input type="password" placeholder="OAuth2 refresh token" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Client ID</Label>
          <Input placeholder="OAuth2 client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Client Secret</Label>
          <Input type="password" placeholder="OAuth2 client secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Set up OAuth2 credentials in Google Cloud Console and get a developer token from Google Ads API Center.
        </p>
      </div>
    );
  }
);
