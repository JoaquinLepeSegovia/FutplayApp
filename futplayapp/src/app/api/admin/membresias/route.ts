import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { traducirError } from "@/lib/errores";
import { ahoraChile } from "@/lib/fechas";

export async function GET() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: usuario } = await supabase
    .from("usuario")
    .select("rol")
    .eq("id", user.id)
    .single();

  if (!usuario || (usuario.rol !== "administrador" && usuario.rol !== "profesor")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Falta SUPABASE_SERVICE_ROLE_KEY en .env.local. Cópiala desde Supabase Dashboard → Settings → API → service_role key" },
      { status: 500 }
    );
  }

  const adminClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    {
      cookies: {
        getAll() { return []; },
        setAll() {},
      },
    }
  );

  const { data: membresias, error } = await adminClient
    .from("membresia")
    .select("*")
    .order("usuario_id");

  if (error) {
    return NextResponse.json({ error: traducirError(error.message) }, { status: 500 });
  }

  const planIds = [...new Set((membresias || []).map((m) => m.plan_id))];

  const { data: planes } = await adminClient
    .from("plan")
    .select("*")
    .in("id", planIds);

  const planesMap = new Map((planes || []).map((p) => [p.id, p]));

  type MembresiaRow = {
    membresia_id: string;
    usuario_id: string;
    plan_id: string;
    plan_nombre: string;
    tokens_mensuales: number;
    precio: number;
    dias?: number | null;
    tokens_totales: number;
    tokens_usados: number;
    tokens_restantes: number;
    fecha_inicio: string;
    fecha_vencimiento: string;
    estado: boolean;
    congelada: boolean;
    sin_tokens: boolean;
  };
  const resultMap = new Map<string, MembresiaRow>();

  // Se elige la fila con más tokens RESTANTES, no la mayor resta cruda: una
  // membresía vencida, congelada o sin tokens no compite. Antes ganaba la fila
  // con más saldo sin importar si estaba vigente, y el panel mostraba como
  // "Activo" a un alumno cuyo único plan ya había vencido.
  for (const m of membresias || []) {
    const sinTokens = m.sin_tokens === true;
    const vigente =
      m.estado === true &&
      !sinTokens &&
      !m.congelada &&
      new Date(m.fecha_vencimiento) >= ahoraChile();
    const restantes = vigente ? m.tokens_totales - m.tokens_usados : 0;

    const existing = resultMap.get(m.usuario_id);

    if (!existing || restantes > existing.tokens_restantes) {
      const plan = planesMap.get(m.plan_id);
      resultMap.set(m.usuario_id, {
        membresia_id: m.id,
        usuario_id: m.usuario_id,
        plan_id: m.plan_id,
        plan_nombre: plan?.nombre || "Sin plan",
        tokens_mensuales: plan?.tokens_mensuales || 0,
        precio: plan?.precio || 0,
        dias: plan?.dias,
        tokens_totales: m.tokens_totales,
        tokens_usados: m.tokens_usados,
        tokens_restantes: restantes,
        fecha_inicio: m.fecha_inicio,
        fecha_vencimiento: m.fecha_vencimiento,
        estado: m.estado === true,
        congelada: m.congelada === true,
        sin_tokens: sinTokens,
      });
    }
  }

  return NextResponse.json(Array.from(resultMap.values()));
}
