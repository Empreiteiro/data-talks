import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface ShopifySourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface ShopifySourceFormHandle {
  connect: () => Promise<void>;
}

export const ShopifySourceForm = forwardRef<ShopifySourceFormHandle, ShopifySourceFormProps>(
  function ShopifySourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [store, setStore] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [resourceCounts, setResourceCounts] = useState<Record<string, number> | null>(null);
    const [shopInfo, setShopInfo] = useState<Record<string, string> | null>(null);

    const canConnect = connectionTested;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => {
      setConnectionTested(false);
      setResourceCounts(null);
      setShopInfo(null);
    }, [store, accessToken]);

    const handleTestConnection = async () => {
      if (!store.trim() || !accessToken.trim()) return;
      setTestingConnection(true);
      try {
        const res = await dataClient.shopifyTestConnection({ store: store.trim(), accessToken });
        setConnectionTested(true);
        setShopInfo(res.shop || null);
        toast.success(t('addSource.shopifyConnectionSuccess'));
        // Discover resources
        try {
          const discoverRes = await dataClient.shopifyDiscover({ store: store.trim(), accessToken });
          setResourceCounts(discoverRes.resourceCounts || {});
        } catch {
          setResourceCounts(null);
        }
      } catch (error: unknown) {
        setConnectionTested(false);
        toast.error(t('addSource.shopifyConnectionFailed'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!store || !accessToken) {
        toast.error(t('addSource.shopifyFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const name = shopInfo?.name ? `Shopify - ${shopInfo.name}` : "Shopify Store";
        const metadata: Record<string, unknown> = {
          store: store.trim(),
          accessToken,
          resourceCounts: resourceCounts || {},
        };

        const source = await dataClient.createSource(name, 'shopify', metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources
              .filter((s) => s.id !== source.id && s.type !== 'sql_database')
              .map((s) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }
        try {
          await dataClient.shopifyRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.shopifyConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error: unknown) {
        console.error('Shopify connection error:', error);
        toast.error(t('addSource.shopifyConnectError'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Shopify</strong> — {t('addSource.shopifyDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.shopifyHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="shopify-store">{t('addSource.shopifyStore')}</Label>
          <Input
            id="shopify-store"
            type="text"
            placeholder={t('addSource.shopifyStorePlaceholder')}
            value={store}
            onChange={(e) => setStore(e.target.value)}
            disabled={testingConnection}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="shopify-access-token">{t('addSource.shopifyAccessToken')}</Label>
          <div className="flex gap-2">
            <Input
              id="shopify-access-token"
              type="password"
              placeholder={t('addSource.shopifyAccessTokenPlaceholder')}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              disabled={testingConnection}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!store.trim() || !accessToken.trim() || testingConnection}
              className="shrink-0"
            >
              {testingConnection ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.shopifyTestingConnection')}</>
              ) : connectionTested ? (
                <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.shopifyConnectionSuccess')}</>
              ) : (
                t('addSource.shopifyTestConnection')
              )}
            </Button>
          </div>
        </div>

        {connectionTested && shopInfo && (
          <div className="space-y-2">
            <Label>{t('addSource.shopifyShopInfo')}</Label>
            <div className="p-3 bg-muted/50 rounded text-sm space-y-1">
              {shopInfo.name && <div><span className="font-medium">Name:</span> {shopInfo.name}</div>}
              {shopInfo.domain && <div><span className="font-medium">Domain:</span> {shopInfo.domain}</div>}
              {shopInfo.plan_name && <div><span className="font-medium">Plan:</span> {shopInfo.plan_name}</div>}
            </div>
          </div>
        )}

        {connectionTested && resourceCounts && (
          <div className="space-y-2">
            <Label>{t('addSource.shopifyResourcesFound')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(resourceCounts).map(([key, count]) => (
                <div key={key} className="p-2 bg-muted/50 rounded text-sm">
                  <span className="font-medium capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground ml-1">({count})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }
);
