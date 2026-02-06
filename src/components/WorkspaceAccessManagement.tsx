import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { Share2 } from "lucide-react";

/**
 * Open-source version: workspace sharing is not implemented.
 */
const WorkspaceAccessManagement = () => {
  const { language } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="h-5 w-5" />
          {language === 'pt' ? 'Acesso aos workspaces' : 'Workspace access'}
        </CardTitle>
        <CardDescription>
          {language === 'pt'
            ? 'O compartilhamento de workspaces não está disponível nesta versão open-source.'
            : 'Workspace sharing is not available in this open-source version.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {language === 'pt'
            ? 'Os workspaces são locais à sua instalação. Para compartilhar dados, use exportação ou integrações no servidor.'
            : 'Workspaces are local to your installation. To share data, use export or server-side integrations.'}
        </p>
      </CardContent>
    </Card>
  );
};

export default WorkspaceAccessManagement;
