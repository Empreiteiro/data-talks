import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

const Pricing = () => {
  const { t, language } = useLanguage();
  const { session } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isQuarterly, setIsQuarterly] = useState(false);

  const createCheckout = async (plan: string) => {
    if (!session) {
      toast({
        title: language === 'pt' ? 'Login necessário' : 'Login required',
        description: language === 'pt' 
          ? 'Você precisa estar logado para assinar' 
          : 'You need to be logged in to subscribe',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { 
          plan,
          language: language === 'pt' ? 'pt' : 'en'
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;
      
      // Open Stripe checkout in new tab
      window.open(data.url, '_blank');
    } catch (error) {
      console.error('Error creating checkout:', error);
      toast({
        title: language === 'pt' ? 'Erro' : 'Error',
        description: language === 'pt' 
          ? 'Erro ao criar checkout' 
          : 'Error creating checkout',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Calculate the Pro plan details based on quarterly switch
  const proPlan = {
    name: language === 'pt' ? 'Plano Pro' : 'Pro Plan',
    // Monthly price: R$ 499 or $99, Quarterly price with 10% discount: R$ 449 or $89
    price: isQuarterly 
      ? (language === 'pt' ? 'R$ 449' : '$89')
      : (language === 'pt' ? 'R$ 499' : '$99'),
    period: language === 'pt' ? '/mês' : '/month',
    description: isQuarterly 
      ? (language === 'pt' ? 'Faturamento trimestral - 10% de desconto' : 'Quarterly billing - 10% off')
      : (language === 'pt' ? 'Faturamento mensal' : 'Monthly billing'),
    planType: isQuarterly ? 'quarterly' : 'monthly',
    features: language === 'pt' ? [
      'Até 5 fontes de dados',
      'Configuração avançada do agente',
      'Até 1.000 perguntas/mês',
      'Suporte prioritário',
      'Canais personalizados',
      'Configuração de alertas',
      ...(isQuarterly ? ['10% de economia'] : [])
    ] : [
      'Up to 5 data sources',
      'Advanced agent configuration',
      'Up to 1,000 questions/month',
      'Priority support',
      'Integration with channels',
      'Alert configuration',
      ...(isQuarterly ? ['10% savings'] : [])
    ]
  };

  const enterprisePlan = {
    name: t('pricing.enterprise.title'),
    price: t('pricing.enterprise.price'),
    period: '',
    description: t('pricing.enterprise.description'),
    features: language === 'pt' ? [
      'Fontes de dados ilimitadas',
      'Modelos de IA personalizados',
      'Suporte dedicado',
      'Implantação on-premise',
      'Integrações personalizadas'
    ] : [
      'Unlimited data sources',
      'Custom AI models',
      'Dedicated support',
      'SLA guarantees',
      'On-premise deployment',
      'Custom integrations'
    ],
    button: t('pricing.enterprise.button')
  };

  return (
    <div>
      <SEO 
        title={`${t('pricing.title')} | ${t('nav.tagline')}`}
        description={t('pricing.subtitle')}
      />
      
      <main className="container py-16">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            {t('pricing.title')}
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {t('pricing.subtitle')}
          </p>
        </div>

        {/* Switch for Monthly/Quarterly */}
        <div className="flex items-center justify-center space-x-3 mb-12">
          <Label htmlFor="billing-toggle" className={`text-sm font-medium ${!isQuarterly ? 'text-primary' : 'text-muted-foreground'}`}>
            {language === 'pt' ? 'Mensal' : 'Monthly'}
          </Label>
          <Switch
            id="billing-toggle"
            checked={isQuarterly}
            onCheckedChange={setIsQuarterly}
          />
          <Label htmlFor="billing-toggle" className={`text-sm font-medium ${isQuarterly ? 'text-primary' : 'text-muted-foreground'}`}>
            {language === 'pt' ? 'Trimestral' : 'Quarterly'}
          </Label>
          {isQuarterly && (
            <Badge variant="secondary" className="ml-2">
              {language === 'pt' ? '10% desconto' : '10% off'}
            </Badge>
          )}
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Pro Plan */}
          <Card className={`relative flex flex-col h-[560px] ${isQuarterly ? 'border-primary' : ''}`}>
            <CardHeader className="text-center pb-8">
              <CardTitle className="text-2xl mb-2">{proPlan.name}</CardTitle>
              <CardDescription className="text-base">{proPlan.description}</CardDescription>
              <div className="mt-4">
                <span className="text-4xl font-bold">{proPlan.price}</span>
                <span className="text-muted-foreground">{proPlan.period}</span>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 flex-1">
              {proPlan.features.map((feature, featureIndex) => (
                <div key={featureIndex} className="flex items-center gap-3">
                  <Check className="h-5 w-5 text-primary flex-shrink-0" />
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </CardContent>

            <CardFooter className="mt-auto">
              <Button 
                className="w-full" 
                variant={isQuarterly ? "default" : "outline"}
                size="lg"
                onClick={() => createCheckout(proPlan.planType)}
                disabled={loading}
              >
                {language === 'pt' ? 'Assinar Agora' : 'Subscribe Now'}
              </Button>
            </CardFooter>
          </Card>

          {/* Enterprise Plan */}
          <Card className="relative flex flex-col h-[560px]">
            <CardHeader className="text-center pb-8">
              <CardTitle className="text-2xl mb-2">{enterprisePlan.name}</CardTitle>
              <CardDescription className="text-base">{enterprisePlan.description}</CardDescription>
              <div className="mt-4">
                <span className="text-4xl font-bold">{enterprisePlan.price}</span>
                <span className="text-muted-foreground">{enterprisePlan.period}</span>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 flex-1">
              {enterprisePlan.features.map((feature, featureIndex) => (
                <div key={featureIndex} className="flex items-center gap-3">
                  <Check className="h-5 w-5 text-primary flex-shrink-0" />
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </CardContent>

            <CardFooter className="mt-auto">
              <Button 
                className="w-full" 
                variant="outline"
                size="lg"
                onClick={() => window.open('https://whatsa.me/5534996521315', '_blank')}
              >
                {enterprisePlan.button}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Pricing;