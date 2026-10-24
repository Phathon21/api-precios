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

// 📁 GOOGLE SHEETS DE UNV (Pestañas Módulos Mecánico + Módulos)
const SHEET_ID = "17JDlUX3SjoUdT4diUt8FnuWwoACVPQwC"; 
const GIDS_PROVEEDOR = [
    { nombre: "MODULOS MECANICO", gid: "0" },
    { nombre: "MODULOS", gid: "1868161265" }
];

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
    if (p === "motorola") return ["motorola", "moto"];
    if (p === "xiaomi") return ["xiaomi", "redmi", "mi", "poco"];
    return [p];
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
            if (!res.ok) continue;
            const csvText = await res.text();

            await new Promise((resolve) => {
                Readable.from(csvText)
                    .pipe(csv({ headers: false }))
                    .on("data", row => {
                        const codigo = row[1] || "";
                        const descripcion = (row[2] || "").toString().trim();
                        const precioStr = row[3] || "0";

                        const precioLimpio = Number(String(precioStr).replace(/[^0-9]/g, ""));
                        const descUpper = descripcion.toUpperCase();

                        if (descripcion.length > 3 && precioLimpio > 0 && !descUpper.includes("PRECIO") && !descUpper.includes("MODULOS SM") && !descUpper.includes("PLACAS DE CARGAS")) {
                            
                            const norm = normalizar(descripcion);
                            const esOriginal = norm.includes("orig") || norm.includes("oled") || norm.includes("amoled");
                            const calidad = esOriginal ? "ORIGINAL" : "INCELL";

                            inventarioGlobal.push({
                                codigo: codigo,
                                descripcion: descripcion,
                                descripcionNorm: norm,
                                descripcionCompacta: norm.replace(/\s+/g, ""),
                                precioBase: precioLimpio,
                                calidad: calidad,
                                origen: pestaña.nombre
                            });
                        }
                    })
                    .on("end", resolve)
                    .on("error", () => resolve());
            });
        } catch (err) {
            console.error(`Error cargando pestaña ${pestaña.nombre}:`, err.message);
        }
    }

    cachedData = inventarioGlobal;
    lastFetch = ahora;
    console.log(`✅ Base de datos unificada cargada: ${inventarioGlobal.length} repuestos.`);
    return inventarioGlobal;
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/cotizar", async (req, res) => {
    try {
        const { consulta, tipoServicio } = req.body;
        const textoNorm = normalizar(consulta || "");
        const textoCompacto = textoNorm.replace(/\s+/g, "");
        const esIphone = textoNorm.includes("iphone") || textoNorm.includes("iph") || textoNorm.includes("apple");

        // ⚡ 1. PIN DE CARGA (PRECIO FIJO)
        if (tipoServicio === "pin") {
            const precio = esIphone ? 50000 : 30000;
            const modeloFormateado = consulta ? consulta.toUpperCase() : (esIphone ? "iPhone" : "Android");
            return res.json({
                tipo: "servicio_fijo",
                servicio: `Cambio de Pin de Carga (${modeloFormateado})`,
                precioFinal: precio
            });
        }

        // ⚡ 2. SERVICIOS FIJOS
        if (SERVICIOS_FIJOS[tipoServicio]) {
            return res.json({
                tipo: "servicio_fijo",
                servicio: SERVICIOS_FIJOS[tipoServicio].nombre,
                precioFinal: SERVICIOS_FIJOS[tipoServicio].precio
            });
        }

        // 📱 3. BÚSQUEDA EN CATÁLOGO
        const inventario = await cargarDatosSheets();
        const palabrasBuscadas = textoNorm.split(" ").filter(p => p.length > 0);

        const coincidencias = inventario.filter(item => {
            const desc = item.descripcionNorm;
            const descComp = item.descripcionCompacta;

            // 🚫 FILTRO SEGÚN LO SOLICITADO
            if (tipoServicio === "pantalla") {
                // Descartar si es placa de carga, lente o batería sola
                if (desc.includes("placa de carga") || desc.includes("pin de carga") || desc.includes("lente") || (desc.includes("bateria") && !desc.includes("modulo"))) {
                    return false;
                }
            } else if (tipoServicio === "bateria") {
                // Para baterías exigimos palabra clave de batería
                if (!desc.includes("bateria") && !desc.includes("pila") && !desc.includes("bat") && !desc.includes("eb-") && !desc.includes("bt-")) {
                    return false;
                }
            }

            // Coincidencia por términos o por texto compacto
            const coincideCompacto = descComp.includes(textoCompacto);
            const coincidePalabras = palabrasBuscadas.every(palabra => {
                const posiblesSinonimos = obtenerSinonimos(palabra);
                return posiblesSinonimos.some(sinonimo => desc.includes(sinonimo));
            });

            return coincidePalabras || coincideCompacto;
        });

        if (coincidencias.length === 0) {
            return res.json({ encontrado: false });
        }

        // BATERÍAS: Mostrar directamente
        if (tipoServicio === "bateria") {
            const baterias = coincidencias.slice(0, 6).map(item => ({
                codigo: item.codigo,
                repuesto: item.descripcion,
                precioCliente: calcularPrecio(item.precioBase, esIphone)
            }));
            return res.json({ encontrado: true, esBateria: true, baterias });
        }

        // MÓDULOS: Separar por calidad
        const originales = [];
        const incell = [];

        coincidencias.forEach(item => {
            const precioCliente = calcularPrecio(item.precioBase, esIphone);
            const objetoResultado = {
                codigo: item.codigo,
                repuesto: item.descripcion,
                precioCliente: precioCliente
            };

            if (item.calidad === "ORIGINAL") {
                originales.push(objetoResultado);
            } else {
                incell.push(objetoResultado);
            }
        });

        return res.json({
            encontrado: true,
            originales: originales.slice(0, 6),
            incell: incell.slice(0, 6)
        });

    } catch (error) {
        console.error("Error en cotización:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.get("/health", async (req, res) => {
    const datos = await cargarDatosSheets();
    res.json({ status: "OK", totalRepuestos: datos.length, ultimoUpdate: new Date(lastFetch) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en puerto ${PORT}`);
});
