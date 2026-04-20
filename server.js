import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

// 📁 CONFIGURACIÓN DE FUENTE DE DATOS
// Opción A: Usar archivo CSV local (RECOMENDADO para producción)
const CSV_LOCAL_PATH = path.join(process.cwd(), "repuestos_catamarca.csv");

// Opción B: Google Sheets (necesita formato de exportación CSV)
const SHEET_ID = "1VoARNjyEyEjI_MRtdtfsj-7ztHshQYcOXYQhPNS2S14";
const GID = "942358472";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

// 🔄 CACHE DE DATOS (evita fetch en cada request)
let cachedData = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// 💰 LÓGICA DE PRECIOS (Ajustada a tu margen)
function calcularPrecio(base, marca, parte) {
    base = Number(base);
    if (!base || base <= 0) return null;

    const esIphone = (marca || "").toLowerCase().includes("apple") || (marca || "").toLowerCase().includes("iphone");
    const esPantalla = (parte || "").toLowerCase().includes("modulo");
    
    // Margen diferenciado: pantallas más caro que baterías
    const margenBase = esIphone ? 10000 : 8000;
    const gananciaFija = esPantalla ? (esIphone ? 50000 : 20000) : (esIphone ? 25000 : 12000);
    
    return Math.round((base + margenBase) * 2 + gananciaFija);
}

// 🧼 LIMPIAR TEXTO PARA COMPARACIÓN
function normalizar(txt) {
    return (txt || "").toString().toLowerCase().trim().replace(/[^a-z0-9]/g, "");
}

// 🔍 EXTRAER MODELO + TIPO DE REPUESTO DEL MENSAJE
function parsearConsulta(mensaje) {
    const limpio = mensaje.toLowerCase();
    let tipoRepuesto = "modulo"; // default: pantalla
    
    // Detectar si pide batería
    if (limpio.includes("bater") || limpio.includes("pila") || limpio.includes("carga")) {
        tipoRepuesto = "batería";
    }
    
    // Detectar iPhone
    if (limpio.includes("iphone") || limpio.includes("iph")) {
        const num = limpio.match(/(?:iphone\s*)?(\d+[a-z]?)/i);
        const modelo = num ? "iphone" + num[1].toLowerCase() : null;
        return { modelo, tipoRepuesto, marca: "Apple" };
    }

    // Detectar Samsung (A04s, S21, J7, etc)
    const samsungMatch = limpio.match(/\b([asjmn]\d{1,3}[a-z]?(?:\s*pro|plus|fe|ultra)?)/i);
    if (samsungMatch) {
        return { modelo: samsungMatch[1].toLowerCase().replace(/\s+/g, ""), tipoRepuesto, marca: "Samsung" };
    }

    // Detectar Motorola (G52, E20, Edge, etc)
    const motoMatch = limpio.match(/\b(?:moto\s*)?([egx]\d{1,3}[a-z]?|edge\d*|razr)/i);
    if (motoMatch) {
        return { modelo: motoMatch[1].toLowerCase().replace(/\s+/g, ""), tipoRepuesto, marca: "Motorola" };
    }

    // Detectar Xiaomi (Redmi Note 11, Poco X3, Mi 11, etc)
    const xiaomiMatch = limpio.match(/\b(?:redmi\s*|poco\s*|mi\s*)?(note\s*\d+[a-z]?|\d{1,3}[a-z]?)/i);
    if (xiaomiMatch) {
        let modelo = xiaomiMatch[0].toLowerCase().replace(/\s+/g, "");
        // Normalizar nombres comunes
        modelo = modelo.replace(/^(redmi|poco|mi)/, "");
        return { modelo, tipoRepuesto, marca: "Xiaomi" };
    }

    // Fallback: intentar extraer cualquier patrón alfanumérico corto
    const fallback = limpio.match(/\b([a-z]{1,3}\d{1,3}[a-z]?)\b/i);
    return { modelo: fallback ? fallback[1].toLowerCase() : null, tipoRepuesto, marca: null };
}

// 📥 CARGAR DATOS (CSV local o Google Sheets con cache)
async function cargarDatos() {
    const ahora = Date.now();
    
    // Retornar cache si está vigente
    if (cachedData && (ahora - lastFetch) < CACHE_TTL) {
        return cachedData;
    }

    let csvText = "";
    
    // Priorizar archivo local si existe
    if (fs.existsSync(CSV_LOCAL_PATH)) {
        csvText = fs.readFileSync(CSV_LOCAL_PATH, "utf-8");
    } else {
        // Fallback a Google Sheets
        const res = await fetch(SHEET_CSV_URL);
        if (!res.ok) throw new Error("No se pudo cargar la hoja de cálculo");
        csvText = await res.text();
    }

    // Parsear CSV
    const datos = [];
    await new Promise((resolve, reject) => {
        Readable.from(csvText)
            .pipe(csv())
            .on("data", row => {
                // Validar que tenga las columnas esperadas
                if (row.Modelo && row.PrecioBase) {
                    datos.push({
                        ...row,
                        PrecioBase: String(row.PrecioBase).replace(/[^0-9]/g, ""), // asegurar número limpio
                        Modelo: normalizar(row.Modelo),
                        Marca: normalizar(row.Marca),
                        Parte: normalizar(row.Parte),
                        Calidad: normalizar(row.Calidad),
                        Variante: normalizar(row.Variante)
                    });
                }
            })
            .on("end", resolve)
            .on("error", reject);
    });

    cachedData = datos;
    lastFetch = ahora;
    console.log(`📦 Datos cargados: ${datos.length} registros`);
    return datos;
}

// 🎯 FILTRAR RESULTADOS POR MODELO, MARCA Y TIPO DE REPUESTO
function buscarRepuestos(datos, { modelo, tipoRepuesto, marca }) {
    if (!modelo) return [];
    
    const modeloNorm = normalizar(modelo);
    const parteNorm = normalizar(tipoRepuesto);
    const marcaNorm = marca ? normalizar(marca) : null;
    
    return datos.filter(item => {
        // Matching exacto o contenido del modelo
        const matchModelo = item.Modelo === modeloNorm || item.Modelo.includes(modeloNorm);
        
        // Matching de parte (modulo/pantalla vs batería)
        const matchParte = parteNorm === "batería" 
            ? item.Parte?.includes("bater") 
            : item.Parte?.includes("modulo") || item.Parte?.includes("pantall");
        
        // Matching opcional de marca si se detectó
        const matchMarca = !marcaNorm || item.Marca?.includes(marcaNorm);
        
        return matchModelo && matchParte && matchMarca;
    });
}

// 🚀 ENDPOINT PRINCIPAL
app.post("/precio", async (req, res) => {
    try {
        const mensaje = req.body.message || req.body.texto || "";
        
        // --- RESPUESTAS DE SERVICIOS FIJOS ---
        if (mensaje.toLowerCase().match(/pin\s*de\s*carga|no\s*carga|conector\s*carga/)) {
            return res.json({ 
                respuesta: "🔌 *Cambio de Pin de Carga*\n💰 Precio estimado: $30.000 a $45.000\n\n(Depende del modelo exacto). Traelo al local para confirmar. 😉" 
            });
        }
        
        if (mensaje.toLowerCase().match(/cuenta\s*google|frp|bloqueado|patron|huella/)) {
            return res.json({ 
                respuesta: "🔐 *Desbloqueo de Cuenta Google (FRP)*\n💰 Precio: Desde $15.000\n⏳ Tiempo: 1 a 3 horas.\n\nTraelo cuando quieras. 😉" 
            });
        }

        if (mensaje.toLowerCase().match(/formateo|windows|lenta|pc|notebook/)) {
            return res.json({ 
                respuesta: "💻 *Servicio técnico PC/Notebook*\n• Formateo + Windows + Programas: $25.000\n• Limpieza física: $15.000\n\n¡Queda como nueva! 🚀" 
            });
        }

        // Parsear consulta del usuario
        const consulta = parsearConsulta(mensaje);
        
        if (!consulta.modelo) {
            return res.json({ 
                respuesta: "👋 ¡Hola! Soy el asistente técnico de EInformática.\n\nPor favor, decime el *modelo exacto* para darte el precio:\n• Ej: `A04s`, `Moto G52`, `iPhone 13`\n• Especificá si es *pantalla* o *batería* 🔋" 
            });
        }

        // Cargar datos (con cache)
        const datos = await cargarDatos();
        
        // Buscar coincidencias
        const resultados = buscarRepuestos(datos, consulta);

        if (resultados.length === 0) {
            const sugerencia = consulta.marca ? `${consulta.marca} ${consulta.modelo}` : consulta.modelo;
            return res.json({ 
                respuesta: `❌ No encontré *${consulta.tipoRepuesto === "batería" ? "batería" : "pantalla"}* para *${sugerencia.toUpperCase()}*.\n\n📩 Un *técnico* va a revisar stock manualmente y te contesta en un toque. 😉` 
            });
        }

        // Agrupar por calidad/variante para mostrar opciones
        const opciones = {};
        resultados.forEach(item => {
            const key = `${item.Calidad || "Estándar"}-${item.Variante || ""}`.trim();
            if (!opciones[key]) opciones[key] = [];
            opciones[key].push(item);
        });

        const nombreReal = resultados[0].NombreMostrar || `${resultados[0].Marca} ${consulta.modelo}`;
        const tipoTexto = consulta.tipoRepuesto === "batería" ? "🔋 Batería" : "🖥️ Pantalla";
        
        let respuesta = `${tipoTexto} para *${nombreReal}*\n\n`;
        let hayPrecios = false;

        Object.entries(opciones).forEach(([calidadVariante, items]) => {
            // Usar el primer ítem para calcular precio (asumimos mismo PrecioBase por variante)
            const primerItem = items[0];
            const precio = calcularPrecio(primerItem.PrecioBase, primerItem.Marca, primerItem.Parte);
            
            if (precio) {
                hayPrecios = true;
                const [calidad, variante] = calidadVariante.split("-");
                const varianteTxt = variante ? `(${variante})` : "";
                respuesta += `🔹 ${calidad} ${varianteTxt} → *$${precio.toLocaleString('es-AR')}*\n`;
            }
        });

        if (!hayPrecios) {
            return res.json({ 
                respuesta: `⚠️ Tenemos *${nombreReal}* pero el precio requiere confirmación.\n\n📩 Escribinos y te pasamos el valor exacto al toque.` 
            });
        }

        respuesta += `\n✅ *Precios finales con colocación incluida.*\n📍 Retiro en local o envío a coordinar.\n\n¿Te gustaría que encarguemos el repuesto?`;

        return res.json({ respuesta, debug: { modelo: consulta.modelo, encontrados: resultados.length } });

    } catch (error) {
        console.error("❌ Error en /precio:", error.message);
        return res.json({ 
            respuesta: "⚠️ Tuvimos un inconveniente técnico.\n\n📩 Un humano va a revisar tu consulta y te responde en breve. ¡Gracias por la paciencia! 😉" 
        });
    }
});

// 🩺 HEALTH CHECK
app.get("/health", (req, res) => {
    res.json({ 
        status: "ok", 
        cache: !!cachedData, 
        registros: cachedData?.length || 0,
        ttl: CACHE_TTL 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API de Precios EInformática lista en puerto ${PORT}`);
    console.log(`📁 CSV local: ${fs.existsSync(CSV_LOCAL_PATH) ? "✅" : "❌"} ${CSV_LOCAL_PATH}`);
});
