/**
 * CdpSegmentsModal — View and manage customer segments from the CDP wizard.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { getApiUrl, getToken } from "@/config";

async function cdpApi<T>(path: string): Promise<T> {
  const base = getApiUrl();
  const res = await fetch(`${base}/api/cdp${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

interface Segment {
  name: string;
  description: string;
  rule_sql: string;
}

interface CdpSegmentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

export function CdpSegmentsModal({ open, onOpenChange, agentId }: CdpSegmentsModalProps) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [segmentSql, setSegmentSql] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const config = await cdpApi<Record<string, unknown>>(`/config/${agentId}`);
        const seg = config?.segmentation as Record<string, unknown> | undefined;
        if (seg) {
          setSegments((seg.segments as Segment[]) || []);
          setSegmentSql(String(seg.segment_sql || ""));
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [open, agentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Customer Segments
          </DialogTitle>
          <DialogDescription>
            Segments defined by the CDP Wizard. Run the wizard to create or update segments.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : segments.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No segments defined yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Run the CDP Wizard → Segmentation step to create segments.</p>
            </div>
          ) : (
            <>
              {segments.map((seg, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge>{seg.name}</Badge>
                    <span className="text-sm text-muted-foreground">{seg.description}</span>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <span className="text-[10px] text-muted-foreground block mb-1">Rule:</span>
                    <code className="text-xs font-mono">{seg.rule_sql}</code>
                  </div>
                </Card>
              ))}

              {segmentSql && (
                <Card className="p-4">
                  <span className="text-xs font-medium text-muted-foreground mb-2 block">Full segmentation SQL:</span>
                  <pre className="bg-muted rounded p-3 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-48">{segmentSql}</pre>
                </Card>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
