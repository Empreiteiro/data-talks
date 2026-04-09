import { forwardRef, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface AwsCostSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface AwsCostSourceFormHandle {
  connect(): Promise<void>;
}

export const AwsCostSourceForm = forwardRef<AwsCostSourceFormHandle, AwsCostSourceFormProps>(
  function AwsCostSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [accessKeyId, setAccessKeyId] = useState("");
    const [secretAccessKey, setSecretAccessKey] = useState("");
    const [region, setRegion] = useState("us-east-1");

    const canConnect = accessKeyId.trim().length > 0 && secretAccessKey.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("AWS Cost Explorer", "aws_costs", {
            accessKeyId: accessKeyId.trim(),
            secretAccessKey: secretAccessKey.trim(),
            region: region.trim() || "us-east-1",
          }, agentId);
          toast.success("AWS Cost Explorer connected");
          onSourceAdded?.(source?.id || "");
          onClose();
        } catch (err: unknown) {
          toast.error("Failed to connect", { description: err instanceof Error ? err.message : String(err) });
        } finally {
          onConnectingChange?.(false);
        }
      },
    }));

    // Update parent about connect availability
    if (onCanConnectChange) onCanConnectChange(canConnect);

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>AWS Access Key ID</Label>
          <Input placeholder="AKIA..." value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>AWS Secret Access Key</Label>
          <Input type="password" placeholder="Secret key" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Region</Label>
          <Input placeholder="us-east-1" value={region} onChange={(e) => setRegion(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Requires IAM permissions for Cost Explorer API (ce:GetCostAndUsage).
        </p>
      </div>
    );
  }
);
