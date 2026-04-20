import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

// 📁 CONFIGURACIÓN DE FUENTE DE DATOS
const CSV_LOCAL_PATH = path.join(process.cwd(), "repuestos_catamarca.csv");
const SHEET_ID = "1VoARNjyEyEjI_MRtdtfsj-7ztHshQYcOXYQhPNS2S14";
const GID = "942358472";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

// 🔄 CACHE
let cachedData = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000;

// 💰 SERVICIOS FIJOS CON PRECIOS EXACTOS (ACTUALIZADO)
const SERVICIOS_FIJOS = {
    pinAndroid: { nombre: "Cambio de Pin de Carga (Android)", precio: 30000 },
    pinIphone: { nombre: "Cambio de Pin de Carga (iPhone)", precio: 70000 },
    frp: { nombre: "Eliminación Cuenta Google (FRP)", precio: 35000 },
    windows: { nombre: "Instalación de Windows + Programas", precio: 25000 },
    windowsOffice: { nombre: "Windows + Office + Programas a elección", precio: 30000 },
    mantenimiento: { nombre: "Mantenimiento de PC (Limpieza física + software)", precio: 15000 },
    virus: { nombre: "Eliminación de Virus Publicitario", precio: 7000 }
};

// 💰 LÓGICA DE PRECIOS PARA REPUESTOS
function calcularPrecio(base, marca, parte) {
    base = Number(base);
    if (!base || base <= 0) return null;

    const esIphone = (marca || "").toLowerCase().includes("apple") || (marca || "").toLowerCase().includes("iphone");
    const esPantalla = (parte || "").toLowerCase().includes("modulo");
    
    const margenBase = esIphone ? 10000 : 8000;
    const gananciaFija = esPantalla 
        ? (esIphone ? 50000 : 20000) 
        : (esIphone ? 25000 : 12000);
    
    return Math.round((base + margenBase) * 2 + gananciaFija);
}

// 🧼 NORMALIZAR TEXTO
function normalizar(txt) {
    return (txt || "").toString().toLowerCase().trim().replace(/[^a-z0-9]/g, "");
}

// 🔍 DETECTAR TIPO DE REPUESTO: batería vs pantalla
function detectarTipoRepuesto(texto) {
    const t = texto.toLowerCase();
    if (t.includes("bater") || t.includes("pila") || (t.includes("carga") && !t.includes("pin"))) {
        return "bateria";
    }
    if (t.includes("pantall") || t.includes("modulo") || t.includes("display") || t.includes("lcd") || t.includes("cambiar pantalla")) {
        return "pantalla";
    }
    return null; // No especificado → default pantalla
}

// 🔍 EXTRAER MODELO + MARCA
function parsearConsulta(mensaje) {
    const limpio = mensaje.toLowerCase();
    const tipoRepuesto = detectarTipoRepuesto(mensaje);
    
    // iPhone
    if (limpio.includes("iphone") || limpio.includes("iph")) {
        const num = limpio.match(/(?:iphone\s*)?(\d+[a-z]?)/i);
        return { 
            modelo: num ? "iphone" + num[1].toLowerCase() : null, 
            tipoRepuesto: tipoRepuesto || "pantalla", 
            marca: "Apple" 
        };
    }

    // Samsung
    const samsungMatch = limpio.match(/\b([asjmn]\d{1,3}[a-z]?(?:\s*pro|plus|fe|ultra)?)/i);
    if (samsungMatch) {
        return { 
            modelo: samsungMatch[1].toLowerCase().replace(/\s+/g, ""), 
            tipoRepuesto: tipoRepuesto || "pantalla", 
            marca: "Samsung" 
        };
    }

    // Motorola
    const motoMatch = limpio.match(/\b(?:moto\s*)?([egx]\d{1,3}[a-z]?|edge\d*|razr)/i);
    if (motoMatch) {
        return { 
            modelo: motoMatch[1].toLowerCase().replace(/\s+/g, ""), 
            tipoRepuesto: tipoRepuesto || "pantalla", 
            marca: "Motorola" 
        };
    }

    // Xiaomi
    const xiaomiMatch = limpio.match(/\b(?:redmi\s*|poco\s*|mi\s*)?(note\s*\d+[a-z]?|\d{1,3}[a-z]?)/i);
    if (xiaomiMatch) {
        let modelo = xiaomiMatch[0].toLowerCase().replace(/\s+/g, "").replace(/^(redmi|poco|mi)/, "");
        return { modelo, tipoRepuesto: tipoRepuesto || "pantalla", marca: "Xiaomi" };
    }

    const fallback = limpio.match(/\b([a-z]{1,3}\d{1,3}[a-z]?)\b/i);
    return { 
        modelo: fallback ? fallback[1].toLowerCase() : null, 
        tipoRepuesto: tipoRepuesto || "pantalla", 
        marca: null 
    };
}

// 📥 CARGAR DATOS
async function cargarDatos() {
    const ahora = Date.now();
    if (cachedData && (ahora - lastFetch) < CACHE_TTL) return cachedData;

    let csvText = "";
    if (fs.existsSync(CSV_LOCAL_PATH)) {
        csvText = fs.readFileSync(CSV_LOCAL_PATH, "utf-8");
    } else {
        const res = await fetch(SHEET_CSV_URL);
        if (!res.ok) throw new Error("No se pudo cargar la hoja de cálculo");
        csvText = await res.text();
    }

    const datos = [];
    await new Promise((resolve, reject) => {
        Readable.from(csvText)
            .pipe(csv())
            .on("data", row => {
                if (row.Modelo && row.PrecioBase) {
                    datos.push({
                        ...row,
                        PrecioBase: String(row.PrecioBase).replace(/[^0-9]/g, ""),
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

// 🎯 FILTRAR RESULTADOS
function buscarRepuestos(datos, { modelo, tipoRepuesto, marca }) {
    if (!modelo) return [];
    
    const modeloNorm = normalizar(modelo);
    const parteNorm = normalizar(tipoRepuesto);
    const marcaNorm = marca ? normalizar(marca) : null;
    
    return datos.filter(item => {
        const matchModelo = item.Modelo === modeloNorm || item.Modelo.includes(modeloNorm);
        
        const matchParte = parteNorm === "bateria" 
            ? item.Parte?.includes("bater") 
            : item.Parte?.includes("modulo") || item.Parte?.includes("pantall");
        
        const matchMarca = !marcaNorm || item.Marca?.includes(marcaNorm);
        
        return matchModelo && matchParte && matchMarca;
    });
}

// 🔍 DETECTAR SERVICIO FIJO
function detectarServicioFijo(texto) {
    const t = texto.toLowerCase();
    
    // Pin de carga
    if (t.includes("pin") && t.includes("carga")) {
        return t.includes("iphone") || t.includes("iph") ? "pinIphone" : "pinAndroid";
    }
    // FRP
    if (t.includes("frp") || t.includes("cuenta google") || t.includes("bloqueado") || t.includes("patrón") || t.includes("patron")) {
        return "frp";
    }
    // Windows
    if (t.includes("windows") || t.includes("formateo") || t.includes("instalar windows")) {
        return t.includes("office") || t.includes("programa") ? "windowsOffice" : "windows";
    }
    // Mantenimiento PC
    if ((t.includes("mantenim") || t.includes("limpieza")) && (t.includes("pc") || t.includes("notebook") || t.includes("computadora"))) {
        return "mantenimiento";
    }
    // Virus
    if (t.includes("virus") || t.includes("publicitario") || t.includes("spam") || t.includes("ventana emergente")) {
        return "virus";
    }
    return null;
}

// 🚀 ENDPOINT PRINCIPAL
app.post("/precio", async (req, res) => {
    try {
        const mensaje = req.body.message || req.body.texto || "";
        const textoLimpio = mensaje.toLowerCase().trim();

        // ========================================
        // 🛠️ CASO 1: SERVICIOS FIJOS (con precios exactos)
        // ========================================
        const servicio = detectarServicioFijo(mensaje);
        if (servicio) {
            const s = SERVICIOS_FIJOS[servicio];
            return res.json({ 
                respuesta: `🔧 *${s.nombre}*\n\n💰 Precio: *$${s.precio.toLocaleString('es-AR')}*\n\n✅ Incluye mano de obra y garantía.\n📍 Retiro en local o coordinamos envío.\n\n¿Te gustaría agendar un turno?` 
            });
        }

        // ========================================
        // 🔋 CASO 2: BATERÍA → PRECIO DIRECTO (sin preguntar calidad)
        // ========================================
        const consulta = parsearConsulta(mensaje);
        
        if (consulta.modelo && consulta.tipoRepuesto === "bateria") {
            const datos = await cargarDatos();
            const resultados = buscarRepuestos(datos, consulta);
            
            if (resultados.length > 0) {
                const item = resultados[0];
                const precio = calcularPrecio(item.PrecioBase, item.Marca, item.Parte);
                const nombreReal = item.NombreMostrar || `${item.Marca} ${consulta.modelo}`;
                
                return res.json({
                    respuesta: `🔋 *Batería para ${nombreReal}*\n\n💰 Precio: *$${precio.toLocaleString('es-AR')}* (Original con colocación)\n\n⚠️ El precio puede variar según stock. ¿Confirmás que querés este repuesto?\n\n1. ✅ Sí, quiero reservar\n2. ❌ No, era otra consulta`,
                    tipo: "bateria_confirmacion",
                    modelo: consulta.modelo,
                    precio: precio
                });
            }
        }

        // ========================================
        // 🖥️ CASO 3: PANTALLA/MÓDULO → PREGUNTAR CALIDAD
        // ========================================
        if (consulta.modelo && (consulta.tipoRepuesto === "pantalla" || !consulta.tipoRepuesto)) {
            const datos = await cargarDatos();
            const resultados = buscarRepuestos(datos, consulta);
            
            if (resultados.length > 0) {
                // Agrupar por calidad para mostrar opciones
                const opciones = {};
                resultados.forEach(item => {
                    const key = item.Calidad || "Estándar";
                    if (!opciones[key]) opciones[key] = [];
                    opciones[key].push(item);
                });
                
                const nombreReal = resultados[0].NombreMostrar || `${resultados[0].Marca} ${consulta.modelo}`;
                let respuesta = `📱 *Pantalla para ${nombreReal}*\n\n¿Qué calidad buscás?\n\n`;
                
                let idx = 1;
                for (const [calidad, items] of Object.entries(opciones)) {
                    const precio = calcularPrecio(items[0].PrecioBase, items[0].Marca, items[0].Parte);
                    if (precio) {
                        respuesta += `${idx}. *${calidad}* - Desde $${precio.toLocaleString('es-AR')}\n`;
                        idx++;
                    }
                }
                
                respuesta += `\n*(Escribí el nombre o el número)*`;
                
                return res.json({
                    respuesta: respuesta,
                    tipo: "pantalla_calidad",
                    modelo: consulta.modelo,
                    opciones: Object.keys(opciones)
                });
            }
        }

        // ========================================
        // ❓ CASO 4: SALUDO GENÉRICO o SIN MODELO DETECTADO
        // ========================================
        if (!consulta.modelo || textoLimpio.match(/^(hola|buenas|buenos|hello|hi|epa)$/)) {
            return res.json({ 
                respuesta: `👋 ¡Hola! Soy el asistente técnico de *EAInformatica*.\n\nContame: ¿Qué modelo de equipo tenés?` 
            });
        }

        // ========================================
        // ❌ CASO 5: NO ENCONTRADO
        // ========================================
        return res.json({ 
            respuesta: `❌ No encontré información para *${consulta.modelo?.toUpperCase() || "ese modelo"}*.\n\n📩 Un *técnico* va a revisar manualmente y te contesta en un toque. 😉` 
        });

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
    console.log(`🚀 API de Precios EAInformatica lista en puerto ${PORT}`);
    console.log(`📁 CSV local: ${fs.existsSync(CSV_LOCAL_PATH) ? "✅" : "❌"} ${CSV_LOCAL_PATH}`);
});
