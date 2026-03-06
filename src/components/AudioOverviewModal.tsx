import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";

export interface AudioOverviewItem {
  id: string;
  agentId: string;
  sourceId: string;
  sourceName: string;
  script: string;
  mimeType: string;
  createdAt: string;
}

interface AudioOverviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

export function AudioOverviewModal({ open, onOpenChange, workspaceId }: AudioOverviewModalProps) {
  const { t } = useLanguage();
  const [sources, setSources] = useState<Array<{ id: string; name: string; type: string; is_active?: boolean }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [audioOverviews, setAudioOverviews] = useState<AudioOverviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [generatedOverview, setGeneratedOverview] = useState<AudioOverviewItem | null>(null);
  const [viewingOverview, setViewingOverview] = useState<AudioOverviewItem | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    (async () => {
      try {
        const [sourceList, audioList] = await Promise.all([
          dataClient.listSources(workspaceId, undefined),
          dataClient.listAudioOverviews(workspaceId),
        ]);
        setSources(sourceList || []);
        setAudioOverviews(audioList || []);
        const list = sourceList || [];
        const active = list.find((s) => s.is_active) || list[0];
        if (active && !selectedSourceId) setSelectedSourceId(active.id);
        else if (list.length && !selectedSourceId) setSelectedSourceId(list[0].id);
      } catch (e) {
        console.error(e);
        toast.error(t("studio.audioLoadError"));
      }
    })();
  }, [open, workspaceId, selectedSourceId, t]);

  const displayOverview = viewingOverview ?? generatedOverview;
  const canGenerate = sources.length > 0 && selectedSourceId && !loading;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!open || !displayOverview) {
      setAudioUrl(null);
      setLoadingAudio(false);
      return;
    }

    setLoadingAudio(true);
    dataClient.fetchAudioOverviewBlob(displayOverview.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error(t("studio.audioPlaybackError"), {
          description: error instanceof Error ? error.message : String(error),
        });
        setAudioUrl(null);
      })
      .finally(() => {
        if (active) setLoadingAudio(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [displayOverview, open, t]);

  const helperText = useMemo(() => t("studio.audioRequiresConfig"), [t]);

  const handleGenerate = async () => {
    if (!workspaceId || !selectedSourceId) return;
    setLoading(true);
    setGeneratedOverview(null);
    setViewingOverview(null);
    try {
      const result = await dataClient.generateAudioOverview(workspaceId, selectedSourceId);
      setGeneratedOverview(result);
      setAudioOverviews((prev) => [result, ...prev]);
      toast.success(t("studio.audioSaved"));
    } catch (err: unknown) {
      toast.error(t("studio.audioGenerateError"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleViewSaved = (item: AudioOverviewItem) => {
    setViewingOverview(item);
    setGeneratedOverview(null);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await dataClient.deleteAudioOverview(id);
      setAudioOverviews((prev) => prev.filter((item) => item.id !== id));
      if (viewingOverview?.id === id || generatedOverview?.id === id) {
        setViewingOverview(null);
        setGeneratedOverview(null);
        setAudioUrl(null);
      }
      toast.success(t("studio.audioDeleted"));
    } catch {
      toast.error(t("studio.audioDeleteError"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5" />
            {t("studio.audioTitle")}
          </DialogTitle>
          <DialogDescription>{t("studio.audioDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
          <div className="space-y-2 shrink-0">
            <Label>{t("studio.summarySource")}</Label>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.summaryNoSource")}</p>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("studio.summarySelectSource")} />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleGenerate} disabled={!canGenerate}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("studio.audioGenerate")}
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{helperText}</p>
          </div>

          <div className="space-y-2 shrink-0">
            <Label>{t("studio.audioSavedList")}</Label>
            {audioOverviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.audioNoSaved")}</p>
            ) : (
              <ScrollArea className="h-32 border rounded-md">
                <ul className="p-2 space-y-1">
                  {audioOverviews.map((item) => (
                    <li key={item.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewSaved(item)}
                        onKeyDown={(e) => e.key === "Enter" && handleViewSaved(item)}
                        className={`flex w-full items-center justify-between gap-2 overflow-hidden rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer ${
                          viewingOverview?.id === item.id || generatedOverview?.id === item.id
                            ? "border-accent/40 bg-accent text-accent-foreground"
                            : "border-transparent bg-transparent hover:bg-accent/80 hover:text-accent-foreground"
                        }`}
                      >
                        <span className="truncate">
                          {item.sourceName} — {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-inherit hover:bg-background/10 hover:text-inherit"
                          onClick={(e) => handleDelete(e, item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>

          {(displayOverview || loading) && (
            <div className="border rounded-lg flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-muted/50 text-sm font-medium shrink-0">
                {displayOverview
                  ? `${displayOverview.sourceName} — ${new Date(displayOverview.createdAt).toLocaleString()}`
                  : t("studio.audioGenerating")}
              </div>
              <ScrollArea className="h-full min-h-0 flex-1">
                <div className="p-4 pr-6 space-y-4">
                  {loading || loadingAudio ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{loading ? t("studio.audioGenerating") : t("studio.audioPreparing")}</span>
                    </div>
                  ) : displayOverview && audioUrl ? (
                    <>
                      <audio controls className="w-full">
                        <source src={audioUrl} type={displayOverview.mimeType || "audio/mpeg"} />
                      </audio>
                      <div className="border rounded-md bg-muted/20 p-4">
                        <p className="text-sm leading-relaxed text-foreground">{displayOverview.script}</p>
                      </div>
                    </>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
