import express from "express";
import fetch from "node-fetch";
import csv from "csv-parser";
import { Readable } from "stream";

const app = express();
app.use(express.json());

// 🔗 TU NUEVO SHEET (CSV)
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1dvTJM6zRoc-zZMjEdWest2y0oofjYi9ZOmjKSi0ftDA/export?format=csv";

// 💰 FORMULAS
function calcularPrecio(base, esIphone) {
  base = Number(base);

  if (esIphone) {
    return (base + 10000) * 2 + 50000;
  }

  return (base + 10000) * 2 + 20000;
}

// 📥 LEER GOOGLE SHEET
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

// 🔍 BUSCAR PRODUCTO
function buscarProducto(lista, mensaje) {
  mensaje = mensaje.toLowerCase();

  return lista.find(item => {
    const modelo = (item.Modelo || "").toLowerCase();
    return mensaje.includes(modelo);
  });
}

// 🤖 ENDPOINT
app.post("/precio", async (req, res) => {
  try {
    const mensaje = req.body.message.toLowerCase();

    const datos = await obtenerDatos();

    const producto = buscarProducto(datos, mensaje);

    if (!producto) {
      return res.json({
        respuesta: "No encontré ese modelo, decime modelo más específico 📱"
      });
    }

    const base = Number(producto.PrecioBase || 0);

    const esIphone = (producto.Marca || "").toLowerCase().includes("apple");

    const final = calcularPrecio(base, esIphone);

    return res.json({
      respuesta: `📱 ${producto.Modelo}\n💰 Precio final: $${final}`
    });

  } catch (error) {
    console.log("ERROR:", error);

    return res.json({
      respuesta: "Error al procesar la consulta ⚠️"
    });
  }
});

// ⚠️ PUERTO RENDER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor funcionando en puerto", PORT);
});
