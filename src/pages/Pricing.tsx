import { SEO } from "@/components/SEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { Check } from "lucide-react";

const Pricing = () => {
  const { t, language } = useLanguage();

  const plans = [
    {
      name: t('pricing.free.title'),
      price: t('pricing.free.price'),
      period: t('pricing.free.period'),
      description: t('pricing.free.description'),
      badge: null as string | null,
      features: language === 'pt' ? [
        'Uma fonte de dados',
        'Configuração básica do agente',
        '10 perguntas por mês'
      ] : [
        'Single data source',
        'Basic agent configuration',
        '10 questions per month'
      ],
      button: t('pricing.free.button')
    },
    {
      name: t('pricing.pro.title'),
      price: t('pricing.pro.price'),
      period: t('pricing.pro.period'),
      description: t('pricing.pro.description'),
      badge: t('pricing.mostPopular'),
      features: language === 'pt' ? [
        'Até 5 fontes de dados',
        'Configuração avançada do agente',
        'Até 1.000 perguntas',
        'Suporte prioritário',
        'Canais personalizados'
      ] : [
        'Up to 5 data sources',
        'Advanced agent configuration',
        'Up to 1,000 questions',
        'Priority support',
        'Integration with channels'
      ],
      button: t('pricing.pro.button')
    },
    {
      name: t('pricing.enterprise.title'),
      price: t('pricing.enterprise.price'),
      period: t('pricing.enterprise.period'),
      description: t('pricing.enterprise.description'),
      badge: null as string | null,
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
    }
  ];

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

        <div className="grid md:grid-cols-3 gap-8 max-w-[78rem] mx-auto">
          {plans.map((plan, index) => (
                         <Card key={index} className={`relative flex flex-col h-[560px] ${index === 1 ? 'border-primary shadow-lg scale-105' : ''}`}>
               {plan.badge && (
                 <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-primary text-primary-foreground">
                   {plan.badge}
                 </Badge>
               )}
               
               <CardHeader className="text-center pb-8">
                 <CardTitle className="text-2xl mb-2">{plan.name}</CardTitle>
                 <CardDescription className="text-base">{plan.description}</CardDescription>
                 <div className="mt-4">
                   <span className="text-4xl font-bold">{plan.price}</span>
                   <span className="text-muted-foreground">{plan.period}</span>
                 </div>
               </CardHeader>

               <CardContent className="space-y-4 flex-1">
                 {plan.features.map((feature, featureIndex) => (
                   <div key={featureIndex} className="flex items-center gap-3">
                     <Check className="h-5 w-5 text-primary flex-shrink-0" />
                     <span className="text-sm">{feature}</span>
                   </div>
                 ))}
               </CardContent>

               <CardFooter className="mt-auto">
                 <Button 
                   className="w-full" 
                   variant={index === 1 ? "default" : "outline"}
                   size="lg"
                 >
                   {plan.button}
                 </Button>
               </CardFooter>
             </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Pricing;