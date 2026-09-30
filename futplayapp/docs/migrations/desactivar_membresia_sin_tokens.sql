-- MEMBRESÍA SIN TOKENS → DESACTIVAR
--
-- Regla de negocio:
--   - Al consumir el último token, la membresía se desactiva de inmediato para
--     que el alumno pueda comprar el plan siguiente. Los días restantes se pierden.
--   - Al cancelar una clase NO se reactiva automáticamente: el token se devuelve
--     pero la membresía sigue cerrada, y el admin la levanta desde el panel de
--     gestión (src/app/(admin)/admin/membresias).
--   - Excepción: los partidos NO consumen token, así que una membresía cerrada por
--     falta de tokens sigue habilitando el agendado de partidos mientras esté
--     dentro de su vigencia.
--
-- Por qué la columna sin_tokens: distingue "inactiva porque se acabaron los
-- tokens" de "inactiva porque venció" o "desactivada por admin". Sin ella no se
-- podría permitir el acceso a partidos, porque el trigger busca por estado=true.
--
-- Ejecutar en el SQL Editor de Supabase. Idempotente (se puede re-ejecutar).

-- ── 1) Columna nueva ─────────────────────────────────────────────────────────
ALTER TABLE public.membresia
  ADD COLUMN IF NOT EXISTS sin_tokens boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.membresia.sin_tokens IS
  'Membresía cerrada por agotar sus tokens (no por vencimiento ni por admin). Permite seguir agendando partidos.';

-- ── 2) Inscripción a clases: desactivar al agotar tokens, partidos siguen ─────
CREATE OR REPLACE FUNCTION public.manejar_inscripcion_clase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clase      clase%ROWTYPE;
    v_membresia  membresia%ROWTYPE;
    v_es_partido boolean;
BEGIN
    -- Cargar la clase.
    -- coalesce: si tipo_evento viniera NULL se trata como NO partido y sí
    -- consume token (falla cerrado). Antes un NULL dejaba pasar el descuento.
    SELECT * INTO v_clase FROM clase WHERE id = NEW.clase_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Clase no encontrada';
    END IF;

    v_es_partido := coalesce(v_clase.tipo_evento = 'partido', false);

    IF v_es_partido THEN
        -- Partidos: se admite la membresía activa Y la cerrada sin tokens.
        SELECT * INTO v_membresia
        FROM membresia
        WHERE usuario_id = NEW.usuario_id
          AND congelada = false
          AND fecha_inicio <= now()
          AND fecha_vencimiento >= now()
          AND (estado = true OR sin_tokens = true)
        ORDER BY (estado = true AND NOT sin_tokens) DESC, fecha_vencimiento DESC
        LIMIT 1;
    ELSE
        -- Entrenamiento y Kids: solo la membresía activa (regla sin cambios).
        SELECT * INTO v_membresia
        FROM membresia
        WHERE usuario_id = NEW.usuario_id
          AND estado = true
          AND congelada = false
          AND fecha_inicio <= now()
          AND fecha_vencimiento >= now()
        ORDER BY fecha_vencimiento DESC
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No tienes membresía activa';
    END IF;

    IF NOT v_es_partido THEN
        IF (v_membresia.tokens_totales - v_membresia.tokens_usados) <= 0 THEN
            RAISE EXCEPTION 'No tienes tokens disponibles';
        END IF;

        -- Descontar y, si se agotaron, cerrar en la MISMA sentencia: atómico,
        -- sin carrera entre dos reservas simultáneas.
        UPDATE membresia
           SET tokens_usados = tokens_usados + 1,
               sin_tokens   = (tokens_usados + 1 >= tokens_totales),
               estado       = CASE WHEN tokens_usados + 1 >= tokens_totales
                                   THEN false ELSE estado END
         WHERE id = v_membresia.id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_inscripcion ON public.clase_usuario;
CREATE TRIGGER trigger_inscripcion
BEFORE INSERT ON public.clase_usuario
FOR EACH ROW EXECUTE FUNCTION public.manejar_inscripcion_clase();

-- ── 3) devolver_token: devuelve el token aunque la membresía esté cerrada ────
CREATE OR REPLACE FUNCTION public.devolver_token(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
declare
  membresia_id uuid;
  tokens_usados_actual int;
begin
  -- Preferencia: si existe una membresía activa y con tokens, se usa esa.
  -- Si no, se cae a la cerrada por sin_tokens, para no perder el token.
  select id, tokens_usados into membresia_id, tokens_usados_actual
  from membresia
  where usuario_id = p_usuario_id
    and congelada = false
    and tokens_usados > 0
    and fecha_inicio <= now()
    and fecha_vencimiento >= now()
    and (estado = true or sin_tokens = true)
  order by (estado = true and not sin_tokens) desc, fecha_vencimiento desc
  limit 1;

  if membresia_id is null then
    return false;
  end if;

  -- Solo se descuenta el token. NO se toca estado ni sin_tokens:
  --   - la membresía sigue cerrada (la levanta el admin),
  --   - los partidos siguen accesibles,
  --   - sin_tokens=true mantiene la explicación de por qué está inactiva.
  -- Si el admin la reactiva, el alumno recupera este token; al gastarlo, el
  -- trigger la vuelve a cerrar sola.
  update membresia
  set tokens_usados = tokens_usados_actual - 1
  where id = membresia_id;

  return true;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4) BACKFILL OPCIONAL — commented out a propósito
--
-- Los alumnos que YA gastaron todos sus tokens pero todavía tienen días quedan
-- con estado=true: el trigger de arriba solo corre al agendar, así que nadie los
-- va a cerrar. Si querés alinearlos con la nueva regla, corré el SELECT de abajo
-- PRIMERO: cada fila que se cierre es un alumno que de golpe puede comprar otro
-- plan, y eso no es reversible por código.
--
-- Ejecutar el SELECT, revisar el número, y recién entonces descomentar el UPDATE.
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT count(*) AS cerrarian
--   FROM public.membresia
--  WHERE estado = true
--    AND NOT congelada
--    AND fecha_inicio <= now()
--    AND fecha_vencimiento > now()
--    AND tokens_usados >= tokens_totales;

-- UPDATE public.membresia
--    SET sin_tokens = true,
--        estado = false
--  WHERE estado = true
--    AND NOT congelada
--    AND fecha_inicio <= now()
--    AND fecha_vencimiento > now()
--    AND tokens_usados >= tokens_totales;
