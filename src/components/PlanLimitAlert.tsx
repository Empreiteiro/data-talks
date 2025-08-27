
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Crown } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PlanLimitAlertProps {
  type: 'sources' | 'agents' | 'questions';
  limit: number;
  planName: string;
  className?: string;
}

export const PlanLimitAlert = ({ type, limit, planName, className }: PlanLimitAlertProps) => {
  const navigate = useNavigate();

  const getTypeLabel = () => {
    switch (type) {
      case 'sources':
        return 'fontes de dados';
      case 'agents':
        return 'agentes';
      case 'questions':
        return 'perguntas mensais';
      default:
        return '';
    }
  };

  const getMessage = () => {
    const typeLabel = getTypeLabel();
    return `Você atingiu o limite de ${limit} ${typeLabel} do plano ${planName}.`;
  };

  return (
    <Alert className={className}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex items-center justify-between w-full min-w-0">
          <span className="text-sm">{getMessage()}</span>
          {planName === 'Trial' && (
            <Button
              onClick={() => navigate('/pricing')}
              size="sm"
              className="ml-3 flex-shrink-0"
            >
              <Crown className="mr-1 h-3 w-3" />
              Upgrade para Pro
            </Button>
          )}
        </div>
      </div>
    </Alert>
  );
};
