import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";

const app = express();
app.use(express.json());

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1dvTJM6zRoc-zZMjEdWest2y0oofjYi9ZOmjKSi0ftDA/export?format=csv";

// 💰 PRECIO
function calcularPrecio(base, esIphone) {
  base = Number(base);
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

// 🔍 LIMPIAR TEXTO
function limpiar(txt) {
  return txt.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// 🔍 DETECTAR MODELO DESDE MENSAJE
function extraerModelo(mensaje) {
  const limpio = limpiar(mensaje);

  // patrones comunes
  const match = limpio.match(/(a\d{2,3}|j\d{1,3}|g\d{1,3}|m\d{1,3}|note\d{1,3}|s\d{1,2})/i);

  return match ? match[0] : null;
}

// 🔍 BUSCAR PRODUCTO
function buscarProducto(lista, modeloBuscado) {
  if (!modeloBuscado) return null;

  modeloBuscado = limpiar(modeloBuscado);

  let mejor = null;

  for (const item of lista) {
    const modelo = limpiar(item.Modelo || "");
    const tipo = (item.Tipo || "").toLowerCase();

    // solo módulos
    if (!tipo.includes("modulo")) continue;

    if (modelo.includes(modeloBuscado)) {
      mejor = item;
      break;
    }
  }

  return mejor;
}

// 🤖 API
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
        respuesta: "👋 Hola! ¿En qué puedo ayudarte?"
      });
    }

    // 🔌 SERVICIO
    if (mensaje.includes("pin de carga")) {
      const esIphone = mensaje.includes("iphone");

      return res.json({
        respuesta: `🔌 Cambio pin de carga\n💰 $${esIphone ? 80000 : 30000}`
      });
    }

    // 🔍 DETECTAR MODELO
    const modeloDetectado = extraerModelo(mensaje);

    if (!modeloDetectado) {
      return res.json({
        respuesta: "📱 Decime el modelo del equipo (ej: A05, J7, iPhone 11)"
      });
    }

    const datos = await obtenerDatos();
    const producto = buscarProducto(datos, modeloDetectado);

    if (!producto) {
      return res.json({
        respuesta: `📱 No encontré ${modeloDetectado}\n👉 Probá con otro modelo`
      });
    }

    let base = String(producto.PrecioBase || "0").replace(/[^\d]/g, "");
    base = Number(base);

    const esIphone = (producto.Marca || "").toLowerCase().includes("apple");

    const final = calcularPrecio(base, esIphone);

    return res.json({
      respuesta: `📱 ${producto.Modelo}\n💰 Precio final: $${final}`
    });

  } catch (error) {
    console.log(error);
    return res.json({
      respuesta: "⚠️ Error al procesar la consulta"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor listo 🚀");
});
