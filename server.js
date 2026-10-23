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

// Servir archivos de la raíz (index.html, logo.jpg, etc.)
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

// 📁 GOOGLE SHEETS DE UNV (Pestañas configuradas)
const SHEET_ID = "17JDlUX3SjoUdT4diUt8FnuWwoACVPQwC"; 
const GIDS_PROVEEDOR = [
    { nombre: "MODULOS", gid: "1868161265" },
    { nombre: "PLACAS Y LENTES", gid: "785555649" }
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

// 📥 DESCARGAR DATOS LEYENDO COLUMNAS POR POSICIÓN (B, C, D)
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
                    .pipe(csv({ headers: false })) // Se lee sin nombres de columnas predefinidos
                    .on("data", row => {
                        // Posición física: Col B (row[1]), Col C (row[2]), Col D (row[3])
                        const codigo = row[1] || "";
                        const descripcion = row[2] || "";
                        const precioStr = row[3] || "0";

                        const precioLimpio = Number(String(precioStr).replace(/[^0-9]/g, ""));

                        // Descartar encabezados o filas vacías
                        if (descripcion.length > 3 && precioLimpio > 500 && !descripcion.includes("PLACAS DE CARGAS") && !descripcion.includes("MODULOS")) {
                            inventarioGlobal.push({
                                codigo: codigo,
                                descripcion: descripcion.trim(),
                                descripcionNorm: normalizar(descripcion),
                                precioBase: precioLimpio,
                                categoria: pestaña.nombre
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
    console.log(`✅ Base de datos actualizada: ${inventarioGlobal.length} repuestos cargados.`);
    return inventarioGlobal;
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/cotizar", async (req, res) => {
    try {
        const { consulta, tipoServicio } = req.body;
        const textoNorm = normalizar(consulta);
        const esIphone = textoNorm.includes("iphone") || textoNorm.includes("apple");

        // Pin de Carga
        if (tipoServicio === "pin_carga" || textoNorm.includes("pin")) {
            const precio = esIphone ? 50000 : 30000;
            return res.json({
                tipo: "servicio_fijo",
                servicio: `Cambio de Pin de Carga (${esIphone ? "iPhone" : "Android"})`,
                precioFinal: precio
            });
        }

        // Servicios Fijos (FRP, Windows, Office, etc.)
        if (SERVICIOS_FIJOS[tipoServicio]) {
            return res.json({
                tipo: "servicio_fijo",
                servicio: SERVICIOS_FIJOS[tipoServicio].nombre,
                precioFinal: SERVICIOS_FIJOS[tipoServicio].precio
            });
        }

        // Búsqueda de Módulos / Pantallas
        const inventario = await cargarDatosSheets();
        const palabrasClave = textoNorm.split(" ").filter(p => p.length > 0);

        const coincidencias = inventario.filter(item => {
            return palabrasClave.every(palabra => item.descripcionNorm.includes(palabra));
        });

        if (coincidencias.length === 0) {
            return res.json({
                encontrado: false,
                mensaje: "No se encontró el repuesto en el catálogo automático."
            });
        }

        const resultados = coincidencias.slice(0, 6).map(item => {
            const precioCliente = calcularPrecio(item.precioBase, esIphone);
            return {
                codigo: item.codigo,
                repuesto: item.descripcion,
                costoBase: item.precioBase,
                precioCliente: precioCliente,
                categoria: item.categoria
            };
        });

        return res.json({
            encontrado: true,
            resultados: resultados
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
    console.log(`🚀 Servidor de Taller listo en puerto ${PORT}`);
});
