import { forwardRef, useImperativeHandle, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";

interface MercadoLivreSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (canConnect: boolean) => void;
  onConnectingChange?: (connecting: boolean) => void;
}

export interface MercadoLivreSourceFormHandle {
  connect(): Promise<void>;
}

export const MercadoLivreSourceForm = forwardRef<MercadoLivreSourceFormHandle, MercadoLivreSourceFormProps>(
  function MercadoLivreSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [accessToken, setAccessToken] = useState("");
    const [sellerId, setSellerId] = useState("");

    const canConnect = accessToken.trim().length > 0 && sellerId.trim().length > 0;

    useImperativeHandle(ref, () => ({
      connect: async () => {
        if (!canConnect) return;
        onConnectingChange?.(true);
        try {
          const source = await dataClient.createSource("Mercado Livre", "mercado_livre", {
            accessToken: accessToken.trim(),
            sellerId: sellerId.trim(),
          }, agentId);
          toast.success("Mercado Livre connected");
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
          <Input type="password" placeholder="Mercado Livre access token" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Seller ID</Label>
          <Input placeholder="Numeric seller ID" value={sellerId} onChange={(e) => setSellerId(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Get your access token from the Mercado Livre Developers portal (developers.mercadolivre.com.br).
        </p>
      </div>
    );
  }
);
