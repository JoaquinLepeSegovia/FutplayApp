import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServerClient, __resetMocks, __setTableData, __setAuthUser } from "@/tests/mocks/supabase";

vi.mock("@/utils/supabase/client", () => ({
    createClient: vi.fn(),
}));

import { createClient } from "@/utils/supabase/client";
import {
    getCurrentUser,
    getUsuario,
    signInWithGoogle,
    buscarUsuarioPorTelefono,
    onAuthStateChange,
} from "@/data/auth";

const USER_ID = "auth-test-001";

beforeEach(() => {
    __resetMocks();
    const client = createMockServerClient();
    client.auth.signInWithOAuth = vi.fn(() =>
        Promise.resolve({ data: {}, error: null })
    );
    vi.mocked(createClient).mockReturnValue(client as any);
});

// signInWithGoogle uses window.location.origin, window.location.href y localStorage.
// En environment "node" no existen por defecto, así que los proveemos aquí.
vi.stubGlobal("window", {
    location: {
        origin: "http://localhost:3000",
        hostname: "localhost",
        href: "",
    },
});
vi.stubGlobal("localStorage", {
    _store: {} as Record<string, string>,
    getItem(key: string) { return this._store[key] ?? null; },
    setItem(key: string, value: string) { this._store[key] = value; },
    removeItem(key: string) { delete this._store[key]; },
    clear() { this._store = {}; },
});

describe("getCurrentUser", () => {
    it("DATA-AUTH-GCU-001: retorna usuario si está autenticado", async () => {
        __setAuthUser({ id: USER_ID, email: "test@test.cl" });

        const result = await getCurrentUser();

        expect(result.user).not.toBeNull();
        expect(result.user!.id).toBe(USER_ID);
        expect(result.error).toBeNull();
    });

    it("DATA-AUTH-GCU-002: retorna null si no está autenticado", async () => {
        __setAuthUser(null);

        const result = await getCurrentUser();

        expect(result.user).toBeNull();
        expect(result.error).toBeNull();
    });

    it("DATA-AUTH-GCU-003: retorna error si auth.getUser falla", async () => {
        const mockClient = createMockServerClient();
        mockClient.auth.getUser = vi.fn(() =>
            Promise.resolve({ data: { user: null }, error: { message: "Auth error" } })
        );
        vi.mocked(createClient).mockReturnValue(mockClient as any);

        const result = await getCurrentUser();

        expect(result.user).toBeNull();
        expect(result.error).toBe("Auth error");
    });

    it("DATA-AUTH-GCU-004: maneja excepción inesperada", async () => {
        const mockClient = createMockServerClient();
        mockClient.auth.getUser = vi.fn(() => Promise.reject(new Error("Unexpected")));
        vi.mocked(createClient).mockReturnValue(mockClient as any);

        const result = await getCurrentUser();

        expect(result.user).toBeNull();
        expect(result.error).toBe("Error inesperado al obtener usuario");
    });
});

describe("getUsuario", () => {
    it("DATA-AUTH-GU-001: retorna datos del usuario", async () => {
        __setTableData("usuario", { id: USER_ID, nombre: "Juan Pérez", rol: "jugador" });

        const result = await getUsuario(USER_ID);

        expect(result).not.toBeNull();
        expect(result!.id).toBe(USER_ID);
        expect(result!.nombre).toBe("Juan Pérez");
        expect(result!.rol).toBe("jugador");
    });

    it("DATA-AUTH-GU-002: retorna null si hay error", async () => {
        __setTableData("usuario", null, { message: "Error" });

        const result = await getUsuario(USER_ID);

        expect(result).toBeNull();
    });

    it("DATA-AUTH-GU-003: maneja excepción inesperada", async () => {
        const mockClient = createMockServerClient();
        mockClient.from = vi.fn(() => {
            throw new Error("Unexpected error");
        });
        vi.mocked(createClient).mockReturnValue(mockClient as any);

        const result = await getUsuario(USER_ID);

        expect(result).toBeNull();
    });
});

describe("signInWithGoogle", () => {
    beforeEach(() => {
        vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "google-client-id-test");
        (globalThis.window as any).location.href = "";
        (globalThis.localStorage as any)._store = {};
    });

    it("DATA-AUTH-SIG-001: inicia sesión correctamente", async () => {
        const { error } = await signInWithGoogle();

        expect(error).toBeNull();
        // Redirige a Google OAuth
        expect((globalThis.window as any).location.href).toContain("accounts.google.com/o/oauth2/v2/auth");
        // Guarda el estado anti-CSRF en localStorage
        expect((globalThis.localStorage as any)._store.oauth_state).toBeTruthy();
    });

    it("DATA-AUTH-SIG-002: construye la URL de Google con client_id, redirect_uri y scope", async () => {
        await signInWithGoogle();

        const href = (globalThis.window as any).location.href as string;
        const url = new URL(href);
        expect(url.searchParams.get("client_id")).toBe("google-client-id-test");
        expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("scope")).toContain("openid");
        expect(url.searchParams.get("state")).toBeTruthy();
    });

    it("DATA-AUTH-SIG-003: maneja excepción devolviendo mensaje amigable", async () => {
        const originalSetItem = (globalThis.localStorage as any).setItem;
        (globalThis.localStorage as any).setItem = vi.fn(() => {
            throw new Error("QuotaExceededError");
        });

        const result = await signInWithGoogle();

        expect(result.error).toBe("Error al iniciar sesión con Google");

        (globalThis.localStorage as any).setItem = originalSetItem;
    });
});

describe("buscarUsuarioPorTelefono", () => {
    it("DATA-AUTH-BUS-001: encuentra usuario por teléfono", async () => {
        const userData = { id: USER_ID, nombre: "Juan", rol: "jugador" as const };
        __setTableData("usuario", userData);

        const result = await buscarUsuarioPorTelefono("+56912345678");

        expect(result).not.toBeNull();
        expect(result!.id).toBe(USER_ID);
        expect(result!.nombre).toBe("Juan");
    });

    it("DATA-AUTH-BUS-002: retorna null si no encuentra", async () => {
        __setTableData("usuario", null);

        const result = await buscarUsuarioPorTelefono("+56987654321");

        expect(result).toBeNull();
    });
});

describe("onAuthStateChange", () => {
    it("DATA-AUTH-OASC-001: registra callback y recibe evento", () => {
        const mockClient = createMockServerClient();
        const subscription = { unsubscribe: vi.fn() };
        mockClient.auth.onAuthStateChange = vi.fn(() => ({
            data: { subscription },
        }));
        vi.mocked(createClient).mockReturnValue(mockClient as any);

        const callback = vi.fn();
        const result = onAuthStateChange(callback);

        expect(mockClient.auth.onAuthStateChange).toHaveBeenCalled();
        expect(result).toHaveProperty("unsubscribe");
    });
});
