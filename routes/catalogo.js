// routes/catalogo.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// routes/catalogo.js

// Categorías Generales (Filtradas por Ciudad si se envía el parámetro)
router.get('/categorias', async (req, res) => {
  try {
    const { id_ciudad } = req.query;
    let query = `
      SELECT c.id_categoria as id, c.nombre_categoria as nombre, u.url as icono
      FROM categorias_generales c
      LEFT JOIN url_icono u ON c.id_icono = u.id_icono
    `;
    const params = [];
    if (id_ciudad) {
      query += `
        JOIN categoria_general_ciudad_operativa cgco 
          ON c.id_categoria = cgco.id_categoria_general
        WHERE cgco.id_ciudad_operativa = $1
      `;
      params.push(id_ciudad);
    }

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  } 
});

// 2. Obtener Subcategorías (Tipos) por ID de Categoría
router.get('/tipos/:id_categoria', async (req, res) => {
  try {
    const { id_categoria } = req.params;
    const query = `
      SELECT t.id_tipo as id, t.nombre_tipo as nombre, u.url as icono
      FROM tipos_especificos t
      LEFT JOIN url_icono u ON t.id_icono = u.id_icono
      WHERE t.id_categoria = $1
    `;
    const { rows } = await pool.query(query, [id_categoria]);
    res.json(rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 3. Obtener Servicios por ID de Tipo (Subcategoría)
router.get('/servicios/:id_tipo', async (req, res) => {
  try {
    const { id_tipo } = req.params;
    const query = `
      SELECT s.id_servicio as id, s.nombre_servicio as nombre, u.url as icono
      FROM tipo_especifico_servicio ts
      JOIN servicios s ON ts.id_servicio = s.id_servicio
      LEFT JOIN url_icono u ON ts.id_icono = u.id_icono
      WHERE ts.id_tipo = $1
    `;
    const { rows } = await pool.query(query, [id_tipo]);
    res.json(rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;