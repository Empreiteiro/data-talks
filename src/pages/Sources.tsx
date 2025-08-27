import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Database, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { agentClient, Source } from "@/services/agentClient";
import { supabaseClient } from "@/services/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { PlanLimitAlert } from "@/components/PlanLimitAlert";

export default function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [showBigQueryModal, setShowBigQueryModal] = useState(false);
  const [bigQueryCreds, setBigQueryCreds] = useState('');
  const [bigQueryProject, setBigQueryProject] = useState('');
  const [bigQueryDataset, setBigQueryDataset] = useState('');
  const [bigQueryTables, setBigQueryTables] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedSheet, setSelectedSheet] = useState<string | undefined>(undefined);
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { limits, usage, planName, canCreateSource, isLoading: limitsLoading } = usePlanLimits();

  useEffect(() => {
    loadSources();
  }, []);

  async function loadSources() {
    setLoading(true);
    try {
      const data = await supabaseClient.listSources();
      setSources(data);
    } catch (err: any) {
      toast({
        title: "Erro ao carregar fontes",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload() {
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress(0);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let uploadedFile;

        if (selectedSheet && selectedFile === file) {
          uploadedFile = await supabaseClient.uploadFile(file, selectedSheet);
        } else {
          uploadedFile = await supabaseClient.uploadFile(file);
        }

        setUploadProgress((i + 1) / files.length * 100);
      }

      toast({
        title: "Upload completo",
        description: "Fontes de dados enviadas com sucesso.",
      });
      setShowUploadModal(false);
      await loadSources();
    } catch (err: any) {
      toast({
        title: "Erro ao enviar arquivos",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setFiles([]);
    }
  }

  async function handleBigQueryConnect() {
    setUploading(true);
    try {
      const tables = bigQueryTables.split(',').map(s => s.trim()).filter(s => !!s);
      const data = await supabaseClient.connectBigQuery(bigQueryCreds, bigQueryProject, bigQueryDataset, tables);
      toast({
        title: "Conexão completa",
        description: "BigQuery conectado com sucesso.",
      });
      setShowBigQueryModal(false);
      await loadSources();
    } catch (err: any) {
      toast({
        title: "Erro ao conectar BigQuery",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover esta fonte de dados?')) return;
    setLoading(true);
    try {
      await supabaseClient.deleteSource(id);
      toast({
        title: "Fonte removida",
        description: "Fonte de dados removida com sucesso.",
      });
      await loadSources();
    } catch (err: any) {
      toast({
        title: "Erro ao remover fonte",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles(selectedFiles);

    if (selectedFiles.length === 1) {
      const file = selectedFiles[0];
      setSelectedFile(file);

      try {
        const sheets = await supabaseClient.getExcelSheets(file);
        setAvailableSheets(sheets);
        setSelectedSheet(sheets[0]);
      } catch (error) {
        console.error("Error fetching sheet names:", error);
        toast({
          title: "Erro ao ler planilha",
          description: "Não foi possível ler as planilhas do arquivo.",
          variant: "destructive",
        });
      }
    } else {
      setAvailableSheets([]);
      setSelectedSheet(undefined);
    }
  };

  if (loading || limitsLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Carregando fontes...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Fontes de Dados</h1>
          <p className="text-muted-foreground">
            Gerencie suas fontes de dados ({usage.sources}/{limits.sources} - Plano {planName})
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setShowBigQueryModal(true)}
            variant="outline"
            disabled={!canCreateSource}
          >
            <Database className="mr-2 h-4 w-4" />
            Conectar BigQuery
          </Button>
          <Button 
            onClick={() => setShowUploadModal(true)}
            disabled={!canCreateSource}
          >
            <Upload className="mr-2 h-4 w-4" />
            Fazer Upload
          </Button>
        </div>
      </div>

      {!canCreateSource && (
        <PlanLimitAlert
          type="sources"
          limit={limits.sources}
          planName={planName}
          className="mb-6"
        />
      )}

      <Table>
        <TableCaption>Suas fontes de dados atuais.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Criado em</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => (
            <TableRow key={source.id}>
              <TableCell className="font-medium">{source.name}</TableCell>
              <TableCell>{source.type}</TableCell>
              <TableCell>{new Date(source.created_at).toLocaleDateString()}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => handleDelete(source.id)}>Remover</Button>
              </TableCell>
            </TableRow>
          ))}
          {sources.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center">Nenhuma fonte de dados encontrada.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
        <DialogTrigger asChild>
          <Button>Abrir Modal</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Enviar Arquivo</DialogTitle>
            <DialogDescription>
              Selecione um arquivo CSV ou Excel para enviar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Arquivo
              </Label>
              <Input type="file" id="name" className="col-span-3" multiple onChange={handleFileChange} />
            </div>

            {availableSheets.length > 0 && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="sheet" className="text-right">
                  Planilha
                </Label>
                <Select onValueChange={setSelectedSheet} defaultValue={availableSheets[0]}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Selecione uma planilha" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSheets.map((sheet) => (
                      <SelectItem key={sheet} value={sheet}>{sheet}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {uploadProgress > 0 && (
            <progress value={uploadProgress} max="100"></progress>
          )}
          <Button disabled={uploading || files.length === 0} onClick={handleFileUpload}>{uploading ? 'Enviando...' : 'Enviar'}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={showBigQueryModal} onOpenChange={setShowBigQueryModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Conectar BigQuery</DialogTitle>
            <DialogDescription>
              Insira suas credenciais do BigQuery.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="creds" className="text-right">
                Credenciais (JSON)
              </Label>
              <Input id="creds" className="col-span-3" type="textarea" value={bigQueryCreds} onChange={e => setBigQueryCreds(e.target.value)} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="project" className="text-right">
                Projeto
              </Label>
              <Input id="project" className="col-span-3" value={bigQueryProject} onChange={e => setBigQueryProject(e.target.value)} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="dataset" className="text-right">
                Dataset
              </Label>
              <Input id="dataset" className="col-span-3" value={bigQueryDataset} onChange={e => setBigQueryDataset(e.target.value)} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="tables" className="text-right">
                Tabelas (separadas por vírgula)
              </Label>
              <Input id="tables" className="col-span-3" value={bigQueryTables} onChange={e => setBigQueryTables(e.target.value)} />
            </div>
          </div>
          <Button disabled={uploading} onClick={handleBigQueryConnect}>{uploading ? 'Conectando...' : 'Conectar'}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
