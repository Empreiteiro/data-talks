import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    
    logStep("User authenticated", { userId: user.id, email: user.email });

    const { plan, language } = await req.json();
    if (!plan || !language) throw new Error("Plan and language are required");
    
    logStep("Request data", { plan, language });

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2023-10-16",
    });

    // Check if customer exists
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing customer", { customerId });
    } else {
      logStep("No existing customer found");
    }

    // Define pricing based on plan and language
    const pricing = {
      monthly: {
        pt: { amount: 49900, currency: "brl" }, // R$ 499
        en: { amount: 9900, currency: "usd" }   // $99
      },
      quarterly: {
        pt: { amount: 134700, currency: "brl" }, // R$ 1347 (10% discount)
        en: { amount: 26700, currency: "usd" }   // $267 (10% discount)
      }
    };

    const planConfig = pricing[plan as keyof typeof pricing];
    const priceConfig = planConfig[language as keyof typeof planConfig];
    
    if (!priceConfig) {
      throw new Error("Invalid plan or language");
    }

    logStep("Price configuration", priceConfig);

    const intervalMonths = plan === "quarterly" ? 3 : 1;

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price_data: {
            currency: priceConfig.currency,
            product_data: {
              name: language === "pt" ? "Plano Pro" : "Pro Plan",
              description: language === "pt" 
                ? `Assinatura ${plan === "quarterly" ? "trimestral" : "mensal"} do Plano Pro`
                : `${plan === "quarterly" ? "Quarterly" : "Monthly"} Pro Plan subscription`
            },
            unit_amount: priceConfig.amount,
            recurring: { 
              interval: "month",
              interval_count: intervalMonths
            },
          },
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${req.headers.get("origin")}/account?success=true`,
      cancel_url: `${req.headers.get("origin")}/pricing`,
      metadata: {
        plan: plan,
        language: language,
        user_id: user.id
      }
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-checkout", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});