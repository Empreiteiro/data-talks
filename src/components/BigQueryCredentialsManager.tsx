import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Trash2, Upload, Key } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Credential {
  id: string;
  name: string;
  langflowPath: string;
  langflowName: string;
  createdAt: string;
  projectId?: string;
}

interface BigQueryCredentialsManagerProps {
  onSourceAdded?: () => void;
}

export const BigQueryCredentialsManager = ({ onSourceAdded }: BigQueryCredentialsManagerProps = {}) => {
  const { t } = useLanguage();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [credentialName, setCredentialName] = useState("");
  const [credentialsFile, setCredentialsFile] = useState<File | null>(null);

  const fetchCredentials = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('sources')
        .select('id, name, langflow_path, langflow_name, created_at, metadata')
        .eq('user_id', user.id)
        .eq('type', 'bigquery')
        .not('langflow_path', 'is', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedCredentials: Credential[] = (data || []).map(item => {
        const metadata = item.metadata as Record<string, any> | null;
        return {
          id: item.id,
          name: item.name,
          langflowPath: item.langflow_path || '',
          langflowName: item.langflow_name || '',
          createdAt: item.created_at,
          projectId: metadata?.project || metadata?.project_id
        };
      });

      setCredentials(formattedCredentials);
    } catch (error) {
      console.error('Error fetching credentials:', error);
      toast.error(t('bigquery.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/json') {
      setCredentialsFile(file);
    } else {
      toast.error(t('bigquery.errors.invalidFile'));
    }
  };

  const handleUpload = async () => {
    if (!credentialsFile || !credentialName.trim()) {
      toast.error(t('bigquery.errors.missingFields'));
      return;
    }

    setUploading(true);
    try {
      const credentialsJson = await credentialsFile.text();
      let parsedCredentials;
      try {
        parsedCredentials = JSON.parse(credentialsJson);
      } catch {
        toast.error(t('bigquery.errors.invalidJson'));
        return;
      }

      // Upload to Langflow
      const formData = new FormData();
      formData.append('file', credentialsFile);

      const { data: langflowData, error: langflowError } = await supabase.functions.invoke(
        'upload-to-langflow',
        { body: formData }
      );

      if (langflowError) throw langflowError;
      if (!langflowData?.path) throw new Error('Falha ao fazer upload para Langflow');

      // Save to Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { error: dbError } = await supabase
        .from('sources')
        .insert({
          user_id: user.id,
          name: credentialName,
          type: 'bigquery',
          langflow_path: langflowData.path,
          langflow_name: langflowData.name,
          metadata: {
            project: parsedCredentials.project_id,
            project_id: parsedCredentials.project_id,
            credentials_content: langflowData.credentialsContent,
            supabase_storage_path: langflowData.supabaseStoragePath
          }
        });

      if (dbError) throw dbError;

      toast.success(t('bigquery.success.added'));
      setCredentialName('');
      setCredentialsFile(null);
      await fetchCredentials();
      onSourceAdded?.();
    } catch (error: any) {
      console.error('Error uploading credential:', error);
      toast.error(t('bigquery.errors.uploadFailed'), {
        description: error.message
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('sources')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success(t('bigquery.success.deleted'));
      fetchCredentials();
    } catch (error: any) {
      console.error('Error deleting credential:', error);
      toast.error(t('bigquery.errors.deleteFailed'), {
        description: error.message
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('bigquery.addCredential.title')}
          </CardTitle>
          <CardDescription>
            {t('bigquery.addCredential.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="credential-name">{t('bigquery.addCredential.nameLabel')}</Label>
            <Input
              id="credential-name"
              placeholder={t('bigquery.addCredential.namePlaceholder')}
              value={credentialName}
              onChange={(e) => setCredentialName(e.target.value)}
              disabled={uploading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="credential-file">{t('bigquery.addCredential.fileLabel')}</Label>
            <Input
              id="credential-file"
              type="file"
              accept=".json"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {credentialsFile && (
              <p className="text-sm text-muted-foreground">
                {t('bigquery.addCredential.fileSelected')} {credentialsFile.name}
              </p>
            )}
          </div>
          <Button
            onClick={handleUpload}
            disabled={uploading || !credentialsFile || !credentialName.trim()}
            className="w-full"
          >
            {uploading ? t('bigquery.addCredential.uploading') : t('bigquery.addCredential.uploadButton')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t('bigquery.configured.title')}
          </CardTitle>
          <CardDescription>
            {t('bigquery.configured.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('bigquery.configured.loading')}</p>
          ) : credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('bigquery.configured.empty')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('bigquery.configured.name')}</TableHead>
                  <TableHead>{t('bigquery.configured.projectId')}</TableHead>
                  <TableHead>{t('bigquery.configured.langflowPath')}</TableHead>
                  <TableHead>{t('bigquery.configured.createdAt')}</TableHead>
                  <TableHead className="text-right">{t('bigquery.configured.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((cred) => (
                  <TableRow key={cred.id}>
                    <TableCell className="font-medium">{cred.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {cred.projectId || 'N/A'}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">
                      {cred.langflowPath || 'N/A'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(cred.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('bigquery.delete.title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('bigquery.delete.description', { name: cred.name })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('bigquery.delete.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(cred.id)}
                              className="bg-destructive text-destructive-foreground"
                            >
                              {t('bigquery.delete.confirm')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
