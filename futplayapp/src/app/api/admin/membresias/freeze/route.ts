import { NextResponse } from "next/server";
import { verifyAdmin, getAdminClient } from "@/utils/supabase/admin";
import { traducirError } from "@/lib/errores";
import { ahoraChile } from "@/lib/fechas";

export const dynamic = "force-dynamic";

type MembresiaRow = {
  id: string;
  estado: boolean;
  congelada: boolean;
  sin_tokens: boolean;
  fecha_inicio: string;
  fecha_vencimiento: string;
  fecha_congelamiento: string | null;
};

export async function POST(request: Request) {
  const user = await verifyAdmin();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const admin = await getAdminClient();
    const body = await request.json();

    const membreciaId = body?.membreciaId;
    const accion = body?.accion;

    if (!membreciaId) {
      return NextResponse.json({ error: "membreciaId requerido" }, { status: 400 });
    }
    if (accion !== "congelar" && accion !== "reactivar") {
      return NextResponse.json({ error: 'accion debe ser "congelar" o "reactivar"' }, { status: 400 });
    }

    const { data: membresia, error } = await admin
      .from("membresia")
      .select("id, estado, congelada, sin_tokens, fecha_inicio, fecha_vencimiento, fecha_congelamiento")
      .eq("id", membreciaId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: traducirError(error.message) }, { status: 500 });
    }
    if (!membresia) {
      return NextResponse.json({ error: "Membresía no encontrada" }, { status: 404 });
    }

    const now = ahoraChile();
    const nowIso = now.toISOString();

    if (accion === "congelar") {
      const m = membresia as MembresiaRow;
      if (m.congelada) {
        return NextResponse.json({ error: "La membresía ya está congelada" }, { status: 400 });
      }
      if (m.sin_tokens) {
        return NextResponse.json(
          { error: "No se puede congelar una membresía sin tokens: no tiene saldo que pausar" },
          { status: 400 }
        );
      }
      if (!m.estado) {
        return NextResponse.json({ error: "Solo se puede congelar una membresía activa" }, { status: 400 });
      }
      if (!(new Date(m.fecha_inicio) <= now && now <= new Date(m.fecha_vencimiento))) {
        return NextResponse.json(
          { error: "Solo se puede congelar una membresía dentro de su vigencia" },
          { status: 400 }
        );
      }

      const { error: updateError } = await admin
        .from("membresia")
        .update({ congelada: true, fecha_congelamiento: nowIso })
        .eq("id", membreciaId);

      if (updateError) {
        return NextResponse.json({ error: traducirError(updateError.message) }, { status: 500 });
      }

      return NextResponse.json({ ok: true, congelada: true });
    }

    // accion === "reactivar"
    const m = membresia as MembresiaRow;
    if (!m.congelada) {
      return NextResponse.json({ error: "La membresía no está congelada" }, { status: 400 });
    }
    if (!m.fecha_congelamiento) {
      return NextResponse.json(
        { error: "La membresía no tiene fecha de congelamiento registrada" },
        { status: 400 }
      );
    }

    const deltaMs = now.getTime() - new Date(m.fecha_congelamiento).getTime();
    const nuevoVencimiento = new Date(new Date(m.fecha_vencimiento).getTime() + deltaMs);

    const { error: updateError } = await admin
      .from("membresia")
      .update({
        congelada: false,
        fecha_congelamiento: null,
        fecha_vencimiento: nuevoVencimiento.toISOString(),
      })
      .eq("id", membreciaId);

    if (updateError) {
      return NextResponse.json({ error: traducirError(updateError.message) }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      congelada: false,
      fecha_vencimiento: nuevoVencimiento.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: traducirError(message) }, { status: 500 });
  }
}