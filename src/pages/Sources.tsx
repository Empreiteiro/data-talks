import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Database, Upload, Eye, Trash2, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  const [bigQueryFile, setBigQueryFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedSheet, setSelectedSheet] = useState<string | undefined>(undefined);
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
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
      toast.error("Erro ao carregar fontes", {
        description: err.message,
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

      toast.success("Upload completo", {
        description: "Fontes de dados enviadas com sucesso.",
      });
      setShowUploadModal(false);
      await loadSources();
    } catch (err: any) {
      toast.error("Erro ao enviar arquivos", {
        description: err.message,
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
      let credentials = bigQueryCreds;
      
      // If file is provided, read its content
      if (bigQueryFile) {
        credentials = await bigQueryFile.text();
      }
      
      if (!credentials.trim()) {
        throw new Error('Credenciais JSON são obrigatórias');
      }
      
      const tables = bigQueryTables.split(',').map(s => s.trim()).filter(s => !!s);
      const data = await supabaseClient.connectBigQuery(credentials, bigQueryProject, bigQueryDataset, tables);
      toast.success("Conexão completa", {
        description: "BigQuery conectado com sucesso.",
      });
      setShowBigQueryModal(false);
      setBigQueryCreds('');
      setBigQueryProject('');
      setBigQueryDataset('');
      setBigQueryTables('');
      setBigQueryFile(null);
      await loadSources();
    } catch (err: any) {
      toast.error("Erro ao conectar BigQuery", {
        description: err.message,
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
      toast.success("Fonte removida", {
        description: "Fonte de dados removida com sucesso.",
      });
      await loadSources();
    } catch (err: any) {
      toast.error("Erro ao remover fonte", {
        description: err.message,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview(source: Source) {
    setLoadingPreview(true);
    setShowPreviewModal(true);
    try {
      const meta = source.metaJSON || {};
      const columns: string[] = Array.isArray(meta.columns) && meta.columns.length > 0
        ? meta.columns
        : (Array.isArray(meta.preview_rows) && meta.preview_rows[0]
            ? Object.keys(meta.preview_rows[0])
            : []);
      const rows: any[] = Array.isArray(meta.preview_rows) ? meta.preview_rows : [];
      setPreviewData({ columns, rows });
    } catch (err: any) {
      toast.error("Erro ao carregar preview", {
        description: err.message,
      });
      setPreviewData(null);
    } finally {
      setLoadingPreview(false);
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
        toast.error("Erro ao ler planilha", {
          description: "Não foi possível ler as planilhas do arquivo.",
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
        <div className="flex items-center justify-center mb-6">
          <PlanLimitAlert
            type="sources"
            limit={limits.sources}
            planName={planName}
            className="w-full"
          />
        </div>
      )}

      <div className="grid gap-6">
        {sources.map((source) => (
          <Card key={source.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {source.name}
                    <Badge variant="secondary">{source.type}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Criado em {new Date(source.createdAt).toLocaleDateString('pt-BR')}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePreview(source)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Visualizar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(source.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Informações:</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>
                      <span className="ml-2 font-medium">{source.type}</span>
                    </div>
                    {source.metaJSON?.row_count !== undefined && (
                      <div>
                        <span className="text-muted-foreground">Linhas:</span>
                        <span className="ml-2 font-medium">{source.metaJSON.row_count}</span>
                      </div>
                    )}
                    {Array.isArray(source.metaJSON?.columns) && (
                      <div>
                        <span className="text-muted-foreground">Colunas:</span>
                        <span className="ml-2 font-medium">{source.metaJSON.columns.length}</span>
                      </div>
                    )}
                  </div>
                </div>

                {Array.isArray(source.metaJSON?.columns) && source.metaJSON.columns.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Colunas Disponíveis:</h4>
                    <div className="flex flex-wrap gap-1">
                      {source.metaJSON.columns.map((column: string, index: number) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {column}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium mb-2">Integração Langflow:</h4>
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Status:</span>
                      <span className="ml-2 font-medium">{source.langflowPath ? 'Enviado' : 'Pendente'}</span>
                    </div>
                    {source.langflowPath && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Path/ID:</span>
                        <span className="ml-2 font-medium break-all text-xs">{source.langflowPath}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {sources.length === 0 && (
          <Card>
            <CardContent className="text-center py-8">
              <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Nenhuma fonte de dados</h3>
              <p className="text-muted-foreground mb-4">
                Comece fazendo upload de arquivos CSV/Excel ou conectando ao BigQuery.
              </p>
              <div className="flex gap-2 justify-center">
                <Button onClick={() => setShowUploadModal(true)} disabled={!canCreateSource}>
                  <Upload className="mr-2 h-4 w-4" />
                  Fazer Upload
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowBigQueryModal(true)}
                  disabled={!canCreateSource}
                >
                  <Database className="mr-2 h-4 w-4" />
                  Conectar BigQuery
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Modal de Preview */}
      <Dialog open={showPreviewModal} onOpenChange={setShowPreviewModal}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Preview dos Dados</DialogTitle>
            <DialogDescription>
              Visualização das primeiras linhas da fonte de dados
            </DialogDescription>
          </DialogHeader>
          
          {loadingPreview ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : previewData ? (
            <div className="overflow-hidden">
              <ScrollArea className="h-[500px] w-full">
                <div className="overflow-x-auto">
                  <Table className="min-w-full">
                    <TableHeader>
                      <TableRow>
                        {previewData.columns?.map((column: string, index: number) => (
                          <TableHead key={index} className="whitespace-nowrap min-w-[120px] px-4">
                            {column}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.rows?.map((row: any, rowIndex: number) => (
                        <TableRow key={rowIndex}>
                          {previewData.columns.map((col: string, cellIndex: number) => (
                            <TableCell key={cellIndex} className="whitespace-nowrap min-w-[120px] max-w-[200px] px-4 truncate">
                              {(row?.[col] !== undefined && row?.[col] !== null) ? String(row[col]) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Não foi possível carregar o preview dos dados.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de Upload */}
      <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
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
          <Button disabled={uploading || files.length === 0} onClick={handleFileUpload}>
            {uploading ? 'Enviando...' : 'Enviar'}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Modal BigQuery */}
      <Dialog open={showBigQueryModal} onOpenChange={setShowBigQueryModal}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conectar BigQuery</DialogTitle>
            <DialogDescription>
              Configure a conexão com o Google BigQuery seguindo os passos abaixo.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Instruções */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm">Como obter as credenciais do BigQuery:</h4>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Acesse o <a href="https://console.cloud.google.com" target="_blank" className="text-primary hover:underline">Google Cloud Console</a></li>
                <li>Selecione ou crie um projeto</li>
                <li>Ative a API do BigQuery</li>
                <li>Vá para "IAM & Admin" → "Service Accounts"</li>
                <li>Crie uma nova conta de serviço ou use uma existente</li>
                <li>Gere uma chave JSON para a conta de serviço</li>
                <li>Faça o download do arquivo JSON</li>
              </ol>
            </div>

            {/* Upload do arquivo JSON */}
            <div className="space-y-2">
              <Label htmlFor="bigquery-file">Arquivo de Credenciais JSON</Label>
              <Input 
                id="bigquery-file"
                type="file" 
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setBigQueryFile(file || null);
                  if (file) {
                    setBigQueryCreds(''); // Clear manual input if file is selected
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Selecione o arquivo JSON baixado do Google Cloud Console
              </p>
            </div>

            {/* Ou input manual */}
            <div className="space-y-2">
              <Label htmlFor="creds">Ou cole as credenciais JSON manualmente</Label>
              <textarea
                id="creds"
                className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder='{"type": "service_account", "project_id": "...", ...}'
                value={bigQueryCreds}
                onChange={(e) => {
                  setBigQueryCreds(e.target.value);
                  if (e.target.value.trim()) {
                    setBigQueryFile(null); // Clear file if manual input is used
                  }
                }}
                disabled={!!bigQueryFile}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="project">ID do Projeto</Label>
                <Input 
                  id="project" 
                  placeholder="meu-projeto-gcp"
                  value={bigQueryProject} 
                  onChange={e => setBigQueryProject(e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dataset">Dataset</Label>
                <Input 
                  id="dataset" 
                  placeholder="meu_dataset"
                  value={bigQueryDataset} 
                  onChange={e => setBigQueryDataset(e.target.value)} 
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tables">Tabelas (separadas por vírgula)</Label>
              <Input 
                id="tables" 
                placeholder="tabela1, tabela2, tabela3"
                value={bigQueryTables} 
                onChange={e => setBigQueryTables(e.target.value)} 
              />
              <p className="text-xs text-muted-foreground">
                Liste as tabelas que deseja disponibilizar para consulta
              </p>
            </div>
          </div>
          
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowBigQueryModal(false)}>
              Cancelar
            </Button>
            <Button 
              disabled={uploading || (!bigQueryCreds.trim() && !bigQueryFile) || !bigQueryProject.trim()} 
              onClick={handleBigQueryConnect}
            >
              {uploading ? 'Conectando...' : 'Conectar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}