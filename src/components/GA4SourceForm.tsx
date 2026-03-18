import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface GA4SourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface GA4SourceFormHandle {
  connect: () => Promise<void>;
}

export const GA4SourceForm = forwardRef<GA4SourceFormHandle, GA4SourceFormProps>(
  function GA4SourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [credentialsContent, setCredentialsContent] = useState("");
    const [propertyId, setPropertyId] = useState("");
    const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
    const [testError, setTestError] = useState("");

    const canConnect = !!credentialsContent.trim() && !!propertyId.trim() && testStatus === "success";

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        JSON.parse(text); // validate JSON
        setCredentialsContent(text);
        setTestStatus("idle");
      } catch {
        toast.error(t("addSource.ga4InvalidJson"));
        setCredentialsContent("");
      }
    };

    const handleTestConnection = async () => {
      if (!credentialsContent.trim() || !propertyId.trim()) {
        toast.error(t("addSource.ga4FillFields"));
        return;
      }
      setTestStatus("testing");
      setTestError("");
      try {
        await dataClient.ga4TestConnection({
          credentialsContent,
          propertyId,
        });
        setTestStatus("success");
        toast.success(t("addSource.ga4ConnectionSuccess"));
      } catch (error: unknown) {
        setTestStatus("error");
        const msg = error instanceof Error ? error.message : String(error);
        setTestError(msg);
        toast.error(t("addSource.ga4ConnectionFailed"), { description: msg });
      }
    };

    const handleConnect = async () => {
      if (!credentialsContent.trim() || !propertyId.trim()) {
        toast.error(t("addSource.ga4FillFields"));
        return;
      }

      setConnecting(true);
      try {
        const name = `GA4 Property ${propertyId}`;
        const metadata = {
          credentialsContent,
          propertyId,
          tables: [
            "page_views",
            "traffic_sources",
            "events",
            "user_demographics",
            "device_data",
            "conversions",
            "ecommerce",
          ],
        };

        const source = await dataClient.createSource(name, "ga4" as Parameters<typeof dataClient.createSource>[1], metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources
              .filter((s) => s.id !== source.id && s.type !== "sql_database")
              .map((s) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }
        try {
          await dataClient.ga4RefreshMetadata(source.id);
        } catch {
          // non-blocking
        }

        toast.success(t("addSource.ga4ConnectSuccess"));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error: unknown) {
        console.error("GA4 connection error:", error);
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(t("addSource.ga4ConnectError"), { description: msg });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Google Analytics 4</strong> — {t("addSource.ga4Description")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("addSource.ga4Hint")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ga4-credentials">{t("addSource.ga4Credentials")}</Label>
          <Input
            id="ga4-credentials"
            type="file"
            accept=".json"
            onChange={handleFileUpload}
          />
          {credentialsContent && (
            <Textarea
              value={credentialsContent}
              onChange={(e) => {
                setCredentialsContent(e.target.value);
                setTestStatus("idle");
              }}
              className="font-mono text-xs"
              rows={4}
              placeholder={t("addSource.ga4CredentialsPlaceholder")}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ga4-property-id">{t("addSource.ga4PropertyId")}</Label>
          <Input
            id="ga4-property-id"
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setTestStatus("idle");
            }}
            placeholder={t("addSource.ga4PropertyIdPlaceholder")}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={!credentialsContent.trim() || !propertyId.trim() || testStatus === "testing"}
          >
            {testStatus === "testing" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                {t("addSource.ga4TestingConnection")}
              </>
            ) : (
              t("addSource.ga4TestConnection")
            )}
          </Button>
          {testStatus === "success" && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              {t("addSource.ga4ConnectionSuccess")}
            </span>
          )}
          {testStatus === "error" && (
            <span className="flex items-center gap-1 text-sm text-red-600">
              <XCircle className="h-4 w-4" />
              {testError || t("addSource.ga4ConnectionFailed")}
            </span>
          )}
        </div>
      </>
    );
  }
);
