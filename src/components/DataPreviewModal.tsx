import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DataPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceName: string;
  metadata: any;
}

export const DataPreviewModal = ({ open, onOpenChange, sourceName, metadata }: DataPreviewModalProps) => {
  const schema = metadata?.schema || [];
  const previewRows = metadata?.preview_rows || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Preview dos Dados</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Visualização das primeiras linhas da fonte de dados
          </p>
        </DialogHeader>
        
        <ScrollArea className="h-[500px] w-full rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {schema.map((column: any, index: number) => (
                  <TableHead key={index} className="whitespace-nowrap">
                    {column.name || column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.length > 0 ? (
                previewRows.map((row: any, rowIndex: number) => (
                  <TableRow key={rowIndex}>
                    {schema.map((column: any, colIndex: number) => {
                      const columnName = column.name || column;
                      return (
                        <TableCell key={colIndex} className="whitespace-nowrap">
                          {row[columnName] !== null && row[columnName] !== undefined 
                            ? String(row[columnName]) 
                            : '-'}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={schema.length} className="text-center text-muted-foreground">
                    Nenhum dado de preview disponível
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
