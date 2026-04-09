import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface MixpanelSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface MixpanelSourceFormHandle {
  connect(): Promise<void>;
}

export const MixpanelSourceForm = forwardRef<MixpanelSourceFormHandle, MixpanelSourceFormProps>(
  function MixpanelSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [username, setUsername] = useState("");
    const [secret, setSecret] = useState("");
    const [projectId, setProjectId] = useState("");

    const canConnect = username.trim().length > 0 && secret.trim().length > 0 && projectId.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("Mixpanel", "mixpanel", {
            serviceAccountUsername: username.trim(),
            serviceAccountSecret: secret.trim(),
            projectId: projectId.trim(),
          }, agentId);
          toast.success("Mixpanel connected");
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
          <Label>Service Account Username</Label>
          <Input placeholder="Service account username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Service Account Secret</Label>
          <Input type="password" placeholder="Service account secret" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Project ID</Label>
          <Input placeholder="Numeric project ID" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Create a service account in Mixpanel &gt; Project Settings &gt; Service Accounts.
        </p>
      </div>
    );
  }
);
