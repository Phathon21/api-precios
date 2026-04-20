import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";

const app = express();
app.use(express.json());

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1dvTJM6zRoc-zZMjEdWest2y0oofjYi9ZOmjKSi0ftDA/export?format=csv&gid=583618011";

// 💰 LÓGICA DE PRECIOS (Ajustala a tu margen de Catamarca)
function calcularPrecio(base, marca) {
    base = Number(base);
    if (!base || base <= 0) return null;

    const esIphone = (marca || "").toLowerCase().includes("apple") || (marca || "").toLowerCase().includes("iphone");
    
    // Tu fórmula actual
    if (esIphone) return (base + 10000) * 2 + 50000;
    return (base + 10000) * 2 + 20000;
}

// 🧼 LIMPIAR TEXTO (Mejorada para no borrar la 'S' de los modelos)
function limpiarParaBusqueda(txt) {
    return (txt || "").toLowerCase().trim().replace(/\s+/g, ""); 
}

// 🔍 EXTRAER MODELO DEL MENSAJE
function extraerModelo(mensaje) {
    const limpio = mensaje.toLowerCase();
    
    // Detecta iPhone
    if (limpio.includes("iphone")) {
        const num = limpio.match(/\d+/);
        return num ? "iphone" + num[0] : "iphone";
    }

    // Detecta Android (A04s, G52, J7 Prime, etc)
    // Esta regex ahora permite una letra opcional al final (como la 'S' o 'G')
    const match = limpio.match(/([a-z]{1,2}\s?\d{1,3}[a-z]?)/i);
    return match ? match[0].replace(/\s+/g, "") : null;
}

app.post("/precio", async (req, res) => {
    try {
        const mensaje = req.body.message.toLowerCase();
        
        // --- RESPUESTAS DE SERVICIOS FIJOS ---
        if (mensaje.includes("pin de carga") || mensaje.includes("no carga")) {
            return res.json({ respuesta: "🔌 *Cambio de Pin de Carga*\n💰 Precio estimado: $30.000 a $45.000\n\n(Depende del modelo exacto). Traelo al local para confirmar. 😉" });
        }
        
        if (mensaje.includes("cuenta google") || mensaje.includes("frp") || mensaje.includes("bloqueado")) {
            return res.json({ respuesta: "🔐 *Desbloqueo de Cuenta Google (FRP)*\n💰 Precio: Desde $15.000\n⏳ Tiempo: 1 a 3 horas.\n\nTraelo cuando quieras. 😉" });
        }

        if (mensaje.includes("formateo") || mensaje.includes("windows") || mensaje.includes("lenta")) {
            return res.json({ respuesta: "💻 *Servicio técnico PC/Notebook*\n• Formateo + Windows + Programas: $25.000\n• Limpieza física: $15.000\n\n¡Queda como nueva! 🚀" });
        }

        const resSheet = await fetch(SHEET_URL);
        const text = await resSheet.text();
        const datos = [];

        // Parsear CSV
        const parsear = () => new Promise((resolve) => {
            Readable.from(text)
                .pipe(csv())
                .on("data", (row) => datos.push(row))
                .on("end", resolve);
        });
        await parsear();

        const modeloBuscado = extraerModelo(mensaje);

        if (!modeloBuscado) {
            return res.json({ respuesta: "👋 ¡Hola! Soy el asistente técnico.\n\nPor favor, decime el *modelo exacto* del equipo para darte el precio del repuesto (Ej: A04s, Moto G52, iPhone 13)." });
        }

        // 🔍 BUSQUEDA MÁS FLEXIBLE
        // Busca si el modelo que escribió el usuario está CONTENIDO en la columna Modelo del Excel
        const resultados = datos.filter(item => {
            const modeloExcel = limpiarParaBusqueda(item.Modelo);
            const busqueda = limpiarParaBusqueda(modeloBuscado);
            return modeloExcel.includes(busqueda) || busqueda.includes(modeloExcel);
        });

        if (resultados.length === 0) {
            return res.json({ 
                respuesta: `❌ No encontré el precio de *${modeloBuscado.toUpperCase()}* en la base de datos.\n\n📩 Un *técnico* va a revisar el stock manualmente y te contesta en un toque. 😉` 
            });
        }

        const nombreReal = resultados[0].NombreMostrar || resultados[0].Modelo;
        let respuesta = `📱 *${nombreReal}*\n\n`;
        let hayOpciones = false;

        // Armar lista de precios
        resultados.forEach(item => {
            const precio = calcularPrecio(item.PrecioBase, item.Marca);
            if (precio) {
                hayOpciones = true;
                const calidad = item.Calidad || "Repuesto";
                const variante = item.Variante ? `(${item.Variante})` : "";
                respuesta += `🔹 ${calidad} ${variante} → *$${precio.toLocaleString('es-AR')}*\n`;
            }
        });

        if (!hayOpciones) {
            return res.json({ respuesta: `⚠️ Tenemos el modelo *${nombreReal}* pero consultanos el precio por privado porque no figura en lista.` });
        }

        respuesta += "\n✅ *Precios finales con colocación incluida.*\n📩 ¿Te gustaría que encarguemos el repuesto?";

        return res.json({ respuesta });

    } catch (error) {
        console.error(error);
        return res.json({ respuesta: "⚠️ Un técnico revisará tu consulta en breve. 😉" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API de Precios lista 🚀"));
