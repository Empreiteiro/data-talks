import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";

interface DataPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceName: string;
  metadata: any;
}

export const DataPreviewModal = ({ open, onOpenChange, sourceName, metadata }: DataPreviewModalProps) => {
  const { t } = useLanguage();
  
  console.log('DataPreviewModal - Full metadata received:', JSON.stringify(metadata, null, 2));
  console.log('DataPreviewModal - metadata type:', typeof metadata);
  console.log('DataPreviewModal - metadata keys:', metadata ? Object.keys(metadata) : 'null/undefined');
  
  // Para BigQuery, buscar de table_infos
  let schema: string[] = [];
  let previewRows: any[] = [];
  
  if (metadata?.table_infos && metadata.table_infos.length > 0) {
    // BigQuery structure
    schema = metadata.table_infos[0]?.columns || [];
    previewRows = metadata.table_infos[0]?.preview_rows || [];
    console.log('DataPreviewModal - Using BigQuery structure from table_infos');
  } else {
    // CSV/Excel structure
    schema = metadata?.columns || [];
    previewRows = metadata?.preview_rows || [];
    console.log('DataPreviewModal - Using CSV/Excel structure');
  }
  
  console.log('DataPreviewModal - Final schema:', schema);
  console.log('DataPreviewModal - Final schema length:', schema.length);
  console.log('DataPreviewModal - Final previewRows:', previewRows);
  console.log('DataPreviewModal - Final previewRows length:', previewRows.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{t('workspace.dataPreview')}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('workspace.dataPreviewDescription')}
          </p>
        </DialogHeader>
        
        <ScrollArea className="h-[500px] w-full rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {schema.map((column: string, index: number) => (
                  <TableHead key={index} className="whitespace-nowrap">
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.length > 0 ? (
                previewRows.map((row: any, rowIndex: number) => (
                  <TableRow key={rowIndex}>
                    {schema.map((column: string, colIndex: number) => (
                      <TableCell key={colIndex} className="whitespace-nowrap">
                        {row[column] !== null && row[column] !== undefined 
                          ? String(row[column]) 
                          : '-'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={schema.length} className="text-center text-muted-foreground">
                    {t('workspace.noPreviewData')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
