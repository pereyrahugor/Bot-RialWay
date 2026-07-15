// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0"

serve(async (req) => {
  const url = new URL(req.url)
  const method = req.method

  // 1. Manejar OAuth Redirect (GET con params code y state)
  if (method === "GET") {
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state") // Contiene el projectId

    if (code && state) {
      console.log(`[MP Unified] Procesando redirección OAuth para projectId: ${state}`)
      
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      const supabase = createClient(supabaseUrl, supabaseServiceKey)

      try {
        const { data: routeData } = await supabase
          .from("mercadopago_user_routoing")
          .select("project_url")
          .eq("project_id", state)
          .limit(1)

        let redirectTarget = ""
        if (routeData && routeData.length > 0 && routeData[0].project_url) {
          redirectTarget = routeData[0].project_url
        } else {
          const { data: settingsData } = await supabase
            .from("settings")
            .select("value")
            .eq("project_id", state)
            .eq("key", "RAILWAY_PUBLIC_DOMAIN")
            .maybeSingle()

          if (settingsData?.value) {
            redirectTarget = settingsData.value.startsWith("http") 
              ? settingsData.value 
              : `https://${settingsData.value}`
          }
        }

        if (!redirectTarget) {
          return new Response(`Could not resolve redirect URL for project: ${state}`, { status: 404 })
        }

        const targetUrl = `${redirectTarget}/api/backoffice/mercadopago/callback?code=${code}&state=${state}`
        return Response.redirect(targetUrl, 302)

      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        })
      }
    }

    // Validación básica de webhook (Mercado Pago realiza un GET al configurar la URL)
    return new Response("OK", { status: 200 })
  }

  // 2. Manejar Webhook POST (Petición de Mercado Pago con evento de pago)
  if (method === "POST") {
    try {
      const payload = await req.json()
      const urlParams = url.searchParams
      
      const userId = payload?.user_id || urlParams.get("user_id")
      const paymentId = payload?.data?.id || payload?.id || urlParams.get("id")

      console.log(`[MP Unified] Webhook recibido para user_id: ${userId}, payment_id: ${paymentId}`)

      if (!userId) {
        return new Response("Missing user_id parameter", { status: 400 })
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      const supabase = createClient(supabaseUrl, supabaseServiceKey)

      const { data: routeData, error } = await supabase
        .from("mercadopago_user_routoing")
        .select("project_url, project_id")
        .eq("user_id", String(userId))
        .limit(1)

      if (error) {
        console.error("[MP Unified] Error consultando ruteo:", error)
        return new Response(JSON.stringify({ error: error.message }), { status: 500 })
      }

      if (!routeData || routeData.length === 0 || !routeData[0].project_url) {
        console.warn(`[MP Unified] Ruteo no encontrado para user_id: ${userId}`)
        return new Response(`Route not found for user_id: ${userId}`, { status: 404 })
      }

      const { project_url, project_id } = routeData[0]
      const targetWebhookUrl = `${project_url}/api/clientes/mercadopago/webhook`

      console.log(`[MP Unified] Reenviando webhook a: ${targetWebhookUrl} (Proyecto: ${project_id})`)

      const forwardResponse = await fetch(targetWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })

      const responseText = await forwardResponse.text()
      console.log(`[MP Unified] Servidor destino respondió: ${forwardResponse.status} - ${responseText}`)

      return new Response("Webhook proxied successfully", { status: 200 })

    } catch (err: any) {
      console.error("[MP Unified] Error procesando webhook:", err)
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    }
  }

  return new Response("Method Not Allowed", { status: 405 })
})
