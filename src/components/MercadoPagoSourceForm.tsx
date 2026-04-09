import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface MercadoPagoSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface MercadoPagoSourceFormHandle {
  connect(): Promise<void>;
}

export const MercadoPagoSourceForm = forwardRef<MercadoPagoSourceFormHandle, MercadoPagoSourceFormProps>(
  function MercadoPagoSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [accessToken, setAccessToken] = useState("");

    const canConnect = accessToken.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("Mercado Pago", "mercado_pago", {
            accessToken: accessToken.trim(),
          }, agentId);
          toast.success("Mercado Pago connected");
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
          <Input type="password" placeholder="Mercado Pago access token" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Find your access token in Mercado Pago &gt; Your business &gt; Settings &gt; Credentials.
        </p>
      </div>
    );
  }
);
