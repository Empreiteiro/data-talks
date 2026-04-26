import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2, CheckCircle2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface StripeSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface StripeSourceFormHandle {
  connect: () => Promise<void>;
}

const ALL_TABLES = [
  "customers",
  "subscriptions",
  "invoices",
  "charges",
  "products",
  "prices",
  "refunds",
  "payouts",
  "disputes",
];

export const StripeSourceForm = forwardRef<StripeSourceFormHandle, StripeSourceFormProps>(
  function StripeSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [testing, setTesting] = useState(false);
    const [tested, setTested] = useState(false);
    const [discovering, setDiscovering] = useState(false);
    const [resources, setResources] = useState<Array<{ table: string; sample_count: number; has_more: boolean }>>([]);
    const [selectedTables, setSelectedTables] = useState<string[]>([...ALL_TABLES]);

    const canConnect = tested && apiKey.trim().length > 0 && selectedTables.length > 0;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    // Reset test state when key changes
    useEffect(() => {
      setTested(false);
      setResources([]);
    }, [apiKey]);

    const handleTestConnection = async () => {
      if (!apiKey.trim()) return;
      setTesting(true);
      try {
        await dataClient.stripeTestConnection({ apiKey });
        toast.success(t('addSource.stripeTestSuccess'));

        // Auto-discover resources after successful connection
        setDiscovering(true);
        try {
          const result = await dataClient.stripeDiscover({ apiKey, tables: ALL_TABLES });
          setResources(result.resources || []);
          setSelectedTables(
            (result.resources || [])
              .filter((r: { _error?: string }) => !r._error)
              .map((r: { table: string }) => r.table)
          );
        } catch {
          // Non-blocking: we can still connect without discovery
        } finally {
          setDiscovering(false);
        }

        setTested(true);
      } catch (error) {
        setTested(false);
        toast.error(t('addSource.stripeTestFailed'), { description: (error as Error).message });
      } finally {
        setTesting(false);
      }
    };

    const handleConnect = async () => {
      if (!apiKey.trim()) {
        toast.error(t('addSource.stripeFillFields'));
        return;
      }
      if (selectedTables.length === 0) {
        toast.error(t('addSource.stripeSelectTables'));
        return;
      }

      setConnecting(true);
      try {
        const name = "Stripe";
        const metadata: Record<string, unknown> = {
          apiKey,
          tables: selectedTables,
        };

        const source = await dataClient.createSource(name, 'stripe', metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources
              .filter((s) => s.id !== source.id && s.type !== 'sql_database')
              .map((s) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }

        // Refresh metadata in background
        try {
          await dataClient.stripeRefreshMetadata(source.id);
        } catch {
          // non-blocking
        }

        toast.success(t('addSource.stripeConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        console.error('Stripe connection error:', error);
        toast.error(t('addSource.stripeConnectError'), { description: (error as Error).message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Stripe</strong> — {t('addSource.stripeDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.stripeHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="stripe-api-key">{t('addSource.stripeApiKey')}</Label>
          <Input
            id="stripe-api-key"
            type="password"
            placeholder="sk_live_... or sk_test_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={testing || connecting}
          />
        </div>

        <Button
          variant="outline"
          onClick={handleTestConnection}
          disabled={!apiKey.trim() || testing || discovering}
          className="w-full"
        >
          {testing || discovering ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
              {testing ? t('addSource.stripeTesting') : t('addSource.stripeDiscovering')}
            </>
          ) : tested ? (
            <>
              <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
              {t('addSource.stripeTestSuccess')}
            </>
          ) : (
            t('addSource.stripeTestConnection')
          )}
        </Button>

        {resources.length > 0 && (
          <div className="space-y-2">
            <Label>{t('addSource.stripeResources')}</Label>
            <div className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-2">
              {resources.map((res) => {
                const isChecked = selectedTables.includes(res.table);
                // `_error` is an optional flag attached by the discovery
                // call when a specific resource failed to introspect.
                // The catalog type doesn't model it; cast to a small
                // structural shape rather than using `any`.
                const hasError = !!(res as { _error?: unknown })._error;
                return (
                  <label
                    key={res.table}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer ${hasError ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={hasError}
                        onChange={(e) => {
                          setSelectedTables((current) =>
                            e.target.checked
                              ? [...current, res.table]
                              : current.filter((t) => t !== res.table)
                          );
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm font-medium">{res.table}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {hasError
                        ? t('addSource.stripeResourceError')
                        : `${res.sample_count}${res.has_more ? '+' : ''} ${t('addSource.stripeRecords')}`}
                    </span>
                  </label>
                );
              })}
            </div>
            {selectedTables.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('addSource.stripeSelectedCount', { count: selectedTables.length })}
              </p>
            )}
          </div>
        )}
      </>
    );
  }
);
