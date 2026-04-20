// Dentro de app.post("/precio", ...), reemplazá el bloque "ambos_repuestos" por este:
if (consulta.tipoRepuesto === "ambos") {
    // ... (tu lógica de filtrar pantallas y baterías) ...
    
    // Construir objeto de precios exacto para el bot
    const preciosPantalla = {};
    pantallas.forEach(p => {
        const cal = (p.Calidad || "estandar").toLowerCase().trim();
        if (!preciosPantalla[cal]) {
            preciosPantalla[cal] = calcularPrecio(p.PrecioBase, p.Marca, p.Parte);
        }
    });

    return res.json({
        respuesta: `🔋🖥️ Presupuesto para *${resultados[0].NombreMostrar || consulta.modelo.toUpperCase()}*:\n\n🔹 Batería (Original) → ${formatoPrecio(calcularPrecio(baterias[0].PrecioBase, baterias[0].Marca, baterias[0].Parte))}\n🔹 Pantalla:\n   • original → ${formatoPrecio(preciosPantalla.original || 0)}\n   • incell → ${formatoPrecio(preciosPantalla.incell || preciosPantalla.mecanico || 0)}\n\n✅ *Precios finales con colocación incluida.*\n📍 ¿Qué repuesto querés encargar?`,
        tipo: "ambos_repuestos",
        modelo: consulta.modelo,
        precios: {
            bateria: calcularPrecio(baterias[0].PrecioBase, baterias[0].Marca, baterias[0].Parte),
            pantalla: preciosPantalla // { original: 61998, incell: 45000 }
        }
    });
}
