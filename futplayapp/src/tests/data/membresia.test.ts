import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServerClient, __resetMocks, __setTableData, __setAuthUser } from "@/tests/mocks/supabase";

vi.mock("@/utils/supabase/client", () => ({
    createClient: vi.fn(),
}));

import { createClient } from "@/utils/supabase/client";
import { userHasMembresia, getMembresiaByUser, createMembresia, devolverToken, getAllMembresiasConPlan, getAdminMembresias } from "@/data/membresia";

const USER_ID = "user-test-001";

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    __resetMocks();
    vi.mocked(createClient).mockReturnValue(createMockServerClient() as any);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("userHasMembresia", () => {
    it("retorna true si hay membresías activas por vigencia", async () => {
        __setTableData("membresia", [{
            id: "m1",
            usuario_id: USER_ID,
            estado: true,
            congelada: false,
            sin_tokens: false,
            fecha_inicio: "2026-06-01T00:00:00.000Z",
            fecha_vencimiento: "2026-07-01T00:00:00.000Z",
        }]);

        const result = await userHasMembresia(USER_ID);

        expect(result).toBe(true);
    });

    it("retorna false si la membresía está cerrada por falta de tokens", async () => {
        // Aunque estado=true y queden días de vigencia, una membresía sin tokens
        // no cuenta como plan: el alumno debe poder comprar el siguiente.
        __setTableData("membresia", [{
            id: "m1",
            usuario_id: USER_ID,
            estado: true,
            congelada: false,
            sin_tokens: true,
            fecha_inicio: "2026-06-01T00:00:00.000Z",
            fecha_vencimiento: "2026-07-01T00:00:00.000Z",
        }]);

        const result = await userHasMembresia(USER_ID);

        expect(result).toBe(false);
    });

    it("retorna false si la membresía está VENCIDA aunque estado=true", async () => {
        __setTableData("membresia", [{
            id: "m1",
            usuario_id: USER_ID,
            estado: true,
            congelada: false,
            fecha_inicio: "2026-05-01T00:00:00.000Z",
            fecha_vencimiento: "2026-05-31T00:00:00.000Z",
        }]);

        const result = await userHasMembresia(USER_ID);

        expect(result).toBe(false);
    });

    it("retorna false si la membresía aún no comienza aunque estado=true", async () => {
        __setTableData("membresia", [{
            id: "m1",
            usuario_id: USER_ID,
            estado: true,
            congelada: false,
            fecha_inicio: "2026-07-01T00:00:00.000Z",
            fecha_vencimiento: "2026-08-01T00:00:00.000Z",
        }]);

        const result = await userHasMembresia(USER_ID);

        expect(result).toBe(false);
    });

    it("retorna false si el estado es false (inactiva)", async () => {
        __setTableData("membresia", [{
            id: "m1",
            usuario_id: USER_ID,
            estado: false,
            congelada: false,
            fecha_inicio: "2026-06-01T00:00:00.000Z",
            fecha_vencimiento: "2026-07-01T00:00:00.000Z",
        }]);

        const result = await userHasMembresia(USER_ID);

        expect(result).toBe(false);
    });

    it("retorna false si la membresía está CONGELADA aunque estado=true y esté vigente", async () => {
        __setTableData("membresia", [{
            id: "m1",
            usuario_id: USER_ID,
            estado: true,
            congelada: true,
            fecha_congelamiento: "2026-06-10T12:00:00.000Z",
            fecha_inicio: "2026-06-01T00:00:00.000Z",
            fecha_vencimiento: "2026-07-01T00:00:00.000Z",
        }]);

        const result = await userHasMembresia(USER_ID);

        expect(result).toBe(false);
    });

    it("retorna false si no hay membresías", async () => {
        __setTableData("membresia", []);

        const result = await userHasMembresia(USER_ID);

        expect(result).toBe(false);
    });

    it("retorna false si hay error", async () => {
        __setTableData("membresia", null, { message: "Error" });

        const result = await userHasMembresia(USER_ID);

        expect(result).toBe(false);
    });
});

describe("getMembresiaByUser", () => {
    const RAW_MEMBRESIA = {
        id: "memb-1",
        usuario_id: USER_ID,
        plan_id: "p1",
        tokens_totales: 30,
        tokens_usados: 10,
        fecha_inicio: "2026-06-01T00:00:00.000Z",
        fecha_vencimiento: "2026-07-01T00:00:00.000Z",
        estado: true,
    };

    it("retorna membresía con plan", async () => {
        __setTableData("membresia", RAW_MEMBRESIA);
        __setTableData("plan", { id: "p1", nombre: "Premium", tokens_mensuales: 30, precio: 40000 });

        const result = await getMembresiaByUser(USER_ID);

        expect(result).not.toBeNull();
        expect(result!.plan_nombre).toBe("Premium");
        expect(result!.tokens_totales).toBe(30);
        expect(result!.tokens_usados).toBe(10);
        expect(result!.tokens_restantes).toBe(20);
        expect(result!.precio).toBe(40000);
    });


    it("retorna null si no hay membresía", async () => {
        __setTableData("membresia", null);

        const result = await getMembresiaByUser(USER_ID);

        expect(result).toBeNull();
    });

    it("retorna null si hay error en membresía", async () => {
        __setTableData("membresia", null, { message: "Error" });

        const result = await getMembresiaByUser(USER_ID);

        expect(result).toBeNull();
    });

it("MB-012: membresía vencida => tokens_restantes 0 y NO intenta actualizar estado en BD", async () => {
        __setTableData("membresia", {
            id: "m-vencida",
            usuario_id: USER_ID,
            plan_id: "p1",
            tokens_totales: 30,
            tokens_usados: 4,
            fecha_inicio: "2026-05-01T00:00:00.000Z",
            fecha_vencimiento: "2026-05-31T00:00:00.000Z",
            estado: true,
        });
        __setTableData("plan", { id: "p1", nombre: "Premium", tokens_mensuales: 30, precio: 40000 });

        const result = await getMembresiaByUser(USER_ID);

        expect(result).not.toBeNull();
        expect(result!.tokens_restantes).toBe(0);
        expect(result!.tokens_usados).toBe(result!.tokens_totales);

        const fromSpy = createClient().from as ReturnType<typeof vi.fn>;
        const membresiaCalls = fromSpy.mock.calls.filter(([t]) => t === "membresia").length;
        expect(membresiaCalls).toBe(1);
    });

    it("MB-014: membresía CONGELADA vigente => tokens_restantes 0 y congelada=true", async () => {
        __setTableData("membresia", {
            id: "m-congelada",
            usuario_id: USER_ID,
            plan_id: "p1",
            tokens_totales: 30,
            tokens_usados: 4,
            fecha_inicio: "2026-06-01T00:00:00.000Z",
            fecha_vencimiento: "2026-07-01T00:00:00.000Z",
            estado: true,
            congelada: true,
            fecha_congelamiento: "2026-06-10T12:00:00.000Z",
        });
        __setTableData("plan", { id: "p1", nombre: "Premium", tokens_mensuales: 30, precio: 40000 });

        const result = await getMembresiaByUser(USER_ID);

        expect(result).not.toBeNull();
        expect(result!.congelada).toBe(true);
        expect(result!.fecha_congelamiento).toBe("2026-06-10T12:00:00.000Z");
        expect(result!.tokens_restantes).toBe(0);
        expect(result!.tokens_usados).toBe(result!.tokens_totales);
    });

});

describe("createMembresia", () => {
    it("retorna true si la inserción es exitosa", async () => {
        __setTableData("membresia", { id: "m-new" });

        const result = await createMembresia(USER_ID, "p1", 25, 30);

        expect(result).toBe(true);
    });

    it("retorna false si hay error", async () => {
        __setTableData("membresia", null, { message: "Insert failed" });

        const result = await createMembresia(USER_ID, "p1", 25, 30);

        expect(result).toBe(false);
    });

    it.each([
        { plan: "Plan Amateur", tokens: 4 },
        { plan: "Plan Pro", tokens: 6 },
        { plan: "Plan Selección", tokens: 12 },
    ])("asigna $tokens tokens totales al crear membresía de $plan", async ({ tokens }) => {
        __setTableData("membresia", { id: "m-new" });

        const result = await createMembresia(USER_ID, "p1", tokens, 30);

        expect(result).toBe(true);
        const fromSpy = createClient().from as ReturnType<typeof vi.fn>;
        const chain = fromSpy.mock.results[0]?.value;
        const insertedData = chain.insert.mock.calls[0]?.[0];
        expect(insertedData?.tokens_totales).toBe(tokens);
        expect(insertedData?.tokens_usados).toBe(0);
        expect(insertedData?.plan_id).toBe("p1");
        expect(insertedData?.usuario_id).toBe(USER_ID);
        expect(insertedData?.estado).toBe(true);
    });

    it("MB-011: fecha_vencimiento = fecha_inicio + dias del plan (ej 90 días)", async () => {
        __setTableData("membresia", { id: "m-new" });

        const result = await createMembresia(USER_ID, "p1", 10, 90);

        expect(result).toBe(true);
        const fromSpy = createClient().from as ReturnType<typeof vi.fn>;
        const chain = fromSpy.mock.results[0]?.value;
        const insertedData = chain.insert.mock.calls[0]?.[0];
        const diffDays = (new Date(insertedData.fecha_vencimiento).getTime() - new Date(insertedData.fecha_inicio).getTime()) / (24 * 60 * 60 * 1000);
        expect(diffDays).toBe(90);
    });
});

describe("devolverToken", () => {
    it("retorna true si la membresía actual tiene tokens usados", async () => {
        __setTableData("membresia", { id: "m1", usuario_id: USER_ID, tokens_usados: 5, estado: true });
        __setTableData("membresia_update", { id: "m1", tokens_usados: 4 });

        const result = await devolverToken(USER_ID);

        expect(result).toBe(true);
    });


    it("retorna false si no hay membresía", async () => {
        __setTableData("membresia", null);

        const result = await devolverToken(USER_ID);

        expect(result).toBe(false);
    });

    it("MB-009: retorna false si la membresía actual tiene tokens_usados=0 aunque haya una vieja con >0", async () => {
        __setTableData("membresia", [
            { id: "m-new", usuario_id: USER_ID, plan_id: "p1", tokens_totales: 30, tokens_usados: 0, fecha_inicio: "2026-06-01T00:00:00.000Z", fecha_vencimiento: "2026-07-01T00:00:00.000Z", estado: true },
            { id: "m-old", usuario_id: USER_ID, plan_id: "p1", tokens_totales: 30, tokens_usados: 5, fecha_inicio: "2026-05-01T00:00:00.000Z", fecha_vencimiento: "2026-05-31T00:00:00.000Z", estado: true },
        ]);

        const result = await devolverToken(USER_ID);

        expect(result).toBe(false);
    });
});

describe("getMembresiaByUser — múltiples membresías", () => {
    it("MB-007: elige la membresía más reciente cuando hay varias", async () => {
        __setTableData("membresia", [
            { id: "m-new", usuario_id: USER_ID, plan_id: "p1", tokens_totales: 30, tokens_usados: 5, fecha_inicio: "2026-06-01T00:00:00.000Z", fecha_vencimiento: "2026-07-01T00:00:00.000Z", estado: true },
            { id: "m-old", usuario_id: USER_ID, plan_id: "p1", tokens_totales: 30, tokens_usados: 20, fecha_inicio: "2026-05-01T00:00:00.000Z", fecha_vencimiento: "2026-05-31T00:00:00.000Z", estado: true },
        ]);
        __setTableData("plan", { id: "p1", nombre: "Premium", tokens_mensuales: 30, precio: 40000 });

        const result = await getMembresiaByUser(USER_ID);

        expect(result).not.toBeNull();
        expect(result!.membresia_id).toBe("m-new");
        expect(result!.tokens_restantes).toBe(25);
    });

    it("MB-008: usa membresía nueva aunque la vieja tenga más tokens restantes", async () => {
        __setTableData("membresia", [
            { id: "m-new", usuario_id: USER_ID, plan_id: "p1", tokens_totales: 30, tokens_usados: 0, fecha_inicio: "2026-06-01T00:00:00.000Z", fecha_vencimiento: "2026-07-01T00:00:00.000Z", estado: true },
            { id: "m-old", usuario_id: USER_ID, plan_id: "p1", tokens_totales: 30, tokens_usados: 10, fecha_inicio: "2026-05-01T00:00:00.000Z", fecha_vencimiento: "2026-05-31T00:00:00.000Z", estado: true },
        ]);
        __setTableData("plan", { id: "p1", nombre: "Premium", tokens_mensuales: 30, precio: 40000 });

        const result = await getMembresiaByUser(USER_ID);

        expect(result).not.toBeNull();
        expect(result!.membresia_id).toBe("m-new");
        expect(result!.tokens_restantes).toBe(30);
    });
});

describe("createMembresia — duplicados", () => {
    it("MB-010: crea membresía aunque exista una del mes pasado (no hay constraint único)", async () => {
        __setTableData("membresia", { id: "m1", usuario_id: USER_ID, plan_id: "p1", fecha_inicio: "2026-05-01T00:00:00.000Z", fecha_vencimiento: "2026-05-31T00:00:00.000Z", estado: true });

        const result = await createMembresia(USER_ID, "p1", 30, 30);

        expect(result).toBe(true);
    });
});

describe("getAllMembresiasConPlan", () => {
    const PLAN_A = { id: "pa", nombre: "Plan A", tokens_mensuales: 10, precio: 15000 };

    it("DATA-MEMB-TODAS-001: agrupa por usuario y elige la membresía con más tokens restantes", async () => {
        __setTableData("membresia", [
            { id: "m1", usuario_id: "u1", plan_id: "pa", tokens_totales: 10, tokens_usados: 2, fecha_inicio: "2026-06-01T00:00:00.000Z", fecha_vencimiento: "2026-07-01T00:00:00.000Z", estado: true },
            { id: "m2", usuario_id: "u1", plan_id: "pa", tokens_totales: 10, tokens_usados: 0, fecha_inicio: "2026-06-01T00:00:00.000Z", fecha_vencimiento: "2026-07-01T00:00:00.000Z", estado: true },
            { id: "m3", usuario_id: "u2", plan_id: "pa", tokens_totales: 10, tokens_usados: 5, fecha_inicio: "2026-06-01T00:00:00.000Z", fecha_vencimiento: "2026-07-01T00:00:00.000Z", estado: true },
        ]);
        __setTableData("plan", [PLAN_A]);

        const result = await getAllMembresiasConPlan();

        expect(result).toHaveLength(2);
        const u1 = result.find((m) => m.usuario_id === "u1");
        const u2 = result.find((m) => m.usuario_id === "u2");
        expect(u1).not.toBeUndefined();
        expect(u2).not.toBeUndefined();
        expect(u1!.membresia_id).toBe("m2");
        expect(u1!.tokens_restantes).toBe(10);
        expect(u2!.membresia_id).toBe("m3");
        expect(u2!.tokens_restantes).toBe(5);
    });

    it("MB-013: ignora membresía vencida con más tokens y elige la activa", async () => {
        __setTableData("membresia", [
            { id: "m-activa", usuario_id: "u1", plan_id: "pa", tokens_totales: 6, tokens_usados: 3, fecha_inicio: "2026-06-01T00:00:00.000Z", fecha_vencimiento: "2026-07-01T00:00:00.000Z", estado: true },
            { id: "m-vencida", usuario_id: "u1", plan_id: "pa", tokens_totales: 8, tokens_usados: 0, fecha_inicio: "2026-04-01T00:00:00.000Z", fecha_vencimiento: "2026-05-01T00:00:00.000Z", estado: true },
        ]);
        __setTableData("plan", [PLAN_A]);

        const result = await getAllMembresiasConPlan();

        const u1 = result.find((m) => m.usuario_id === "u1");
        expect(u1).not.toBeUndefined();
        expect(u1!.membresia_id).toBe("m-activa");
        expect(u1!.tokens_restantes).toBe(3);
    });

    it("DATA-MEMB-TODAS-002: retorna array vacío si no hay membresías", async () => {
        __setTableData("membresia", []);

        const result = await getAllMembresiasConPlan();

        expect(result).toEqual([]);
    });

    it("DATA-MEMB-TODAS-003: retorna array vacío si hay error", async () => {
        __setTableData("membresia", null, { message: "DB error" });

        const result = await getAllMembresiasConPlan();

        expect(result).toEqual([]);
    });

    it("DATA-MEMB-TODAS-004: usa 'Sin plan' si el plan no existe", async () => {
        __setTableData("membresia", [
            { id: "m1", usuario_id: "u1", plan_id: "unknown", tokens_totales: 10, tokens_usados: 0, fecha_inicio: "2026-06-01T00:00:00.000Z", fecha_vencimiento: "2026-07-01T00:00:00.000Z" },
        ]);
        __setTableData("plan", []);

        const result = await getAllMembresiasConPlan();

        expect(result).toHaveLength(1);
        expect(result[0].plan_nombre).toBe("Sin plan");
        expect(result[0].precio).toBe(0);
        expect(result[0].tokens_mensuales).toBe(0);
    });
});

describe("getAdminMembresias", () => {
    function mockFetch(response: object, status = 200) {
        return vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify(response), {
                status,
                headers: { "Content-Type": "application/json" },
            }),
        );
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("DATA-MEMB-ADMIN-001: retorna lista de membresías desde fetch", async () => {
        mockFetch([{ membresia_id: "m1", usuario_id: "u1", plan_nombre: "Pro" }]);

        const result = await getAdminMembresias();

        expect(result).toHaveLength(1);
        expect(result[0].plan_nombre).toBe("Pro");
    });

    it("DATA-MEMB-ADMIN-002: retorna array vacío si fetch falla", async () => {
        mockFetch({ error: "No autorizado" }, 403);

        const result = await getAdminMembresias();

        expect(result).toEqual([]);
    });

    it("DATA-MEMB-ADMIN-003: retorna array vacío si fetch lanza error", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

        const result = await getAdminMembresias();

        expect(result).toEqual([]);
    });
});
