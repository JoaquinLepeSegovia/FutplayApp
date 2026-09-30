"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  Search,
  Snowflake,
  Play,
} from "lucide-react";
import {
  getMembresiasGestion,
  createMembresiaGestion,
  updateMembresiaGestion,
  deleteMembresiaGestion,
  congelarMembresia,
  reactivarMembresia,
  type MembresiaGestion,
} from "@/data/membresia";
import { getUsers, getPlanesAdmin, type Plan } from "@/data/plans";
import type { Student } from "@/components/admin/StudentsTable";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { ahoraChile } from "@/lib/fechas";

type ModalMode = "create" | "edit" | null;

type MembresiaForm = {
  id?: string;
  usuario_id: string;
  plan_id: string;
  boleta_id: string;
  tokens_totales: number;
  tokens_usados: number;
  fecha_inicio: string;
  fecha_vencimiento: string;
  estado: boolean;
};

const emptyForm: MembresiaForm = {
  usuario_id: "",
  plan_id: "",
  boleta_id: "",
  tokens_totales: 0,
  tokens_usados: 0,
  fecha_inicio: "",
  fecha_vencimiento: "",
  estado: true,
};

function isoToDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

function dateToIso(date: string): string {
  return date ? new Date(date + "T00:00:00").toISOString() : "";
}

function formatFecha(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function EstadoBadge({ m }: { m: MembresiaGestion }) {
  if (m.congelada) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
        Congelada
      </span>
    );
  }
  if (m.sin_tokens) {
    return (
      <span
        className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700"
        title="Se cerró al agotarse los tokens. El alumno puede comprar el plan siguiente. Si devolvió un token por cancelación, reactivala para devolvérselo."
      >
        Sin tokens
      </span>
    );
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.estado ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
      {m.estado ? "Activa" : "Inactiva"}
    </span>
  );
}

export default function MembresiasPage() {
  const [membresias, setMembresias] = useState<MembresiaGestion[]>([]);
  const [usuarios, setUsuarios] = useState<Student[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalMode>(null);
  const [form, setForm] = useState<MembresiaForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [freezeAction, setFreezeAction] = useState<{ id: string; action: "congelar" | "reactivar" } | null>(null);

  const fetchData = useCallback(async () => {
    const [m, u, planesResult] = await Promise.all([
      getMembresiasGestion(),
      getUsers(),
      getPlanesAdmin(),
    ]);
    setMembresias(m);
    setUsuarios(u.filter((user) => user.role !== "Admin"));
    setPlanes(planesResult.planes);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = membresias.filter((m) =>
    m.usuario_nombre.toLowerCase().includes(search.toLowerCase()) ||
    m.plan_nombre.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => { setForm(emptyForm); setError(null); };

  const openCreate = () => {
    resetForm();
    setModal("create");
  };

  const openEdit = (m: MembresiaGestion) => {
    setForm({
      id: m.id,
      usuario_id: m.usuario_id,
      plan_id: m.plan_id,
      boleta_id: m.boleta_id || "",
      tokens_totales: m.tokens_totales,
      tokens_usados: m.tokens_usados,
      fecha_inicio: isoToDate(m.fecha_inicio),
      fecha_vencimiento: isoToDate(m.fecha_vencimiento),
      estado: m.estado,
    });
    setModal("edit");
  };

  const handleSave = async () => {
    if (!form.usuario_id || !form.plan_id) {
      setError("Usuario y plan son obligatorios");
      return;
    }
    if (modal === "edit") {
      if (!form.fecha_inicio || !form.fecha_vencimiento) {
        setError("Fecha de inicio y vencimiento son obligatorias");
        return;
      }
      if (form.fecha_vencimiento < form.fecha_inicio) {
        setError("La fecha de vencimiento no puede ser anterior a la de inicio");
        return;
      }
    }
    setSaving(true);
    setError(null);

    const isCreate = modal === "create";
    const planSel = planes.find((pl) => pl.id === form.plan_id);
    const diasVigencia = planSel?.dias_vigencia ?? planSel?.dias ?? 30;
    const ahora = ahoraChile();
    const fecha_inicio = isCreate ? ahora.toISOString() : dateToIso(form.fecha_inicio);
    const fecha_vencimiento = isCreate
      ? new Date(ahora.getTime() + diasVigencia * 24 * 60 * 60 * 1000).toISOString()
      : dateToIso(form.fecha_vencimiento);

    const boleta_id = form.boleta_id.trim() || null;

    const ok = isCreate
      ? await createMembresiaGestion({
          usuario_id: form.usuario_id,
          plan_id: form.plan_id,
          boleta_id,
          tokens_totales: form.tokens_totales,
          dias: diasVigencia,
        })
      : await updateMembresiaGestion(form.id!, {
          usuario_id: form.usuario_id,
          plan_id: form.plan_id,
          boleta_id,
          tokens_totales: form.tokens_totales,
          tokens_usados: form.tokens_usados,
          fecha_inicio,
          fecha_vencimiento,
          estado: form.estado,
        });

    if (!ok) {
      setError("Error al guardar");
      setSaving(false);
      return;
    }

    setSaving(false);
    setModal(null);
    resetForm();
    fetchData();
  };

  const handleDelete = async (id: string) => {
    setMembresias((prev) => prev.filter((m) => m.id !== id));
    const ok = await deleteMembresiaGestion(id);
    if (!ok) {
      setError("Error al eliminar");
      fetchData();
    }
  };

  const handleFreezeAction = async () => {
    if (!freezeAction) return;
    setSaving(true);
    setError(null);
    setExito(null);
    const result = freezeAction.action === "congelar"
      ? await congelarMembresia(freezeAction.id)
      : await reactivarMembresia(freezeAction.id);
    const action = freezeAction.action;
    const id = freezeAction.id;
    setFreezeAction(null);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "Error al ejecutar la acción");
      return;
    }
    const nombre = membresias.find((m) => m.id === id)?.usuario_nombre ?? "";
    setExito(action === "congelar"
      ? `Membresía de ${nombre} congelada correctamente. Los días quedan pausados.`
      : `Membresía de ${nombre} reactivada correctamente. Nuevo vencimiento: ${formatFecha(result.fecha_vencimiento ?? "")}`);
    fetchData();
  };

  if (loading && membresias.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-5 h-5 animate-spin text-[#F28C28]" />
      </div>
    );
  }

  return (
    <>
      <div className="p-4 sm:p-6">
        <div className="flex flex-col gap-6 w-full mx-auto" style={{ maxWidth: "1216px" }}>

          {/* HEADER */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900">Membresías</h1>
              <p className="text-gray-500 text-sm mt-1">Administra las membresías de los usuarios</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={openCreate}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 w-full sm:w-auto"
              >
                <Plus size={16} />
                Nueva Membresía
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          )}
          {exito && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{exito}</div>
          )}

          {/* LISTA */}
          <div className="bg-white border border-gray-200">
            <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="relative w-full sm:max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por usuario o plan..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              <span className="text-sm text-gray-500 self-end sm:self-auto">{filtered.length} membresía{filtered.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="md:overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="hidden md:table-header-group">
                  <tr className="text-left text-gray-500 border-b bg-gray-50/50">
                    <th className="p-3 font-semibold">Usuario</th>
                    <th className="p-3 font-semibold">Plan</th>
                    <th className="p-3 font-semibold">Tokens</th>
                    <th className="p-3 font-semibold">Inicio</th>
                    <th className="p-3 font-semibold">Vencimiento</th>
                    <th className="p-3 font-semibold">Estado</th>
                    <th className="p-3 font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-400">
                        {search ? "No se encontraron membresías" : "No hay membresías creadas aún"}
                      </td>
                    </tr>
                  ) : filtered.map((m) => (
                    <Fragment key={m.id}>
                      {/* MOBILE CARD */}
                      <tr className="md:hidden border-b border-gray-100">
                        <td colSpan={7} className="p-0">
                          <div className="p-3 space-y-1.5">
                            <p className="font-semibold text-gray-900 truncate text-sm">{m.usuario_nombre}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                              <div><span className="text-gray-400">Plan: </span><span className="font-semibold text-gray-900">{m.plan_nombre}</span></div>
                              <div><span className="text-gray-400">Tokens: </span><span className="font-semibold text-gray-700">{m.tokens_usados}/{m.tokens_totales}</span></div>
                              <div><span className="text-gray-400">Vence: </span><span className="font-semibold text-gray-700">{formatFecha(m.fecha_vencimiento)}</span></div>
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-gray-50">
                              <EstadoBadge m={m} />
                              <div className="flex gap-2">
                                {(!m.congelada && m.estado) && (
                                  <button onClick={() => setFreezeAction({ id: m.id, action: "congelar" })} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-lg" title="Congelar"><Snowflake size={14} /></button>
                                )}
                                {m.congelada && (
                                  <button onClick={() => setFreezeAction({ id: m.id, action: "reactivar" })} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Reactivar"><Play size={14} /></button>
                                )}
                                <button onClick={() => openEdit(m)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Editar"><Pencil size={14} /></button>
                                <button onClick={() => setDeleteId(m.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg" title="Eliminar"><Trash2 size={14} /></button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {/* DESKTOP ROW */}
                      <tr className="hidden md:table-row border-b hover:bg-gray-50/50">
                        <td className="p-3 font-semibold text-gray-900 truncate max-w-[200px]">{m.usuario_nombre}</td>
                        <td className="p-3 text-gray-600">
                          <span className="font-semibold">{m.plan_nombre}</span>
                        </td>
                        <td className="p-3 text-gray-600 whitespace-nowrap">
                          <span className="font-semibold text-gray-900">{m.tokens_usados}</span>
                          <span className="text-gray-400"> / {m.tokens_totales}</span>
                        </td>
                        <td className="p-3 text-gray-600 whitespace-nowrap">{formatFecha(m.fecha_inicio)}</td>
                        <td className="p-3 text-gray-600 whitespace-nowrap">{formatFecha(m.fecha_vencimiento)}</td>
                        <td className="p-3">
                          <EstadoBadge m={m} />
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            {(!m.congelada && m.estado) && (
                              <button
                                onClick={() => setFreezeAction({ id: m.id, action: "congelar" })}
                                className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-lg"
                                title="Congelar"
                              >
                                <Snowflake size={16} />
                              </button>
                            )}
                            {m.congelada && (
                              <button
                                onClick={() => setFreezeAction({ id: m.id, action: "reactivar" })}
                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                                title="Reactivar"
                              >
                                <Play size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => openEdit(m)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Editar"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteId(m.id)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                              title="Eliminar"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* MODAL */}
        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white border-t-2 border-t-[#F28C28] w-full max-w-lg p-6 shadow-xl max-h-[92vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  {modal === "create" ? "Nueva Membresía" : "Editar Membresía"}
                </h2>
                <button onClick={() => { setModal(null); resetForm(); }} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Usuario */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Usuario *</label>
                  <select
                    value={form.usuario_id}
                    onChange={(e) => setForm((p) => ({ ...p, usuario_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                  >
                    <option value="">Seleccionar usuario</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>

                {/* Plan */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Plan *</label>
                  <select
                    value={form.plan_id}
                    onChange={(e) => {
                      const plan = planes.find((pl) => pl.id === e.target.value);
                      setForm((p) => ({
                        ...p,
                        plan_id: e.target.value,
                        tokens_totales: plan?.tokens_mensuales || 0,
                      }));
                    }}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                  >
                    <option value="">Seleccionar plan</option>
                    {planes.map((pl) => (
                      <option key={pl.id} value={pl.id}>{pl.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Tokens Totales *</label>
                    <input
                      type="number"
                      value={form.tokens_totales || ""}
                      onChange={(e) => setForm((p) => ({ ...p, tokens_totales: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                      min={0}
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Se autocompleta según el plan seleccionado</p>
                  </div>
                </div>

                {modal === "create" ? (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Vigencia</label>
                    <p className="px-3 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-600">
                      Inicia hoy y vence en {planes.find((pl) => pl.id === form.plan_id)?.dias_vigencia ?? 30} días exactos
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Fecha Inicio *</label>
                      <input
                        type="date"
                        value={form.fecha_inicio}
                        onChange={(e) => setForm((p) => ({ ...p, fecha_inicio: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Fecha Vencimiento *</label>
                      <input
                        type="date"
                        value={form.fecha_vencimiento}
                        onChange={(e) => setForm((p) => ({ ...p, fecha_vencimiento: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                  </div>
                )}

                {/* Boleta */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Boleta ID</label>
                  <input
                    type="text"
                    value={form.boleta_id}
                    onChange={(e) => setForm((p) => ({ ...p, boleta_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                    placeholder="Opcional"
                  />
                </div>

                {/* Estado */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Estado</label>
                  <select
                    value={form.estado ? "true" : "false"}
                    onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value === "true" }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                  >
                    <option value="true">Activa</option>
                    <option value="false">Inactiva</option>
                  </select>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
                <button
                  onClick={() => { setModal(null); resetForm(); }}
                  disabled={saving}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {modal === "create" ? "Crear Membresía" : "Guardar Cambios"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="Eliminar membresía"
        message="¿Eliminar esta membresía? Esta acción no se puede deshacer."
        onConfirm={() => deleteId && handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={freezeAction !== null}
        title={freezeAction?.action === "congelar" ? "Congelar membresía" : "Reactivar membresía"}
        message={freezeAction?.action === "congelar"
          ? "¿Congelar esta membresía? El tiempo dejará de correr y el jugador no podrá reservar clases hasta reactivar."
          : "¿Reactivar esta membresía? El vencimiento se correrá por la cantidad de días que estuvo congelada."}
        onConfirm={handleFreezeAction}
        onCancel={() => setFreezeAction(null)}
      />
    </>
  );
}
