import { NextResponse } from "next/server";
import { verifyAdmin, getAdminClient } from "@/utils/supabase/admin";
import { traducirError } from "@/lib/errores";

export const dynamic = "force-dynamic";

type MembresiaGestionRow = {
  id: string;
  usuario_id: string;
  usuario_nombre: string;
  plan_id: string;
  plan_nombre: string;
  boleta_id: string | null;
  tokens_totales: number;
  tokens_usados: number;
  fecha_inicio: string;
  fecha_vencimiento: string;
  estado: boolean;
  congelada: boolean;
  sin_tokens: boolean;
  fecha_congelamiento: string | null;
  created_at: string | null;
};

export async function GET() {
  const user = await verifyAdmin();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const admin = await getAdminClient();

    const { data: membresias, error } = await admin
      .from("membresia")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: traducirError(error.message) }, { status: 500 });

    const list = membresias || [];

    const usuarioIds = [...new Set(list.map((m) => m.usuario_id))];
    const planIds = [...new Set(list.map((m) => m.plan_id))];

    const [usuariosRes, planesRes] = await Promise.all([
      usuarioIds.length > 0
        ? admin.from("usuario").select("id, nombre").in("id", usuarioIds)
        : Promise.resolve({ data: [] }),
      planIds.length > 0
        ? admin.from("plan").select("id, nombre").in("id", planIds)
        : Promise.resolve({ data: [] }),
    ]);

    const usuariosMap = new Map((usuariosRes.data || []).map((u) => [u.id, u.nombre]));
    const planesMap = new Map((planesRes.data || []).map((p) => [p.id, p.nombre]));

    const result: MembresiaGestionRow[] = list.map((m) => ({
      id: m.id,
      usuario_id: m.usuario_id,
      usuario_nombre: usuariosMap.get(m.usuario_id) || "Usuario desconocido",
      plan_id: m.plan_id,
      plan_nombre: planesMap.get(m.plan_id) || "Sin plan",
      boleta_id: m.boleta_id,
      tokens_totales: m.tokens_totales,
      tokens_usados: m.tokens_usados,
      fecha_inicio: m.fecha_inicio,
      fecha_vencimiento: m.fecha_vencimiento,
      estado: m.estado,
      congelada: m.congelada === true,
      sin_tokens: m.sin_tokens === true,
      fecha_congelamiento: m.fecha_congelamiento ?? null,
      created_at: m.created_at,
    }));

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: traducirError(message) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await verifyAdmin();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const admin = await getAdminClient();
    const body = await request.json();

    if (!body.usuario_id || !body.plan_id || !body.fecha_inicio || !body.fecha_vencimiento) {
      return NextResponse.json(
        { error: "Faltan campos: usuario_id, plan_id, fecha_inicio, fecha_vencimiento" },
        { status: 400 }
      );
    }

    const { error } = await admin.from("membresia").insert({
      usuario_id: body.usuario_id,
      plan_id: body.plan_id,
      boleta_id: body.boleta_id || null,
      tokens_totales: body.tokens_totales ?? 0,
      tokens_usados: body.tokens_usados ?? 0,
      fecha_inicio: body.fecha_inicio,
      fecha_vencimiento: body.fecha_vencimiento,
      estado: body.estado ?? true,
    });

    if (error) return NextResponse.json({ error: traducirError(error.message) }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: traducirError(message) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await verifyAdmin();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const admin = await getAdminClient();
    const body = await request.json();

    if (!body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    const updateData: Record<string, unknown> = {};
    if (body.usuario_id !== undefined) updateData.usuario_id = body.usuario_id;
    if (body.plan_id !== undefined) updateData.plan_id = body.plan_id;
    if (body.boleta_id !== undefined) updateData.boleta_id = body.boleta_id;
    if (body.tokens_totales !== undefined) updateData.tokens_totales = body.tokens_totales;
    if (body.tokens_usados !== undefined) updateData.tokens_usados = body.tokens_usados;
    if (body.fecha_inicio !== undefined) updateData.fecha_inicio = body.fecha_inicio;
    if (body.fecha_vencimiento !== undefined) updateData.fecha_vencimiento = body.fecha_vencimiento;
    if (body.estado !== undefined) updateData.estado = body.estado;

    // Al reactivar a mano una membresía cerrada por falta de tokens hay que
    // limpiar elFlag: si queda sin_tokens=true, la búsqueda de partidos y el
    // badge del panel la seguirían tratando como agotada. El trigger vuelve a
    // a cerrarla sola cuando el alumno gaste el token recuperado.
    if (body.sin_tokens !== undefined) updateData.sin_tokens = body.sin_tokens;
    else if (body.estado === true) updateData.sin_tokens = false;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    const { error } = await admin.from("membresia").update(updateData).eq("id", body.id);
    if (error) return NextResponse.json({ error: traducirError(error.message) }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: traducirError(message) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await verifyAdmin();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const admin = await getAdminClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    const { error } = await admin.from("membresia").delete().eq("id", id);
    if (error) return NextResponse.json({ error: traducirError(error.message) }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: traducirError(message) }, { status: 500 });
  }
}
