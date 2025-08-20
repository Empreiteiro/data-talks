import { SEO } from "@/components/SEO";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

const Pricing = () => {
  const { t } = useLanguage();

  const plans = [
    {
      name: "Plano Básico",
      price: "R$ 29",
      period: "/mês",
      description: "Ideal para pequenas empresas",
      badge: null,
      features: [
        "Até 1.000 consultas por mês",
        "1 fonte de dados",
        "Suporte por email",
        "Dashboard básico",
        "Relatórios simples"
      ]
    },
    {
      name: "Plano Profissional",
      price: "R$ 99",
      period: "/mês",
      description: "Para empresas em crescimento",
      badge: "Mais Popular",
      features: [
        "Até 10.000 consultas por mês",
        "5 fontes de dados",
        "Suporte prioritário",
        "Dashboard avançado",
        "Relatórios detalhados",
        "API de integração",
        "Alertas personalizados"
      ]
    },
    {
      name: "Plano Enterprise",
      price: "R$ 299",
      period: "/mês",
      description: "Para grandes organizações",
      badge: null,
      features: [
        "Consultas ilimitadas",
        "Fontes de dados ilimitadas",
        "Suporte dedicado 24/7",
        "Dashboard customizável",
        "Relatórios avançados",
        "API completa",
        "Alertas em tempo real",
        "SSO e segurança avançada",
        "Treinamento personalizado"
      ]
    }
  ];

  return (
    <div className="min-h-screen">
      <SEO 
        title="Planos e Preços"
        description="Escolha o plano ideal para sua empresa. Oferecemos soluções flexíveis para empresas de todos os tamanhos."
      />
      
      <main className="container py-16">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            Planos e Preços
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Escolha o plano ideal para sua empresa. Comece gratuitamente e escale conforme sua necessidade.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <Card key={index} className={`relative ${index === 1 ? 'border-primary shadow-lg scale-105' : ''}`}>
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

              <CardContent className="space-y-4">
                {plan.features.map((feature, featureIndex) => (
                  <div key={featureIndex} className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-primary flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </CardContent>

              <CardFooter>
                <Button 
                  className="w-full" 
                  variant={index === 1 ? "default" : "outline"}
                  size="lg"
                >
                  Começar Agora
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        <div className="text-center mt-16">
          <p className="text-muted-foreground mb-4">
            Precisa de algo personalizado?
          </p>
          <Button variant="link" className="text-primary">
            Entre em contato conosco
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Pricing;