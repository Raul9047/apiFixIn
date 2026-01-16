// routes/ubicacion.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { autenticarUsuario } = require('../middleware/auth');


// -----------------------------------------------------
// 1. ID Ciudad Operativa (PÚBLICO)
// -----------------------------------------------------
router.post('/id-ciudad-operativa', async (req, res) => {
  const { latitud, longitud } = req.body;

  if (!latitud || !longitud) {
    return res.status(400).send('Faltan latitud o longitud.');
  }

  const query = `
    SELECT id_ciudad, nombre_ciudad
    FROM ciudades_operativas
    WHERE 
      esta_activa = true 
      AND ST_Intersects(area_operativa, ST_MakePoint($1, $2)::geography);
  `;
  const params = [longitud, latitud];

  try {
    const { rows } = await pool.query(query, params);
    if (rows.length > 0) {
      res.status(200).json({
        dentroDeZona: true,
        id_ciudad: rows[0].id_ciudad,
        nombre_ciudad: rows[0].nombre_ciudad
      });
    } else {
      res.status(200).json({
        dentroDeZona: false
      });
    }
  } catch (error) {
    console.error('Error al verificar id ciudad:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 2. Servicios Disponibles en zona (Requiere Auth)
// Devuelve qué servicios (Mecánico, Llantero, etc.) hay disponibles cerca
// -----------------------------------------------------
router.get('/categoriaGeneralEnCiudadOperativa', autenticarUsuario, async (req, res) => {
  const { latitud, longitud } = req.query;

  if (!latitud || !longitud) {
    return res.status(400).send('Se requiere latitud y longitud.');
  }

  const query = `
    SELECT DISTINCT 
        cg.id_categoria AS id_servicio,
        cg.nombre_categoria AS nombre_servicio, 
        ui.url AS icono_url
    FROM categorias_generales cg
      JOIN tipos_especificos te ON cg.id_categoria = te.id_categoria
      JOIN tipo_servicio ts ON te.id_tipo = ts.id_tipo
      JOIN empresas_servicios es ON ts.id_tipo = es.id_tipo AND ts.id_servicio = es.id_servicio
      JOIN empresas e ON es.id_empresa = e.id_empresa
      JOIN ciudades_operativas c ON e.id_ciudad = c.id_ciudad
      LEFT JOIN url_icono ui ON cg.id_icono = ui.id_icono
    WHERE 
        c.esta_activa = true
        AND ST_Intersects(c.area_operativa, ST_MakePoint($1, $2)::geography)
    ORDER BY cg.nombre_categoria;
  `;
  
  const params = [longitud, latitud];

  try {
    const { rows } = await pool.query(query, params);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error al obtener categorías por ubicación:', error);
    res.status(500).send('Error interno del servidor');
  }
});


// -----------------------------------------------------
// 3. Todos los servicios (Requiere Auth)
// Listado simple de servicios (para catálogos, etc.)
// -----------------------------------------------------
router.get('/servicios', autenticarUsuario, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM servicios ORDER BY nombre_servicio');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    res.status(500).send('Error interno del servidor');
  }
});


// -----------------------------------------------------
// 4. Verificar Cobertura (PÚBLICO)
// -----------------------------------------------------
router.post('/verificar-cobertura', async (req, res) => {
  const { latitud, longitud } = req.body;

  if (!latitud || !longitud) {
    return res.status(400).send('Faltan latitud o longitud.');
  }
  try {
    const query = `
      SELECT EXISTS (
        SELECT 1 
        FROM ciudades_operativas 
        WHERE esta_activa = true 
        AND ST_Intersects(area_operativa, ST_MakePoint($1, $2)::geography)
      ) as esta_cubierto;
    `;

    const { rows } = await pool.query(query, [longitud, latitud]);
    const resultado = rows[0].esta_cubierto;

    res.status(200).json({ 
        dentro_de_zona: resultado 
    });

  } catch (error) {
    console.error('Error al verificar cobertura:', error);
    res.status(500).send('Error interno del servidor');
  }
});

module.exports = router;