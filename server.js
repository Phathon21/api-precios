import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";

const app = express();
app.use(express.json());

// 🔗 TU SHEET
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1dvTJM6zRoc-zZMjEdWest2y0oofjYi9ZOmjKSi0ftDA/export?format=csv";

// 💰 CALCULAR PRECIO
function calcularPrecio(base, esIphone) {
  base = Number(base);

  if (esIphone) {
    return (base + 10000) * 2 + 50000;
  }

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

// 🔍 BÚSQUEDA INTELIGENTE
function buscarProducto(lista, mensaje) {
  mensaje = mensaje.toLowerCase();

  let mejor = null;
  let mejorScore = 0;

  for (const item of lista) {
    const modelo = (item.Modelo || "").toLowerCase();

    let score = 0;

    // coincidencia completa
    if (mensaje.includes(modelo)) {
      score += 5;
    }

    // coincidencia parcial
    const partes = modelo.split(" ");
    for (const p of partes) {
      if (mensaje.includes(p)) {
        score++;
      }
    }

    if (score > mejorScore) {
      mejorScore = score;
      mejor = item;
    }
  }

  return mejorScore > 0 ? mejor : null;
}

// 🤖 ENDPOINT
app.post("/precio", async (req, res) => {
  try {
    const mensaje = req.body.message.toLowerCase();

    // 👋 SALUDO
    if (
      mensaje.includes("hola") ||
      mensaje.includes("buenas") ||
      mensaje.includes("buen día") ||
      mensaje.includes("buenas tardes")
    ) {
      return res.json({
        respuesta: "👋 Hola! ¿Qué modelo necesitás cotizar?"
      });
    }

    // 🔌 PIN DE CARGA
    if (mensaje.includes("pin de carga")) {
      const esIphone = mensaje.includes("iphone");
      const precio = esIphone ? 80000 : 30000;

      return res.json({
        respuesta: `🔌 Cambio de pin de carga\n💰 Precio final: $${precio}`
      });
    }

    // 📱 BUSCAR PRODUCTO
    const datos = await obtenerDatos();
    const producto = buscarProducto(datos, mensaje);

    if (!producto) {
      return res.json({
        respuesta: "📱 No encontré ese modelo\n👉 Ej: 'módulo Samsung A05'"
      });
    }

    const base = Number(producto.PrecioBase || 0);

    const esIphone = (producto.Marca || "")
      .toLowerCase()
      .includes("apple");

    const final = calcularPrecio(base, esIphone);

    return res.json({
      respuesta: `📱 ${producto.Modelo}\n💰 Precio final: $${final}`
    });

  } catch (error) {
    console.log("ERROR:", error);

    return res.json({
      respuesta: "⚠️ Error al procesar la consulta"
    });
  }
});

// ⚠️ PUERTO
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
