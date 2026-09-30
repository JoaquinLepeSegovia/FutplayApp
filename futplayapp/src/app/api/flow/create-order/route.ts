import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createFlowOrder } from "@/lib/flow";
import { membresiaActiva } from "@/lib/fechas";
import { rateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/base-url";
import { traducirError } from "@/lib/errores";

export async function POST(request: Request) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() { },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { allowed, remaining } = rateLimit(`create-order:${user.id}`, 5, 60000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." },
      { status: 429 }
    );
  }

  const { data: usuario } = await supabase
    .from("usuario")
    .select("id, email")
    .eq("id", user.id)
    .single();

  if (!usuario) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const body = await request.json();
  const { planId, recurrencia: conRecurrencia, acceso: tokenAcceso } = body;

  if (!planId) {
    return NextResponse.json({ error: "planId es requerido" }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Falta SUPABASE_SERVICE_ROLE_KEY en .env.local" },
      { status: 500 }
    );
  }

  const adminClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    {
      cookies: {
        getAll() { return []; },
        setAll() { },
      },
    }
  );

  const { data: plan, error: planError } = await adminClient
    .from("plan")
    .select("*")
    .eq("id", planId)
    .single();

  if (planError || !plan) {
    return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  }

  // Los planes familiares solo se pueden comprar con el link del admin:
  // exigir el codigo_acceso correcto (verificación server-side).
  if (plan.tipo_plan === "familiar") {
    if (!tokenAcceso || tokenAcceso !== plan.codigo_acceso) {
      return NextResponse.json(
        { error: "Este plan solo puede comprarse con un link de acceso válido." },
        { status: 403 }
      );
    }
  }

  // Filtro en la base (no en JS) para no dejar pasar duplicados: un admin puede
  // crear membresías manualmente desde el panel de gestión sin cerrar la anterior.
  const { data: existingMembresia, error: membresiaError } = await adminClient
    .from("membresia")
    .select("id, fecha_inicio, fecha_vencimiento, estado, congelada, sin_tokens")
    .eq("usuario_id", user.id)
    .eq("estado", true)
    .eq("congelada", false)
    .eq("sin_tokens", false)
    .order("fecha_inicio", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Falla cerrado: si la consulta falla (por ejemplo, porque la migración
  // sin_tokens todavía no se aplicó) NO se permite comprar, porque responder
  // "no tenés membresía" sería un bypass silencioso del control.
  if (membresiaError) {
    return NextResponse.json(
      { error: "No pudimos verificar tu plan actual. Intenta de nuevo en un momento." },
      { status: 500 }
    );
  }

  if (existingMembresia) {
    const m = existingMembresia as {
      fecha_inicio: string;
      fecha_vencimiento: string;
    };

    // Solo bloquea la compra si la membresía vigente es realmente USABLE.
    // Una membresía sin tokens (sin_tokens=true, cerrada por el trigger al
    // agotar el saldo) deja de bloquear la compra: ese es el objetivo de la
    // regla. Los días que quedaban se pierden.
    const vigente = membresiaActiva(m.fecha_vencimiento) && m.fecha_inicio <= new Date().toISOString();

    if (vigente) {
      return NextResponse.json(
        { error: "Ya tienes un plan activo. No puedes comprar otro hasta que termine el período actual." },
        { status: 409 }
      );
    }
  }

  let recurrenciaId: string | null = null;
  if (conRecurrencia) {
    const { data: rec, error: recError } = await adminClient
      .from("recurrencia")
      .insert({ usuario_id: usuario.id, plan_id: plan.id })
      .select("id")
      .single();

    if (recError || !rec) {
      return NextResponse.json(
        { error: `Error al crear recurrencia: ${recError?.message}` },
        { status: 500 }
      );
    }
    recurrenciaId = rec.id;
  }

  const { data: boleta, error: boletaError } = await adminClient
    .from("boleta")
    .insert({
      usuario_id: usuario.id,
      estado: "pendiente",
      total: plan.precio,
      recurrencia_id: recurrenciaId,
      flow_confirmada: false,
    })
    .select()
    .single();

  if (boletaError || !boleta) {
    if (recurrenciaId) {
      await adminClient.from("recurrencia").delete().eq("id", recurrenciaId);
    }
    return NextResponse.json(
      { error: `Error al crear boleta: ${boletaError?.message}` },
      { status: 500 }
    );
  }

  const { error: itemError } = await adminClient
    .from("boleta_item")
    .insert({
      boleta_id: boleta.id,
      plan_id: plan.id,
      cantidad: 1,
      precio: plan.precio,
      total: plan.precio,
    });

  if (itemError) {
    await adminClient.from("boleta").delete().eq("id", boleta.id);
    if (recurrenciaId) {
      await adminClient.from("recurrencia").delete().eq("id", recurrenciaId);
    }
    return NextResponse.json(
      { error: `Error al crear item: ${itemError.message}` },
      { status: 500 }
    );
  }

  // Base canónica para callbacks de Flow (webhook + retorno):
  // futplay.cl si NEXT_PUBLIC_BASE_URL está bien configurada,
  // o el dominio real por el que el usuario está navegando.
  const publicUrl = getBaseUrl(request);

  try {
    const flowOrder = await createFlowOrder({
      commerceOrder: boleta.id,
      subject: `FutPlay - ${plan.nombre}`,
      amount: plan.precio,
      email: usuario.email,
      urlConfirmation: `${publicUrl}/api/flow/webhook?boletaId=${boleta.id}`,
      urlReturn: `${publicUrl}/api/flow/return`,
      timeout: 1800,
      paymentMethod: 1, // solo tarjetas crédito + débito
      ...(conRecurrencia ? { recurrence: { period: plan.dias_vigencia ?? 30 } } : {}),
    });

    await adminClient
      .from("boleta")
      .update({ transaccion_id: String(flowOrder.flowOrder), flow_confirmada: true })
      .eq("id", boleta.id);

    return NextResponse.json({
      url: `${flowOrder.url}?token=${flowOrder.token}`,
      flowOrder: flowOrder.flowOrder,
      boletaId: boleta.id,
    });
  } catch (error) {
    await adminClient.from("boleta_item").delete().eq("boleta_id", boleta.id);
    await adminClient.from("boleta").delete().eq("id", boleta.id);
    if (recurrenciaId) {
      await adminClient.from("recurrencia").delete().eq("id", recurrenciaId);
    }

    // Log de diagnóstico para Vercel: captura el endpoint y config de Flow.
    console.error("[create-order] Error al crear orden Flow:", {
      planId: plan?.id,
      planNombre: plan?.nombre,
      sandbox: process.env.NEXT_PUBLIC_FLOW_SANDBOX === "true",
      apiKeyConfigurada: Boolean(process.env.FLOW_API_KEY),
      secretConfigurado: Boolean(process.env.FLOW_SECRET_KEY),
      urlBase: publicUrl,
      error: error instanceof Error ? error.message : String(error),
    });

    const message = error instanceof Error ? error.message : "Error al conectar con Flow";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
