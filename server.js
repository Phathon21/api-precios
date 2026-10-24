import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));

// 💳 COSTOS FLETES Y MANO DE OBRA
const COSTO_ENVIO = 12000;
const MO_ANDROID = 20000;
const MO_IPHONE = 50000;

// 🛠️ SERVICIOS CON PRECIO FIJO
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

const MI_SHEET_ID = "1cjS2vOdk9pTpAE4vyAKdTATSrSMklMOp8YFLLQzk8DY";

let cachedData = null;
let lastFetch = 0;
const CACHE_TTL = 10 * 60 * 1000;

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
    if (p === "samsung") return ["samsung", "sam", "sm"];
    if (p === "motorola") return ["motorola", "moto", "mt"];
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
    // iPhone: siempre ORIGINAL (no importa si dice incell)
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
        .replace(/\b(modulo|modulos|amp|ass|c|marco|con|sin|negro|blanco|azul|dorado|celeste|impo|ori|orig|original|mecanico|oled|amoled|incell|removible|ic|amm|hd|cb)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return limpio + "|" + item.calidad;
}

async function cargarDatosSheets() {
    const ahora = Date.now();
    if (cachedData && (ahora - lastFetch) < CACHE_TTL) {
        return cachedData;
    }

    let inventarioGlobal = [];

    for (const pestaña of GIDS_PROVEEDOR) {
        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${pestaña.gid}`;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`No se pudo cargar pestaña ${pestaña.nombre}: HTTP ${res.status}`);
                continue;
            }
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
                                origen: pestaña.nombre
                            });
                        }
                    })
                    .on("end", resolve)
                    .on("error", (err) => {
                        console.error(`Error parseando CSV de ${pestaña.nombre}:`, err.message);
                        resolve();
                    });
            });
        } catch (err) {
            console.error(`Error cargando pestaña ${pestaña.nombre}:`, err.message);
        }
    }

    cachedData = inventarioGlobal;
    lastFetch = ahora;
    console.log(`✅ Catálogo unificado cargado: ${inventarioGlobal.length} repuestos (solo con stock y precio).`);
    return inventarioGlobal;
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/cotizar", async (req, res) => {
    try {
        const { consulta, tipoServicio } = req.body;
        const textoNorm = normalizar(consulta || "");
        const esIphone =
            textoNorm.includes("iphone") ||
            textoNorm.includes("iph") ||
            textoNorm.includes("apple");

        if (tipoServicio === "pin") {
            const precio = esIphone ? 50000 : 30000;
            const modeloFormateado = consulta
                ? consulta.toUpperCase()
                : esIphone ? "iPhone" : "Android";
            return res.json({
                tipo: "servicio_fijo",
                servicio: `Cambio de Pin de Carga (${modeloFormateado})`,
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
                mensaje: "El proveedor ya no publica baterías en el catálogo automático. Pedí cotización manual o usá tu stock propio."
            });
        }

        const inventario = await cargarDatosSheets();
        const palabrasBuscadas = textoNorm.split(" ").filter(p => p.length > 0);

        if (palabrasBuscadas.length === 0) {
            return res.json({ encontrado: false });
        }

        let coincidencias = inventario.filter(item => {
            const desc = item.descripcionNorm;

            if (
                desc.includes("placa de carga") ||
                desc.includes("pin de carga") ||
                desc.includes("lente") ||
                desc.includes("bateria") ||
                desc.includes("flex de power")
            ) {
                return false;
            }

            return descripcionCoincide(desc, palabrasBuscadas);
        });

        if (coincidencias.length === 0) {
            return res.json({ encontrado: false });
        }

        coincidencias = coincidencias.map(item => ({
            ...item,
            calidad: detectarCalidad(item.descripcionNorm, esIphone)
        }));

        const mapa = new Map();
        for (const item of coincidencias) {
            const key = claveDedup(item);
            const actual = mapa.get(key);
            if (!actual || item.precioBase > actual.precioBase) {
                mapa.set(key, item);
            }
        }
        coincidencias = Array.from(mapa.values());

        const originales = [];
        const incell = [];

        coincidencias.forEach(item => {
            const precioCliente = calcularPrecio(item.precioBase, esIphone);
            if (precioCliente <= 0) return;

            const objeto = {
                codigo: item.codigo,
                repuesto: item.descripcion,
                precioCliente,
                precioBase: item.precioBase,
                stock: item.stock,
                origen: item.origen,
                calidad: item.calidad
            };

            if (item.calidad === "ORIGINAL") {
                originales.push(objeto);
            } else {
                incell.push(objeto);
            }
        });

        originales.sort((a, b) => a.precioCliente - b.precioCliente);
        incell.sort((a, b) => a.precioCliente - b.precioCliente);

        return res.json({
            encontrado: true,
            esIphone,
            originales: originales.slice(0, 10),
            incell: esIphone ? [] : incell.slice(0, 10)
        });
    } catch (error) {
        console.error("Error en cotización:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.get("/health", async (req, res) => {
    try {
        const datos = await cargarDatosSheets();
        res.json({
            status: "OK",
            totalRepuestos: datos.length,
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
