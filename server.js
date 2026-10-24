import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import {
    detectarCalidadUniversal,
    detectarMarcoUniversal,
    detectarRedUniversal,
    detectarMarcaDesdeConsulta,
    quitarRedDeConsulta,
    redExplicita,
    combinarRed,
    construirNombreVariante,
    claveVariante,
    redCoincide,
    esMarcaIphone,
    nombreModeloVisible
} from "./catalogo.js";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));

const COSTO_ENVIO = 12000;
const MO_ANDROID = 20000;
const MO_IPHONE = 50000;

const SERVICIOS_FIJOS = {
    frp: { nombre: "Eliminación Cuenta Google (FRP)", precio: 35000 },
    virus: { nombre: "Eliminación de Virus / Limpieza Celular", precio: 8000 },
    software_celular: { nombre: "Reinstalación / Cambio de Software Celular", precio: 25000 },
    windows: { nombre: "Formateo e Instalación de Windows (PC)", precio: 25000 },
    office: { nombre: "Instalación Paquete Office (PC)", precio: 15000 }
};

const SHEET_ID = "17JDlUX3SjoUdT4diUt8FnuWwoACVPQwC";
const GIDS_PROVEEDOR = [
    { nombre: "MODULOS MECANICO", gid: "785555649" },
    { nombre: "MODULOS", gid: "1766941416" }
];

// Nunca guardes credenciales de Procel en el repositorio.
const PROCEL_EMAIL = process.env.PROCEL_EMAIL || "";
const PROCEL_PASSWORD = process.env.PROCEL_PASSWORD || "";
const PROCEL_BASE = "https://www.procelcatamarca.com.ar";

const MI_SHEET_ID = "1cjS2vOdk9pTpAE4vyAKdTATSrSMklMOp8YFLLQzk8DY";

let cachedData = null;
let lastFetch = 0;
const CACHE_TTL = 10 * 60 * 1000;

let procelCookie = null;
let procelToken = null;
let procelLoginAt = 0;
const PROCEL_SESSION_TTL = 50 * 60 * 1000;
const COTIZACION_TTL = 24 * 60 * 60 * 1000;
const cotizacionesInternas = new Map();
const STOCK_API_URL = process.env.STOCK_API_URL || "";
const STOCK_API_TOKEN = process.env.STOCK_API_TOKEN || "";

function limpiarCotizacionesInternas() {
    const limite = Date.now() - COTIZACION_TTL;
    for (const [id, cotizacion] of cotizacionesInternas) {
        if (cotizacion.creadaEn < limite) cotizacionesInternas.delete(id);
    }
}

async function buscarStockPropio(consulta) {
    if (!STOCK_API_URL || !STOCK_API_TOKEN) return [];
    try {
        const respuesta = await fetch(STOCK_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                token: STOCK_API_TOKEN,
                accion: "buscar",
                consulta
            })
        });
        if (!respuesta.ok) return [];
        const datos = await respuesta.json();
        return Array.isArray(datos.items) ? datos.items : [];
    } catch (error) {
        console.error("Error consultando stock propio:", error.message);
        return [];
    }
}

function stockPropioCoincide(item, modelo, grupo) {
    const modeloStock = normalizar(item.modelo || "");
    const modeloBuscado = normalizar(modelo || "");
    if (!modeloStock || !(modeloStock.includes(modeloBuscado) || modeloBuscado.includes(modeloStock))) return false;

    const calidadStock = normalizar(item.calidad || "");
    const calidadValida = grupo.calidad === "PREMIUM"
        ? /premium|oled|amoled|orig|original|mecanico/.test(calidadStock)
        : /incell/.test(calidadStock);
    if (!calidadValida) return false;

    const marcoStock = normalizar(item.marco || "");
    const marcoValido = grupo.marco === "CON_MARCO"
        ? /con|c\/m|marco/.test(marcoStock) && !/sin/.test(marcoStock)
        : /sin|s\/m/.test(marcoStock);
    if (!marcoValido) return false;

    const redStock = normalizar(item.red || "");
    if (grupo.red === "4G" && redStock && !redStock.includes("4g")) return false;
    if (grupo.red === "5G" && redStock && !redStock.includes("5g")) return false;
    return true;
}

function cantidadStockPropio(items, modelo, grupo) {
    return items
        .filter(item => stockPropioCoincide(item, modelo, grupo))
        .reduce((total, item) => total + (Number(item.cantidad) || 0), 0);
}

function calcularPrecio(costoBase, esIphone = false) {
    const base = Number(String(costoBase).replace(/[^0-9]/g, ""));
    if (!base || base <= 0) return 0;
    const manoDeObra = esIphone ? MO_IPHONE : MO_ANDROID;
    return Math.round(((base + COSTO_ENVIO) * 2) + manoDeObra);
}

function normalizar(txt) {
    if (!txt) return "";
    return txt.toString().toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ");
}

function obtenerSinonimos(palabra) {
    const p = normalizar(palabra);
    if (p === "iphone" || p === "apple") return ["iphone", "iph", "apple", "ip"];
    if (p === "samsung") return ["samsung", "sam", "sm", "s"];
    if (p === "motorola") return ["motorola", "moto", "mt", "m"];
    if (p === "xiaomi") return ["xiaomi", "redmi", "mi", "poco", "xi"];
    if (p === "huawei") return ["huawei", "honor", "hw"];
    if (p === "lg") return ["lg"];
    if (p === "nokia") return ["nokia"];
    if (p === "tcl") return ["tcl"];
    if (p === "oppo") return ["oppo"];
    if (p === "realme") return ["realme"];
    if (p === "infinix") return ["infinix"];
    if (p === "tecno") return ["tecno"];
    if (p === "zte") return ["zte", "nubia"];
    return [p];
}

function detectarCalidad(norm, esIphone = false) {
    if (esIphone) return "ORIGINAL";
    if (norm.includes("incell")) return "INCELL";
    if (
        norm.includes("mecanico") ||
        norm.includes("oled") ||
        norm.includes("amoled") ||
        norm.includes("orig") ||
        norm.includes("original")
    ) {
        return "ORIGINAL";
    }
    return "INCELL";
}

function tokenCoincideModelo(token, modelo) {
    if (token === modelo) return true;
    const esCodigoModelo = /[a-z]+\d+$/i.test(modelo) || /^\d+$/.test(modelo);
    if (esCodigoModelo) {
        if (token === modelo) return true;
        if (token.startsWith(modelo)) {
            const resto = token.slice(modelo.length);
            if (resto.length > 0 && /^\d/.test(resto)) return false;
            return false;
        }
        return false;
    }
    return token.includes(modelo) || modelo.includes(token);
}

function descripcionCoincide(descNorm, palabrasBuscadas) {
    const tokens = descNorm.split(" ").filter(Boolean);
    return palabrasBuscadas.every(palabra => {
        const sinonimos = obtenerSinonimos(palabra);
        return sinonimos.some(sin => {
            if (tokens.some(t => tokenCoincideModelo(t, sin))) return true;
            const partes = descNorm.split(/[\s\/\-]+/);
            return partes.some(p => tokenCoincideModelo(p, sin));
        });
    });
}

function claveDedup(item) {
    const n = item.descripcionNorm;
    const limpio = n
        .replace(/\b(modulo|modulos|amp|ass|c|marco|con|sin|negro|blanco|azul|dorado|celeste|impo|ori|orig|original|mecanico|oled|amoled|incell|removible|ic|amm|hd|cb|vr)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return limpio + "|" + item.calidad + "|" + item.origen;
}

async function procelLogin() {
    if (!PROCEL_EMAIL || !PROCEL_PASSWORD) {
        console.warn("Procel no configurado: faltan PROCEL_EMAIL y PROCEL_PASSWORD.");
        return false;
    }

    const ahora = Date.now();
    if (procelCookie && procelToken && (ahora - procelLoginAt) < PROCEL_SESSION_TTL) {
        return true;
    }

    try {
        const res = await fetch(`${PROCEL_BASE}/api/auth/verify.php`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ email: PROCEL_EMAIL, password: PROCEL_PASSWORD })
        });

        const setCookie = res.headers.raw()["set-cookie"] || res.headers.get("set-cookie");
        let cookieStr = "";
        if (Array.isArray(setCookie)) {
            cookieStr = setCookie.map(c => c.split(";")[0]).join("; ");
        } else if (typeof setCookie === "string") {
            cookieStr = setCookie.split(",").map(c => c.split(";")[0].trim()).join("; ");
        }

        const data = await res.json();
        if (data.status !== "ok" || !data.token) {
            console.error("Procel login falló:", data);
            return false;
        }

        procelToken = data.token;
        procelCookie = cookieStr;
        procelLoginAt = ahora;
        console.log("✅ Sesión Procel iniciada");
        return true;
    } catch (err) {
        console.error("Error login Procel:", err.message);
        return false;
    }
}

async function buscarProcel(consulta, esIphone) {
    const ok = await procelLogin();
    if (!ok) return [];

    try {
        const q = encodeURIComponent(consulta);
        const res = await fetch(`${PROCEL_BASE}/api/productos.php?q=${q}&limit=30`, {
            headers: {
                Accept: "application/json",
                Cookie: procelCookie || "",
                Authorization: `Bearer ${procelToken}`
            }
        });

        const data = await res.json();
        if (data.status !== "ok" || !Array.isArray(data.productos)) return [];

        const palabrasBuscadas = normalizar(consulta).split(" ").filter(p => p.length > 0);
        const items = [];

        for (const p of data.productos) {
            const cat = (p.categoria_nombre || p.categoria_slug || "").toLowerCase();
            if (!cat.includes("modulo")) continue;

            const precio = Number(p.precio) || Number(p.pricing?.effective?.display) || 0;
            const stock = Math.floor(Number(p.stock) || 0);
            if (precio <= 0 || stock <= 0) continue;

            const descripcion = p.nombre || "";
            const norm = normalizar(descripcion);

            if (palabrasBuscadas.length > 0 && !descripcionCoincide(norm, palabrasBuscadas)) {
                continue;
            }

            items.push({
                codigo: p.sku || String(p.id),
                descripcion,
                descripcionNorm: norm,
                precioBase: precio,
                stock,
                calidad: detectarCalidad(norm, esIphone),
                origen: "PROCEL"
            });
        }

        return items;
    } catch (err) {
        console.error("Error buscando en Procel:", err.message);
        return [];
    }
}

async function cargarDatosUnv() {
    const ahora = Date.now();
    if (cachedData && (ahora - lastFetch) < CACHE_TTL) {
        return cachedData;
    }

    let inventarioGlobal = [];

    for (const pestaña of GIDS_PROVEEDOR) {
        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${pestaña.gid}`;
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const csvText = await res.text();

            await new Promise((resolve) => {
                Readable.from(csvText)
                    .pipe(csv({ headers: false }))
                    .on("data", row => {
                        const codigo = (row[1] || "").toString().trim();
                        const descripcion = (row[2] || "").toString().trim();
                        const precioStr = row[3] || "0";
                        const stockStr = row[4] || "0";

                        const precioLimpio = Number(String(precioStr).replace(/[^0-9]/g, ""));
                        const stock = Number(String(stockStr).replace(/[^0-9\-]/g, "")) || 0;
                        const descUpper = descripcion.toUpperCase();

                        if (
                            precioLimpio > 0 &&
                            stock > 0 &&
                            descripcion.length > 3 &&
                            !descUpper.includes("PLACAS DE CARGAS") &&
                            !descUpper.includes("PRECIO") &&
                            !descUpper.includes("UNIVERSCELL") &&
                            !descUpper.includes("CODIGO") &&
                            descUpper !== "MODULOS" &&
                            descUpper !== "SAMSUNG" &&
                            !descUpper.startsWith("COD,")
                        ) {
                            const norm = normalizar(descripcion);
                            inventarioGlobal.push({
                                codigo,
                                descripcion,
                                descripcionNorm: norm,
                                precioBase: precioLimpio,
                                stock,
                                origen: "UNV"
                            });
                        }
                    })
                    .on("end", resolve)
                    .on("error", () => resolve());
            });
        } catch (err) {
            console.error(`Error cargando UNV ${pestaña.nombre}:`, err.message);
        }
    }

    cachedData = inventarioGlobal;
    lastFetch = ahora;
    console.log(`✅ UNV cargado: ${inventarioGlobal.length} repuestos.`);
    return inventarioGlobal;
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/cotizar", async (req, res) => {
    try {
        const { consulta, tipoServicio } = req.body;
        const consultaOriginal = String(consulta || "").trim();
        const textoNorm = normalizar(consultaOriginal);
        const esIphone = esMarcaIphone(consultaOriginal);
        const redConsulta = redExplicita(consultaOriginal);
        const consultaModelo = quitarRedDeConsulta(consultaOriginal);
        const modeloVisible = nombreModeloVisible(consultaModelo || consultaOriginal);

        if (tipoServicio === "pin") {
            const precio = esIphone ? 50000 : 30000;
            return res.json({
                tipo: "servicio_fijo",
                servicio: `Cambio de Pin de Carga (${modeloVisible})`,
                precioFinal: precio
            });
        }

        if (SERVICIOS_FIJOS[tipoServicio]) {
            return res.json({
                tipo: "servicio_fijo",
                servicio: SERVICIOS_FIJOS[tipoServicio].nombre,
                precioFinal: SERVICIOS_FIJOS[tipoServicio].precio
            });
        }

        if (tipoServicio === "bateria") {
            return res.json({
                encontrado: false,
                mensaje: "El proveedor todavía no publica baterías en el catálogo automático. Te contactaremos para una cotización manual."
            });
        }

        if (!consultaModelo) {
            return res.json({ encontrado: false, mensaje: "Ingresá la marca y el modelo del celular." });
        }

        const [inventarioUnv, itemsProcel, stockPropio] = await Promise.all([
            cargarDatosUnv(),
            buscarProcel(consultaModelo, esIphone),
            buscarStockPropio(consultaModelo)
        ]);

        const palabrasBuscadas = normalizar(consultaModelo).split(" ").filter(Boolean);
        const coincidenciasUnv = inventarioUnv
            .filter(item => {
                const desc = item.descripcionNorm;
                if (
                    desc.includes("placa de carga") ||
                    desc.includes("pin de carga") ||
                    desc.includes("lente") ||
                    desc.includes("bateria") ||
                    desc.includes("flex de power")
                ) return false;
                return descripcionCoincide(desc, palabrasBuscadas);
            })
            .map(item => ({ ...item, origen: "UNV" }));

        let coincidencias = [...coincidenciasUnv, ...itemsProcel].map(item => ({
            ...item,
            calidadUniversal: detectarCalidadUniversal(item.descripcionNorm || item.descripcion, esIphone),
            marcoUniversal: detectarMarcoUniversal(item.descripcionNorm || item.descripcion),
            redUniversal: detectarRedUniversal(item.descripcionNorm || item.descripcion)
        }));

        if (coincidencias.length === 0) {
            return res.json({
                encontrado: false,
                mensaje: "No encontramos una oferta automática para ese modelo. Podemos cotizarlo manualmente."
            });
        }

        // Si el usuario no indicó 4G/5G y el catálogo tiene ambas variantes,
        // se pregunta antes de mostrar un precio potencialmente incompatible.
        if (!redConsulta) {
            const redes = new Set();
            coincidencias.forEach(item => {
                if (item.redUniversal === "4G" || item.redUniversal === "4G_5G") redes.add("4G");
                if (item.redUniversal === "5G" || item.redUniversal === "4G_5G") redes.add("5G");
            });
            if (redes.size > 1) {
                return res.json({
                    encontrado: false,
                    requiereRed: true,
                    modelo: modeloVisible,
                    opcionesRed: ["4G", "5G"],
                    mensaje: "Este modelo existe en versiones 4G y 5G. Elegí la versión de tu equipo para evitar pedir un módulo incompatible."
                });
            }
        }

        coincidencias = coincidencias.filter(item => redCoincide(redConsulta, item.redUniversal));
        const grupos = new Map();

        for (const item of coincidencias) {
            if (!["PREMIUM", "INCELL"].includes(item.calidadUniversal)) continue;
            const redFinal = combinarRed(redConsulta, item.redUniversal);
            const key = claveVariante(modeloVisible, item.calidadUniversal, item.marcoUniversal, redFinal);
            if (!grupos.has(key)) {
                grupos.set(key, {
                    calidad: item.calidadUniversal,
                    marco: item.marcoUniversal,
                    red: redFinal,
                    ofertas: []
                });
            }

            const grupo = grupos.get(key);
            const ofertaExistente = grupo.ofertas.find(oferta =>
                oferta.proveedor === item.origen && oferta.codigo === item.codigo
            );
            const oferta = {
                proveedor: item.origen,
                codigo: item.codigo,
                descripcionOriginal: item.descripcion,
                precioBase: Number(item.precioBase) || 0,
                stock: Number(item.stock) || 0
            };
            if (!ofertaExistente) grupo.ofertas.push(oferta);
            else if (oferta.precioBase < ofertaExistente.precioBase || oferta.stock > ofertaExistente.stock) {
                Object.assign(ofertaExistente, oferta);
            }
        }

        limpiarCotizacionesInternas();
        const premium = [];
        const incell = [];
        for (const grupo of grupos.values()) {
            const ofertasValidas = grupo.ofertas
                .filter(oferta => oferta.precioBase > 0 && oferta.stock > 0)
                .sort((a, b) => a.precioBase - b.precioBase);
            if (ofertasValidas.length === 0) continue;

            const elegida = ofertasValidas[0];
            const precioCliente = calcularPrecio(elegida.precioBase, esIphone);
            if (precioCliente <= 0) continue;

            const nombre = construirNombreVariante(modeloVisible, grupo.calidad, grupo.marco, grupo.red);
            const stockPropioCantidad = cantidadStockPropio(stockPropio, modeloVisible, grupo);
            const cotizacionId = randomUUID();
            cotizacionesInternas.set(cotizacionId, {
                creadaEn: Date.now(),
                modelo: modeloVisible,
                nombre,
                precioCliente,
                calidad: grupo.calidad,
                marco: grupo.marco,
                red: grupo.red,
                stockPropioCantidad,
                ofertas: ofertasValidas,
                proveedorRecomendado: elegida.proveedor
            });
            const objeto = {
                repuesto: nombre,
                nombre,
                cotizacionId,
                precioCliente,
                calidad: grupo.calidad,
                marco: grupo.marco,
                red: grupo.red,
                garantiaDias: grupo.calidad === "PREMIUM" ? 60 : 0,
                proveedoresDisponibles: ofertasValidas.length
            };

            // La comparación queda disponible en el backend para el futuro pedido
            // interno; no se envían precios de proveedores al navegador del cliente.
            objeto._detalleInterno = {
                ofertas: ofertasValidas,
                proveedorRecomendado: elegida.proveedor
            };

            if (grupo.calidad === "PREMIUM") premium.push(objeto);
            else incell.push(objeto);
        }

        premium.sort((a, b) => a.precioCliente - b.precioCliente);
        incell.sort((a, b) => a.precioCliente - b.precioCliente);

        if (premium.length === 0 && incell.length === 0) {
            return res.json({
                encontrado: false,
                mensaje: "Encontramos referencias, pero ninguna tiene calidad o disponibilidad confirmada. Podemos cotizarlo manualmente."
            });
        }

        // Se elimina el detalle interno antes de responder al cliente.
        const limpiarRespuesta = items => items.map(({ _detalleInterno, ...publico }) => publico);
        return res.json({
            encontrado: true,
            esIphone,
            modelo: modeloVisible,
            premium: limpiarRespuesta(premium).slice(0, 12),
            originales: limpiarRespuesta(premium).slice(0, 12),
            incell: esIphone ? [] : limpiarRespuesta(incell).slice(0, 12)
        });
    } catch (error) {
        console.error("Error en cotización:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post("/api/pedidos", (req, res) => {
    try {
        limpiarCotizacionesInternas();
        const { nombre, pago, items } = req.body || {};
        if (!nombre || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "Faltan nombre o reparaciones." });
        }

        const pedidoId = randomUUID();
        const detalleInterno = items.map(item => {
            const cotizacion = item.cotizacionId ? cotizacionesInternas.get(item.cotizacionId) : null;
            return {
                nombre: cotizacion?.nombre || item.repuesto || "Servicio manual",
                precioCliente: cotizacion?.precioCliente || Number(item.precio) || 0,
                calidad: cotizacion?.calidad || item.calidad || "",
                marco: cotizacion?.marco || item.marco || "",
                red: cotizacion?.red || item.red || "",
                stockPropioCantidad: cotizacion?.stockPropioCantidad || 0,
                ofertas: cotizacion?.ofertas || [],
                proveedorRecomendado: cotizacion?.proveedorRecomendado || ""
            };
        });

        // Por ahora se registra en los logs de Render. En la siguiente etapa,
        // este mismo objeto se enviará automáticamente al grupo interno.
        console.log("NUEVO PEDIDO INTERNO", JSON.stringify({
            pedidoId,
            nombre,
            pago: pago || "No informado",
            items: detalleInterno
        }));

        return res.json({ ok: true, pedidoId });
    } catch (error) {
        console.error("Error registrando pedido:", error);
        return res.status(500).json({ error: "No se pudo registrar el pedido." });
    }
});

app.get("/health", async (req, res) => {
    try {
        const datos = await cargarDatosUnv();
        const procelOk = await procelLogin();
        res.json({
            status: "OK",
            unv: datos.length,
            procel: procelOk ? "conectado" : "error",
            ultimoUpdate: new Date(lastFetch).toISOString()
        });
    } catch (err) {
        res.status(500).json({ status: "ERROR", message: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en puerto ${PORT}`);
});
