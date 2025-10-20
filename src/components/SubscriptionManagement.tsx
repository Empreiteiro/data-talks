import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { CreditCard, Calendar, AlertCircle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
const SubscriptionManagement = () => {
  const {
    language
  } = useLanguage();
  const {
    session
  } = useAuth();
  const {
    toast
  } = useToast();
  const {
    subscription,
    loading,
    checkSubscription
  } = useSubscription();
  const [actionLoading, setActionLoading] = useState(false);
  const createCheckout = async (plan: string) => {
    try {
      setActionLoading(true);
      const {
        data,
        error
      } = await supabase.functions.invoke('create-checkout', {
        body: {
          plan,
          language: language === 'pt' ? 'pt' : 'en'
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`
        }
      });
      if (error) throw error;

      // Marca que o usuário está indo para o Stripe
      sessionStorage.setItem('returning_from_stripe', 'true');
      // Open Stripe checkout in new tab
      window.open(data.url, '_blank');
    } catch (error) {
      console.error('Error creating checkout:', error);
      toast({
        title: language === 'pt' ? 'Erro' : 'Error',
        description: language === 'pt' ? 'Erro ao criar checkout' : 'Error creating checkout',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };
  const openCustomerPortal = async () => {
    try {
      setActionLoading(true);
      const {
        data,
        error
      } = await supabase.functions.invoke('customer-portal', {
        headers: {
          Authorization: `Bearer ${session?.access_token}`
        }
      });
      if (error) throw error;

      // Marca que o usuário está indo para o Stripe
      sessionStorage.setItem('returning_from_stripe', 'true');
      // Open customer portal in new tab
      window.open(data.url, '_blank');
    } catch (error) {
      console.error('Error opening customer portal:', error);
      toast({
        title: language === 'pt' ? 'Erro' : 'Error',
        description: language === 'pt' ? 'Erro ao abrir portal do cliente' : 'Error opening customer portal',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language === 'pt' ? 'pt-BR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };
  const getPlanPricing = () => {
    if (language === 'pt') {
      return {
        monthly: 'R$ 499/mês',
        period: '(cobrado mensalmente)'
      };
    } else {
      return {
        monthly: '$99/month',
        period: '(billed monthly)'
      };
    }
  };
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  const pricing = getPlanPricing();
  return <div className="h-full px-6 pb-6 space-y-6 overflow-y-auto">

      {subscription?.subscribed ? <Card>
          <CardHeader className="flex flex-row items-center space-y-0 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <CardTitle className="text-lg">
                {language === 'pt' ? 'Assinatura Ativa' : 'Active Subscription'}
              </CardTitle>
            </div>
            <Badge variant="default" className="ml-auto">
              {subscription.subscription_tier} - {subscription.plan_type === 'quarterly' ? language === 'pt' ? 'Trimestral' : 'Quarterly' : language === 'pt' ? 'Mensal' : 'Monthly'}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                {language === 'pt' ? 'Próxima cobrança: ' : 'Next billing: '}
                {subscription.subscription_end && formatDate(subscription.subscription_end)}
              </span>
            </div>
            
            <div className="flex gap-2">
              <Button onClick={openCustomerPortal} disabled={actionLoading}>
                <CreditCard className="h-4 w-4 mr-2" />
                {language === 'pt' ? 'Gerenciar Assinatura' : 'Manage Subscription'}
              </Button>
            </div>
          </CardContent>
        </Card> : <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center space-y-0 pb-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-600" />
                <CardTitle className="text-lg">
                  {language === 'pt' ? 'Nenhuma Assinatura Ativa' : 'No Active Subscription'}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                {language === 'pt' ? 'Você não possui uma assinatura ativa. Assine o Plano Pro para acessar todas as funcionalidades.' : 'You don\'t have an active subscription. Subscribe to the Pro Plan to access all features.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                {language === 'pt' ? 'Plano Pro' : 'Pro Plan'}
                <div className="text-right">
                  <Badge variant="outline" className="text-lg px-3 py-1">
                    {pricing.monthly}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pricing.period}
                  </p>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                <li>• {language === 'pt' ? 'Até 5 fontes de dados' : 'Up to 5 data sources'}</li>
                <li>• {language === 'pt' ? 'Até 1.000 perguntas/mês' : 'Up to 1,000 questions/month'}</li>
                <li>• {language === 'pt' ? 'Suporte prioritário' : 'Priority support'}</li>
                <li>• {language === 'pt' ? 'Canais personalizados' : 'Custom channels'}</li>
              </ul>
              <Button className="w-full" onClick={() => createCheckout('monthly')} disabled={actionLoading}>
                {language === 'pt' ? 'Assinar Plano Pro' : 'Subscribe Pro Plan'}
              </Button>
            </CardContent>
          </Card>
        </div>}
    </div>;
};
export default SubscriptionManagement;