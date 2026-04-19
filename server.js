import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";

const app = express();
app.use(express.json());

// 🔗 TU SHEET NUEVO
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1dvTJM6zRoc-zZMjEdWest2y0oofjYi9ZOmjKSi0ftDA/export?format=csv&gid=583618011";

// 💰 CALCULAR PRECIO
function calcularPrecio(base, esIphone) {
  base = Number(base);
  if (!base || base <= 0) return null;

  if (esIphone) return (base + 10000) * 2 + 50000;
  return (base + 10000) * 2 + 20000;
}

// 📥 LEER SHEET
async function obtenerDatos() {
  const res = await fetch(SHEET_URL);
  const text = await res.text();

  const resultados = [];

  return new Promise((resolve, reject) => {
    Readable.from(text)
      .pipe(csv())
      .on("data", (data) => resultados.push(data))
      .on("end", () => resolve(resultados))
      .on("error", (err) => reject(err));
  });
}

// 🧼 LIMPIAR TEXTO
function limpiar(txt) {
  return (txt || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// 🔍 DETECTAR MODELO
function extraerModelo(mensaje) {
  const limpio = mensaje.toLowerCase();

  // iPhone
  if (limpio.includes("iphone") || limpio.includes("iph")) {
    const num = limpio.match(/\d+/);
    if (num) return "iphone" + num[0];
  }

  // Android
  const match = limpio.match(/([a-z]{1,2}\s?\d{1,3})/i);
  return match ? match[0].replace(" ", "") : null;
}

// 🤖 ENDPOINT
app.post("/precio", async (req, res) => {
  try {
    const mensaje = req.body.message.toLowerCase();

    // 👋 SALUDO
    if (
      mensaje.includes("hola") ||
      mensaje.includes("buenas") ||
      mensaje.includes("buen día")
    ) {
      return res.json({
        respuesta: "👋 Hola! ¿En qué puedo ayudarte hoy? 😊"
      });
    }

    // 🔌 SERVICIO PIN DE CARGA
    if (mensaje.includes("pin de carga")) {
      const esIphone = mensaje.includes("iphone");
      return res.json({
        respuesta: `🔌 Cambio de pin de carga\n💰 Precio final: $${esIphone ? 80000 : 30000}\n\n📩 Escribinos para coordinar el arreglo 😉`
      });
    }

    const datos = await obtenerDatos();
    const modeloBuscado = extraerModelo(mensaje);

    if (!modeloBuscado) {
      return res.json({
        respuesta: "📱 Decime el modelo del equipo (ej: A05, J7, iPhone 11) 😉"
      });
    }

    // 🔍 FILTRAR POR MODELO
    const resultados = datos.filter(item =>
      limpiar(item.Modelo).includes(limpiar(modeloBuscado))
    );

    if (resultados.length === 0) {
      return res.json({
        respuesta: "❌ No encontramos ese modelo en este momento.\n\n📩 Un asesor puede ayudarte si nos das más detalles 😉"
      });
    }

    // 📱 NOMBRE
    const nombre = resultados[0].NombreMostrar || modeloBuscado;

    const opciones = {};

    resultados.forEach(item => {
      const clave = `${item.Calidad} ${item.Variante}`;
      const base = item.PrecioBase;

      const esIphone = (item.Marca || "").toLowerCase().includes("apple");
      const final = calcularPrecio(base, esIphone);

      // ❌ ignorar sin precio
      if (!final) return;

      if (!opciones[clave]) {
        opciones[clave] = final;
      }
    });

    const keys = Object.keys(opciones);

    // ❌ SIN STOCK
    if (keys.length === 0) {
      return res.json({
        respuesta: `📱 ${nombre}\n\n⚠️ En este momento no tenemos stock disponible.\n\n📩 Un asesor se va a comunicar con vos para ofrecerte una solución 😉`
      });
    }

    // limitar a 3 opciones
    const limitadas = keys.slice(0, 3);

    let respuesta = `📱 ${nombre}\n\n`;

    limitadas.forEach(k => {
      respuesta += `🔹 ${k} → $${opciones[k]}\n`;
    });

    respuesta += "\n📩 Escribinos para coordinar el arreglo o consultar disponibilidad 😊";

    return res.json({ respuesta });

  } catch (error) {
    console.log("ERROR:", error);
    return res.json({
      respuesta: "⚠️ Ocurrió un error. Intentá nuevamente en unos segundos."
    });
  }
});

// 🚀 SERVIDOR
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor funcionando 🚀");
});
