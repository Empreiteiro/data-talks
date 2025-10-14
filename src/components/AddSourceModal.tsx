import { useState } from "react";
import { Upload, Link as LinkIcon, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AddSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSourceAdded?: () => void;
}

export function AddSourceModal({ open, onOpenChange, onSourceAdded }: AddSourceModalProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleFiles(files);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await handleFiles(files);
    }
  };

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    try {
      // TODO: Implementar upload de arquivos
      toast.success("Arquivos enviados com sucesso!");
      onSourceAdded?.();
      onOpenChange(false);
    } catch (error: any) {
      toast.error("Erro ao enviar arquivos", {
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Adicionar fontes</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            As fontes permitem que o NotebookLM baseie suas respostas nas informações mais importantes para você.
            (Exemplos: planos de marketing, leitura de curso, notas de pesquisa, transcrições de reunião, documentos de vendas, etc.)
          </p>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">Upload</TabsTrigger>
              <TabsTrigger value="bigquery">BigQuery</TabsTrigger>
              <TabsTrigger value="sheets">Google Sheets</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <Upload className="h-12 w-12 mx-auto mb-4 text-primary" />
                <h3 className="text-lg font-medium mb-2">Upload de fontes</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Arraste e solte ou{" "}
                  <label htmlFor="file-upload" className="text-primary cursor-pointer hover:underline">
                    escolha arquivo
                  </label>{" "}
                  para upload
                </p>
                <p className="text-xs text-muted-foreground">
                  Tipos de arquivo suportados: PDF, txt, Markdown, Audio (e.g. mp3), CSV, XLSX
                </p>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.txt,.md,.mp3,.wav,.csv,.xlsx,.xls"
                  onChange={handleFileInput}
                  disabled={uploading}
                />
              </div>
            </TabsContent>

            <TabsContent value="bigquery" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="credentials">Credenciais (JSON)</Label>
                  <Input id="credentials" type="file" accept=".json" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project">Projeto</Label>
                  <Input id="project" placeholder="my-project" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset">Dataset</Label>
                  <Input id="dataset" placeholder="analytics" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tables">Tabelas permitidas (separadas por vírgula)</Label>
                  <Input id="tables" placeholder="orders, customers" />
                </div>
                <Button className="w-full">Conectar BigQuery</Button>
              </div>
            </TabsContent>

            <TabsContent value="sheets" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sheets-url">Link do Google Sheets</Label>
                  <div className="flex gap-2">
                    <Input
                      id="sheets-url"
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="flex-1"
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Cole o link de compartilhamento do Google Sheets que você deseja conectar
                </p>
                <Button className="w-full">Conectar Google Sheets</Button>
              </div>
            </TabsContent>
          </Tabs>

          <div className="pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Limite de fontes</span>
              <span className="font-medium">0 / 300</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
