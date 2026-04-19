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
function limpiar(texto) {
  return texto.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// 🔍 BUSCAR PRODUCTO (MEJORADO)
function buscarProducto(lista, mensaje) {
  mensaje = limpiar(mensaje);

  let mejor = null;
  let mejorScore = 0;

  for (const item of lista) {
    const modelo = limpiar(item.Modelo || "");
    const tipo = (item.Tipo || "").toLowerCase();

    // 🔴 SOLO MODULOS
    if (!tipo.includes("modulo")) continue;

    let score = 0;

    if (mensaje.includes(modelo)) score += 5;

    const partes = modelo.split(" ");
    for (const p of partes) {
      if (mensaje.includes(p)) score++;
    }

    if (score > mejorScore) {
      mejorScore = score;
      mejor = item;
    }
  }

  return mejorScore > 0 ? mejor : null;
}

// 🤖 API
app.post("/precio", async (req, res) => {
  try {
    const mensaje = req.body.message.toLowerCase();

    // 🔌 SERVICIO
    if (mensaje.includes("pin de carga")) {
      const esIphone = mensaje.includes("iphone");
      return res.json({
        respuesta: `🔌 Cambio pin de carga\n💰 $${esIphone ? 80000 : 30000}`
      });
    }

    const datos = await obtenerDatos();
    const producto = buscarProducto(datos, mensaje);

    // 👉 SI ENCONTRÓ PRODUCTO
    if (producto) {
      let base = String(producto.PrecioBase || "0").replace(/[^\d]/g, "");
      base = Number(base);

      const esIphone = (producto.Marca || "").toLowerCase().includes("apple");

      const final = calcularPrecio(base, esIphone);

      return res.json({
        respuesta: `📱 ${producto.Modelo}\n💰 Precio final: $${final}`
      });
    }

    // 👉 SI NO ENCONTRÓ PERO SALUDAN
    if (mensaje.includes("hola") || mensaje.includes("buenas")) {
      return res.json({
        respuesta: "👋 Hola! Decime el modelo y te paso el precio."
      });
    }

    // 👉 DEFAULT
    return res.json({
      respuesta: "📱 Decime el modelo del equipo (ej: Samsung A05)"
    });

  } catch (error) {
    console.log(error);
    return res.json({
      respuesta: "⚠️ Error al procesar"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor activo");
});
