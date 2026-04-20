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

// 💰 LÓGICA DE PRECIOS - SIEMPRE DEVUELVE NÚMERO VÁLIDO
function calcularPrecio(base, marca, parte) {
    base = Number(String(base).replace(/[^0-9]/g, ""));
    if (!base || base <= 0) return 0; // ← Siempre retorna número, nunca null

    const esIphone = (marca || "").toLowerCase().includes("apple") || (marca || "").toLowerCase().includes("iphone");
    const esPantalla = (parte || "").toLowerCase().includes("modulo");
    
    const margenBase = esIphone ? 10000 : 8000;
    const gananciaFija = esPantalla 
        ? (esIphone ? 50000 : 20000) 
        : (esIphone ? 25000 : 12000);
    
    return Math.round((base + margenBase) * 2 + gananciaFija);
}

// 🧼 NORMALIZAR TEXTO (para comparaciones)
function normalizar(txt) {
    if (!txt) return "";
    return txt.toString().toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
        .replace(/[^\w\s]/g, "") // quita símbolos
        .replace(/\s+/g, " "); // unifica espacios
}

// 🔍 DETECTAR TIPO DE REPUESTO: batería, pantalla, o AMBOS
function detectarTipoRepuesto(texto) {
    const t = normalizar(texto);
    const tieneBateria = /\bbater|pila|cambiar bateria|cambio bateria/.test(t);
    const tienePantalla = /\bpantall|modulo|display|lcd|cambiar pantalla|cambio pantalla/.test(t);
    
    if (tieneBateria && tienePantalla) return "ambos"; // ← NUEVO: detecta ambos
    if (tieneBateria) return "bateria";
    if (tienePantalla) return "pantalla";
    return null;
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
            tipoRepuesto, 
            marca: "Apple" 
        };
    }

    // Samsung
    const samsungMatch = limpio.match(/\b([asjmn]\d{1,3}[a-z]?(?:\s*(?:pro|plus|fe|ultra|core|s))?)/i);
    if (samsungMatch) {
        return { 
            modelo: samsungMatch[1].toLowerCase().replace(/\s+/g, ""), 
            tipoRepuesto, 
            marca: "Samsung" 
        };
    }

    // Motorola
    const motoMatch = limpio.match(/\b(?:moto\s*)?([egx]\d{1,3}[a-z]?|edge\d*|razr)/i);
    if (motoMatch) {
        return { 
            modelo: motoMatch[1].toLowerCase().replace(/\s+/g, ""), 
            tipoRepuesto, 
            marca: "Motorola" 
        };
    }

    // Xiaomi
    const xiaomiMatch = limpio.match(/\b(?:redmi\s*|poco\s*|mi\s*)?(note\s*\d+[a-z]?|\d{1,3}[a-z]?)/i);
    if (xiaomiMatch) {
        let modelo = xiaomiMatch[0].toLowerCase().replace(/\s+/g, "").replace(/^(redmi|poco|mi)/, "");
        return { modelo, tipoRepuesto, marca: "Xiaomi" };
    }

    const fallback = limpio.match(/\b([a-z]{1,3}\d{1,3}[a-z]?)\b/i);
    return { 
        modelo: fallback ? fallback[1].toLowerCase() : null, 
        tipoRepuesto, 
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
    const marcaNorm = marca ? normalizar(marca) : null;
    
    return datos.filter(item => {
        const matchModelo = item.Modelo === modeloNorm || item.Modelo.includes(modeloNorm);
        
        let matchParte = false;
        if (tipoRepuesto === "ambos") {
            // Si es "ambos", aceptamos tanto batería como módulo
            matchParte = item.Parte?.includes("bater") || item.Parte?.includes("modulo") || item.Parte?.includes("pantall");
        } else if (tipoRepuesto === "bateria") {
            matchParte = item.Parte?.includes("bater");
        } else {
            matchParte = item.Parte?.includes("modulo") || item.Parte?.includes("pantall");
        }
        
        const matchMarca = !marcaNorm || item.Marca?.includes(marcaNorm);
        
        return matchModelo && matchParte && matchMarca;
    });
}

// 🚀 ENDPOINT PRINCIPAL
app.post("/precio", async (req, res) => {
    try {
        const mensaje = req.body.message || req.body.texto || "";
        const consulta = parsearConsulta(mensaje);
        
        if (!consulta.modelo) {
            return res.json({ 
                respuesta: `👋 ¡Hola! Soy el asistente técnico de *EAInformatica*.\n\nContame: ¿Qué modelo de equipo tenés?`,
                tipo: "saludo"
            });
        }

        const datos = await cargarDatos();
        const resultados = buscarRepuestos(datos, consulta);

        if (resultados.length === 0) {
            return res.json({ 
                respuesta: `❌ No encontré información para *${consulta.modelo.toUpperCase()}*.\n\n📩 Un *técnico* va a revisar manualmente y te contesta en un toque. 😉`,
                tipo: "no_encontrado"
            });
        }

        // ========================================
        // 🔋🖥️ CASO: AMBOS REPUESTOS (pantalla + batería)
        // ========================================
        if (consulta.tipoRepuesto === "ambos") {
            const pantallas = resultados.filter(r => r.Parte?.includes("modulo") || r.Parte?.includes("pantall"));
            const baterias = resultados.filter(r => r.Parte?.includes("bater"));
            
            let respuesta = `🔋🖥️ Presupuesto para *${resultados[0].NombreMostrar || consulta.modelo.toUpperCase()}*:\n\n`;
            
            // Precios de batería
            if (baterias.length > 0) {
                const precioBateria = calcularPrecio(baterias[0].PrecioBase, baterias[0].Marca, baterias[0].Parte);
                respuesta += `🔹 *Batería (Original)* → *$${precioBateria.toLocaleString('es-AR')}*\n`;
            }
            
            // Precios de pantalla por calidad
            if (pantallas.length > 0) {
                const opciones = {};
                pantallas.forEach(item => {
                    const calidad = item.Calidad || "Estándar";
                    if (!opciones[calidad]) opciones[calidad] = [];
                    opciones[calidad].push(item);
                });
                
                respuesta += `\n🔹 *Pantalla*:\n`;
                for (const [calidad, items] of Object.entries(opciones)) {
                    const precio = calcularPrecio(items[0].PrecioBase, items[0].Marca, items[0].Parte);
                    respuesta += `   • ${calidad} → *$${precio.toLocaleString('es-AR')}*\n`;
                }
            }
            
            respuesta += `\n✅ *Precios finales con colocación incluida.*\n📍 ¿Qué repuesto querés encargar?`;
            
            return res.json({
                respuesta,
                tipo: "ambos_repuestos",
                modelo: consulta.modelo,
                precios: {
                    bateria: baterias[0] ? calcularPrecio(baterias[0].PrecioBase, baterias[0].Marca, baterias[0].Parte) : null,
                    pantalla: Object.fromEntries(
                        Object.entries(
                            pantallas.reduce((acc, item) => {
                                const calidad = item.Calidad || "Estándar";
                                if (!acc[calidad]) acc[calidad] = item.PrecioBase;
                                return acc;
                            }, {})
                        ).map(([calidad, base]) => [
                            calidad, 
                            calcularPrecio(base, pantallas[0].Marca, pantallas[0].Parte)
                        ])
                    )
                }
            });
        }

        // ========================================
        // 🔋 CASO: SOLO BATERÍA → PRECIO DIRECTO
        // ========================================
        if (consulta.tipoRepuesto === "bateria") {
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

        // ========================================
        // 🖥️ CASO: SOLO PANTALLA → MOSTRAR PRECIOS POR CALIDAD
        // ========================================
        // Agrupar por calidad para mostrar opciones CON PRECIOS
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
            // ← AQUÍ ESTÁ LA CLAVE: mostramos el precio calculado
            respuesta += `${idx}. *${calidad}* → *$${precio.toLocaleString('es-AR')}*\n`;
            idx++;
        }
        
        respuesta += `\n*(Escribí el nombre o el número)*`;
        
        return res.json({
            respuesta: respuesta,
            tipo: "pantalla_calidad",
            modelo: consulta.modelo,
            opciones: Object.keys(opciones).map((calidad, i) => ({
                nombre: calidad,
                precio: calcularPrecio(opciones[calidad][0].PrecioBase, resultados[0].Marca, resultados[0].Parte),
                numero: i + 1
            }))
        });

    } catch (error) {
        console.error("❌ Error en /precio:", error.message);
        return res.json({ 
            respuesta: "⚠️ Tuvimos un inconveniente técnico.\n\n📩 Un humano va a revisar tu consulta y te responde en breve. ¡Gracias por la paciencia! 😉",
            tipo: "error"
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
