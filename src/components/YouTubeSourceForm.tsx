import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface YouTubeSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface YouTubeSourceFormHandle {
  connect(): Promise<void>;
}

export const YouTubeSourceForm = forwardRef<YouTubeSourceFormHandle, YouTubeSourceFormProps>(
  function YouTubeSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [apiKey, setApiKey] = useState("");
    const [channelId, setChannelId] = useState("");

    const canConnect = apiKey.trim().length > 0 && channelId.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("YouTube Analytics", "youtube", {
            apiKey: apiKey.trim(),
            channelId: channelId.trim(),
          }, agentId);
          toast.success("YouTube Analytics connected");
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
          <Input type="password" placeholder="YouTube Data API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Channel ID</Label>
          <Input placeholder="UC..." value={channelId} onChange={(e) => setChannelId(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Create an API key in Google Cloud Console with YouTube Data API v3 enabled.
        </p>
      </div>
    );
  }
);
