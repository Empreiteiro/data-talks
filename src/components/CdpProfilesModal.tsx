/**
 * CdpProfilesModal — Browse unified customer profiles from materialized CDP tables.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, UserCheck } from "lucide-react";
import { dataClient } from "@/services/dataClient";

interface CdpProfilesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

export function CdpProfilesModal({ open, onOpenChange, agentId }: CdpProfilesModalProps) {
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [sourceName, setSourceName] = useState("");

  useEffect(() => {
    if (!open) return;
    loadProfiles();
  }, [open, agentId]);

  async function loadProfiles() {
    setLoading(true);
    try {
      // Find CDP materialized source (unified_customers, enriched_customers, or customer_segments)
      const sources = await dataClient.listSources(agentId);
      const cdpSource = sources.find((s: { name: string }) =>
        ["customer_segments.csv", "enriched_customers.csv", "unified_customers.csv"].includes(s.name)
      );

      if (!cdpSource) {
        setColumns([]);
        setRows([]);
        setSourceName("");
        return;
      }

      setSourceName(cdpSource.name);
      const meta = cdpSource.metaJSON || {};
      setColumns((meta.columns as string[]) || []);

      // Load preview rows from metadata (up to 5), or full data via preview_rows
      const previewRows = (meta.preview_rows as Record<string, unknown>[]) || [];

      // For more rows, we'll use the sample_profile to show stats
      // and the preview_rows for the table
      // Ideally we'd have an endpoint for this, but metadata has enough for a good preview
      // Let's show all available preview data
      if (previewRows.length > 0) {
        setRows(previewRows);
      } else {
        setRows([]);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  const filteredRows = search.trim()
    ? rows.filter((row) =>
        Object.values(row).some((v) =>
          String(v ?? "").toLowerCase().includes(search.toLowerCase())
        )
      )
    : rows;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Customer Profiles
          </DialogTitle>
          <DialogDescription>
            {sourceName
              ? `Viewing profiles from ${sourceName} (${rows.length} preview rows, ${columns.length} columns)`
              : "Materialize a CDP table first to view customer profiles."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : !sourceName ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <UserCheck className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No customer profiles available.</p>
              <p className="text-xs text-muted-foreground mt-1">Run the CDP Wizard and materialize a table to see profiles here.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search profiles..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Column badges */}
            <div className="flex flex-wrap gap-1 shrink-0">
              {columns.map((col) => (
                <Badge key={col} variant="outline" className="text-[10px]">{col}</Badge>
              ))}
            </div>

            {/* Data table */}
            <ScrollArea className="flex-1">
              {filteredRows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {search ? "No matching profiles." : "No profile data available."}
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr>
                      {columns.map((col) => (
                        <th key={col} className="text-left p-2 border-b font-medium whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => (
                      <tr key={i} className="border-b hover:bg-muted/50">
                        {columns.map((col) => (
                          <td key={col} className="p-2 whitespace-nowrap max-w-[200px] truncate">{String(row[col] ?? "—")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>

            <p className="text-xs text-muted-foreground text-right shrink-0">
              Showing {filteredRows.length} of {rows.length} preview rows. Use Q&A chat for full data queries.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
