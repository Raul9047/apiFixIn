// routes/empresas.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

const { soloToken, autenticarEmpresa } = require('../middleware/auth');
const { enviarNotificacion } = require('../utils/notificaciones');

// -----------------------------------------------------
// 1. Verificar existencia empresa (Público)
// -----------------------------------------------------
router.post('/verificar-existencia-empresa', async (req, res) => {
  const { email } = req.body;
  const queryText = 'SELECT 1 FROM empresas WHERE email_contacto = $1';
  try {
     const { rows } = await pool.query(queryText, [email]);
     res.status(200).json({ existe: rows.length > 0 });
  } catch(e) { res.status(500).send('Error'); }
});

// -----------------------------------------------------
// 2. Registrar empresa (Autenticado)
// -----------------------------------------------------
router.post('/registrarEmpresa', soloToken, async (req, res) => {
  const checkQuery = 'SELECT 1 FROM empresas WHERE firebase_uid = $1';
  const checkResult = await pool.query(checkQuery, [req.firebase_uid]);
  
  if (checkResult.rows.length > 0) {
     return res.status(400).send('Ya existe una empresa registrada con esta cuenta.');
  }
  const { nombre_empresa, nombre_encargado, email_contacto, direccion_fiscal, latitud, longitud, id_ciudad, id_categoria, fecha_creacion } = req.body;

  const query = `
    INSERT INTO empresas (
      firebase_uid, nombre_empresa, nombre_encargado, email_contacto, 
      direccion_fiscal, estado, ubicacion, id_ciudad, id_categoria, fecha_creacion
    ) VALUES ($1, $2, $3, $4, $5, 'fuera_de_linea', ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, $10)
    RETURNING *;
  `;
  try {
     const { rows } = await pool.query(query, [
        req.firebase_uid, nombre_empresa, nombre_encargado, email_contacto, 
        direccion_fiscal, longitud, latitud, id_ciudad, id_categoria, fecha_creacion
     ]);
     res.status(201).json(rows[0]);
  } catch (error) {
     console.error(error);
     res.status(500).send('Error al registrar');
  }
});

// -----------------------------------------------------
// 2.1. Actualizar Datos de mi empresa (Autenticado)
// -----------------------------------------------------
router.put('/actualizar-datos-empresa', soloToken, async (req, res) => {
  const checkQuery = 'SELECT 1 FROM empresas WHERE firebase_uid = $1';
  const checkResult = await pool.query(checkQuery, [req.firebase_uid]);
  
  if (checkResult.rows.length === 0) {
     return res.status(404).send('No se encontro la empresa registrada con esta cuenta.');
  }
  const { nombre_empresa, nombre_encargado, direccion_fiscal, latitud, longitud, id_ciudad } = req.body;

  const query = `
      UPDATE empresas 
      SET 
        nombre_empresa = $2, 
        nombre_encargado = $3, 
        direccion_fiscal = $4, 
        ubicacion = ST_SetSRID(ST_MakePoint($5, $6), 4326), 
        id_ciudad = $7
      WHERE firebase_uid = $1
      RETURNING *;
    `;
  try {
const { rows } = await pool.query(query, [
        req.firebase_uid, nombre_empresa, nombre_encargado, 
        direccion_fiscal, longitud, latitud, id_ciudad 
      ]);
     res.status(200).json(rows[0]);
  } catch (error) {
     console.error(error);
     res.status(500).send('Error al registrar');
  }
});

// -----------------------------------------------------
// 2.2. Actualizar Token FCM (Empresa)
// -----------------------------------------------------
router.put('/actualizar-token', autenticarEmpresa, async (req, res) => {
    const { token } = req.body;
    const firebase_uid = req.firebase_uid;
    try {
        await pool.query('UPDATE empresas SET fcm_token = $1 WHERE firebase_uid = $2', [token, firebase_uid]);
        res.status(200).send('Token actualizado');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error token');
    }
});

// -----------------------------------------------------
// 3. Obtener Perfil de Mi Empresa (Autenticado)
// -----------------------------------------------------
router.get('/mi-empresa', autenticarEmpresa, async (req, res) => { 
  const firebase_uid = req.firebase_uid; 
  const query = `
    SELECT 
      t.*,
      ST_X(t.ubicacion::geometry) as longitud,
      ST_Y(t.ubicacion::geometry) as latitud,
      c.nombre_ciudad
    FROM empresas t
    LEFT JOIN ciudades_operativas c ON t.id_ciudad = c.id_ciudad
    WHERE t.firebase_uid = $1
  `;

  try {
    const { rows } = await pool.query(query, [firebase_uid]);
    if (rows.length === 0) {
      return res.status(404).send('Empresa no encontrada.');
    }
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).send('Error interno');
  }
});


// -----------------------------------------------------
// 3.1. Obtener la calificación de Mi Empresa (Autenticado)
// -----------------------------------------------------
router.get('/mi-empresa-detalles', autenticarEmpresa, async (req, res) => { 
  const id_empresa = req.empresa_postgres.id_empresa;
  const query = `SELECT calificacion_promedio FROM empresa_estadisticas WHERE id_empresa = $1`;

  try {
    const { rows } = await pool.query(query, [id_empresa]);
    let respuesta;

    if (rows.length === 0) {
      respuesta = {
        calificacion_promedio: 0.0
      };
    } else {
      respuesta = {
        calificacion_promedio: Number(rows[0].calificacion_promedio)
      };
    }

    return res.status(200).json(respuesta);

  } catch (error) {
    console.error('Error al obtener detalles: ', error);
    return res.status(500).send('Error interno');
  }
});


// -----------------------------------------------------
// 4. Cambiar Estado (En línea / Fuera de línea)
// -----------------------------------------------------
router.put('/cambiar-estado', autenticarEmpresa, async (req, res) => {
  const { estado } = req.body;
  // Validación básica
  if (!['en_linea', 'fuera_de_linea'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  const query = `
    UPDATE empresas 
    SET estado = $1 
    WHERE firebase_uid = $2 
    RETURNING estado
  `;
  try {
    const { rows } = await pool.query(query, [estado, req.firebase_uid]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    res.status(200).json({ mensaje: 'Estado actualizado', estado: rows[0].estado });
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// -----------------------------------------------------
// 5. Obtener los servicios que ofrece la empresa (Autenticado)
// -----------------------------------------------------
router.get('/mis-servicios', autenticarEmpresa, async (req, res) => {
  const firebase_uid = req.firebase_uid;
  
  // NUEVA CONSULTA SQL
  const query = `
    SELECT 
      es.id_tipo_servicio,
      s.nombre_servicio,
      te.nombre_tipo,
      cg.nombre_categoria,
      ui.url as icono_url,
      es.precio_base,
      es.estado
    FROM empresas e
      JOIN empresas_servicios es ON e.id_empresa = es.id_empresa
      JOIN tipo_especifico_servicio tes ON es.id_tipo_servicio = tes.id_tipo_servicio
      JOIN servicios s ON tes.id_servicio = s.id_servicio
      JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
      JOIN categorias_generales cg ON te.id_categoria = cg.id_categoria
      LEFT JOIN url_icono ui ON tes.id_icono = ui.id_icono
    WHERE e.firebase_uid = $1
    ORDER BY s.nombre_servicio
  `;

  try {
    const { rows } = await pool.query(query, [firebase_uid]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 6. Obtener categorías disponibles en una CIUDAD (Público)
// -----------------------------------------------------
router.get('/categorias-por-ciudad', async (req, res) => {
    const { id_ciudad } = req.query;

    if (!id_ciudad) return res.status(400).send("Falta id_ciudad");

    const query = `
        SELECT cg.id_categoria, cg.nombre_categoria, cg.descripcion, ui.url as icono_url
        FROM categorias_generales cg
        JOIN categoria_general_ciudad_operativa czo ON cg.id_categoria = czo.id_categoria_general
        LEFT JOIN url_icono ui ON cg.id_icono = ui.id_icono
        WHERE czo.id_ciudad_operativa = $1
        ORDER BY cg.nombre_categoria
    `;

    try {
        const { rows } = await pool.query(query, [id_ciudad]);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener categorías por ciudad:', error);
        res.status(500).send('Error interno');
    }
});

// -----------------------------------------------------
// 7. Obtener los sub servicios (Tipos Específicos) del rubro de la empresa
// -----------------------------------------------------
router.get('/sub-servicios-generales', autenticarEmpresa, async (req, res) => {
  const id_empresa = req.empresa_postgres.id_empresa;
  const query = `
    SELECT 
        te.id_tipo, 
        te.nombre_tipo,
        te.id_categoria, 
        ui.url as icono_url
    FROM tipos_especificos te
    JOIN empresas e ON te.id_categoria = e.id_categoria -- JOIN clave
    LEFT JOIN url_icono ui ON te.id_icono = ui.id_icono
    WHERE e.id_empresa = $1
    ORDER BY te.nombre_tipo
  `;

  try {
    const { rows } = await pool.query(query, [id_empresa]);
    
    if (rows.length === 0) {
        return res.status(200).json([]); 
    }
    
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error al obtener sub-servicios:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 7.1 Obtener los servicios específicos para una empresa según el tipo seleccionado
// -----------------------------------------------------
router.get('/servicios-para-empresa', autenticarEmpresa, async (req, res) => {
  const id_tipo = req.query.id_tipo;

  const query = `
    SELECT 
        tes.id_tipo_servicio as id_servicio, -- Alias para que Android lo tome como ID principal
        s.nombre_servicio,
        COALESCE(ui.url, '') as icono_url
    FROM tipo_especifico_servicio tes
    JOIN servicios s ON tes.id_servicio = s.id_servicio
    LEFT JOIN url_icono ui ON tes.id_icono = ui.id_icono
    WHERE tes.id_tipo = $1
    ORDER BY s.nombre_servicio
  `;

  try {
    const { rows } = await pool.query(query, [id_tipo]);

    if (rows.length === 0) {
        return res.status(200).json([]);
    }

    res.status(200).json(rows);
  } catch (error) {
    console.error('Error al obtener servicios para empresa:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 8. Registrar servicio de una empresa (Autenticado)
// -----------------------------------------------------
router.post('/registrar-servicio-empresa', autenticarEmpresa, async (req, res) => {
  try {
    const id_empresa = req.empresa_postgres.id_empresa;
    const { id_tipo_servicio, precio_base } = req.body; 
    if (!id_tipo_servicio || !precio_base) {
        return res.status(400).json({ error: 'Faltan datos obligatorios.' });
    }

    const query = `
      INSERT INTO empresas_servicios (id_empresa, id_tipo_servicio, precio_base, estado)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (id_empresa, id_tipo_servicio) 
      DO UPDATE SET precio_base = EXCLUDED.precio_base, estado = true
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [
      id_empresa, id_tipo_servicio, precio_base
    ]);

    res.status(201).json({
        mensaje: 'Servicio registrado correctamente',
        servicio: rows[0]
    });

  } catch (error) {
    console.error('Error al registrar servicio:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 8.1. Actualizar servicio de una empresa (Precio)
// -----------------------------------------------------
router.put('/actualizar-servicio-empresa', autenticarEmpresa, async (req, res) => {
  const id_empresa = req.empresa_postgres.id_empresa;
  const { id_tipo_servicio, precio_base } = req.body;

  if (!id_tipo_servicio) {
      return res.status(400).json({ error: 'Falta el identificador del servicio.' });
  }

  const query = `
    UPDATE empresas_servicios
    SET 
      precio_base = COALESCE($3, precio_base)
    WHERE id_empresa = $1 AND id_tipo_servicio = $2
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(query, [
      id_empresa, 
      id_tipo_servicio, 
      precio_base
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'El servicio no está registrado o no te pertenece.' });
    }

    res.status(200).json({
        mensaje: 'Precio actualizado correctamente',
        servicio: rows[0]
    });

  } catch (error) {
    console.error('Error al actualizar precio:', error);
    res.status(500).send('Error interno al actualizar servicio');
  }
});

// -----------------------------------------------------
// 8.2. Actualizar estado del servicio de una empresa (UPDATE)
// -----------------------------------------------------
router.put('/actualizar-estado-servicio-empresa', autenticarEmpresa, async (req, res) => {
  const id_empresa = req.empresa_postgres.id_empresa;
  const { id_tipo_servicio, estado } = req.body;

  if (!id_tipo_servicio) {
      return res.status(400).json({ error: 'Falta el identificador del servicio.' });
  }
  const query = `
    UPDATE empresas_servicios
    SET 
      estado = $3
    WHERE id_empresa = $1 AND id_tipo_servicio = $2
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(query, [
      id_empresa, 
      id_tipo_servicio,     
      estado
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'El servicio no está registrado o no pertenece a tu empresa.' });
    }

    res.status(200).json({
        mensaje: 'Estado actualizado correctamente',
        servicio: rows[0]
    });

  } catch (error) {
    console.error('Error al actualizar estado:', error);
    res.status(500).send('Error interno al actualizar servicio');
  }
});


// -----------------------------------------------------
// 9. Aceptar Solicitud de Servicio (Autenticado)
// -----------------------------------------------------
router.post('/aceptar-solicitud', autenticarEmpresa, async (req, res) => {
  const { id_solicitud } = req.body; 
  if (!id_solicitud) return res.status(400).send('Falta ID de solicitud.');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const id_empresa = req.empresa_postgres.id_empresa;
    
    // 1. Verificar saldo y obtener nombre de la empresa
    const qSaldo = 'SELECT saldo_creditos, nombre_empresa FROM empresas WHERE id_empresa = $1';
    const rSaldo = await client.query(qSaldo, [id_empresa]);
    const { saldo_creditos, nombre_empresa } = rSaldo.rows[0];

    const COSTO_ACEPTAR = 5.00;
    if (parseFloat(saldo_creditos) < COSTO_ACEPTAR) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(402).json({ error: 'Saldo insuficiente.' });
    }

    // 2. Verificar disponibilidad
    const qCheck = 'SELECT 1 FROM solicitudes_pendientes WHERE id_solicitud = $1 FOR UPDATE';
    const rCheck = await client.query(qCheck, [id_solicitud]);

    if (rCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ error: 'Esta solicitud ya no está disponible.' });
    }

    // 3. Procesar cobro y movimiento de tablas
    const qPago = `INSERT INTO historial_pagos_empresa(id_empresa, monto_creditos, tipo_transaccion, descripcion) VALUES ($1, $2, 'cobro_servicio', $3)`;
    await client.query(qPago, [id_empresa, -COSTO_ACEPTAR, `Comisión solicitud #${id_solicitud}`]);

    await client.query('DELETE FROM solicitudes_pendientes WHERE id_solicitud = $1', [id_solicitud]);
    
    const qInsert = `INSERT INTO solicitudes_en_curso (id_solicitud, id_empresa) VALUES ($1, $2)`;
    await client.query(qInsert, [id_solicitud, id_empresa]);

    // 4. Obtener Token del usuario para Notificación PUSH (Único dato necesario ahora)
    const qUsuario = `
        SELECT u.fcm_token
        FROM solicitudes s
        JOIN usuarios u ON s.id_usuario = u.id_usuario
        WHERE s.id_solicitud = $1
    `;
    const rUsuario = await client.query(qUsuario, [id_solicitud]);
    const datosUsuario = rUsuario.rows[0];

    await client.query('COMMIT');
    client.release();

    // 5. Notificaciones Socket.IO
    req.io.to(`solicitud_${id_solicitud}`).emit('solicitud_aceptada', {
        id_solicitud: parseInt(id_solicitud),
        nombre_empresa: nombre_empresa
    });

    // Avisar a otras empresas para limpiar lista
    req.io.emit('solicitud_tomada', { id_solicitud, motivo: 'asignada' });

    // 6. Push Notification
    if (datosUsuario && datosUsuario.fcm_token) {
      enviarNotificacion(
        datosUsuario.fcm_token,
        "¡Solicitud Aceptada!",
        `${nombre_empresa} ha aceptado tu solicitud.`,
        { id_solicitud: String(id_solicitud), tipo: "aceptada" }
      );
    }

    res.json({ exito: true, mensaje: 'Solicitud aceptada correctamente' });

  } catch (error) {
    if(client) { await client.query('ROLLBACK'); client.release(); }
    console.error('Error al aceptar:', error);
    res.status(500).send('Error interno');
  }
});

// -----------------------------------------------------
// 10. Mis Trabajos Activos (JOIN con Solicitudes En Curso)
// -----------------------------------------------------
router.get('/mis-trabajos-activos', autenticarEmpresa, async (req, res) => {
  const id_empresa = req.empresa_postgres.id_empresa;

  const query = `
    SELECT 
      s.id_solicitud,
      'aceptada' as estado,
      s.fecha_creacion,
      s.detalles_problema as detalles,
      
      -- Coordenadas del cliente para el mapa/navegación
      ST_X(s.ubicacion_usuario::geometry) as longitud_cliente,
      ST_Y(s.ubicacion_usuario::geometry) as latitud_cliente,
      
      -- Datos del Cliente
      u.nombre as nombre_cliente,
      u.apellido as apellido_cliente,
      u.telefono as telefono_cliente,
      u.firebase_uid as uid_cliente, -- Útil para chat
      
      -- Datos del Servicio (Corregido con la tabla intermedia)
      serv.nombre_servicio,
      te.nombre_tipo,
      
      -- Distancia calculada en metros (PostGIS)
      ST_Distance(s.ubicacion_usuario, e.ubicacion) as distancia_metros

    FROM solicitudes_en_curso sec
    JOIN empresas e ON sec.id_empresa = e.id_empresa
    JOIN solicitudes s ON sec.id_solicitud = s.id_solicitud
    
    -- JOIN CLAVE: Usamos la tabla intermedia
    JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
    JOIN servicios serv ON tes.id_servicio = serv.id_servicio
    JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
    
    JOIN usuarios u ON s.id_usuario = u.id_usuario
    
    WHERE sec.id_empresa = $1
    ORDER BY s.fecha_creacion DESC
  `;

  try {
    const { rows } = await pool.query(query, [id_empresa]);
    
    const formateado = rows.map(t => {
        let distText = '--';
        if (t.distancia_metros) {
            if (t.distancia_metros > 1000) {
                distText = (t.distancia_metros / 1000).toFixed(1) + ' km';
            } else {
                distText = Math.round(t.distancia_metros) + ' mts';
            }
        }
        return {
            ...t, 
            distancia_aprox: distText
        };
    });

    res.json(formateado);
  } catch (error) {
    console.error('Error al obtener trabajos activos:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 11. Solicitudes Pendientes (La "Sala de Espera")
// -----------------------------------------------------
router.get('/solicitudes-pendientes', autenticarEmpresa, async (req, res) => {
  const id_empresa = req.empresa_postgres.id_empresa;
  
  try {
    const query = `
      SELECT 
        s.id_solicitud,
        
        -- Datos del Cliente
        u.nombre as nombre_cliente,
        u.apellido as apellido_cliente,
        
        -- Datos de la Solicitud
        s.detalles_problema as detalles,
        ST_Y(s.ubicacion_usuario::geometry) as latitud_cliente,
        ST_X(s.ubicacion_usuario::geometry) as longitud_cliente,
        s.fecha_creacion,
        
        -- Datos del Servicio (Vía tabla intermedia)
        serv.nombre_servicio,
        te.nombre_tipo, -- Ej: Automovil
        
        -- Distancia a MI empresa (la que consulta)
        ST_Distance(s.ubicacion_usuario, emp.ubicacion) as distancia_metros

      FROM solicitudes s
      JOIN solicitudes_pendientes p ON s.id_solicitud = p.id_solicitud
      JOIN usuarios u ON s.id_usuario = u.id_usuario
      
      -- JOIN CORREGIDO: Ruta completa de relaciones
      JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
      JOIN servicios serv ON tes.id_servicio = serv.id_servicio
      JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
      
      -- FILTRO: Solo mostrar si mi empresa ofrece este servicio específico
      JOIN empresas_servicios es ON tes.id_tipo_servicio = es.id_tipo_servicio
      JOIN empresas emp ON emp.id_empresa = es.id_empresa
      
      WHERE es.id_empresa = $1
        AND es.estado = true
    `;

    const { rows } = await pool.query(query, [id_empresa]);
    
    // Formateo de distancia para la App
    const formateado = rows.map(f => {
        let distText = '--';
        if (f.distancia_metros) {
            if (f.distancia_metros > 1000) {
                distText = (f.distancia_metros / 1000).toFixed(1) + ' km';
            } else {
                distText = Math.round(f.distancia_metros) + ' mts';
            }
        }
        return {
            ...f,
            distancia_aprox: distText
        };
    });

    res.json(formateado);

  } catch (error) {
    console.error('Error al obtener solicitudes pendientes:', error);
    res.status(500).send('Error interno del servidor');
  }
});


// -----------------------------------------------------
// 12. Finalizar Trabajo y Calificar al Usuario
// -----------------------------------------------------
router.post('/terminar-servicio', soloToken, async (req, res) => {
    const { id_solicitud, calificacion, comentario } = req.body;
    
    if (!id_solicitud) return res.status(400).send('Falta el ID de solicitud');

    const client = await pool.connect();
    
    try {
        // 1. Identificar a la empresa
        const qEmp = 'SELECT id_empresa FROM empresas WHERE firebase_uid = $1';
        const rEmp = await client.query(qEmp, [req.firebase_uid]);
        if(rEmp.rows.length === 0) { client.release(); return res.status(404).send('Empresa no encontrada'); }
        const id_empresa = rEmp.rows[0].id_empresa;

        await client.query('BEGIN');

        // 2. Verificar que el trabajo está en curso con ESTA empresa
        const check = await client.query(
            'SELECT 1 FROM solicitudes_en_curso WHERE id_solicitud=$1 AND id_empresa=$2', 
            [id_solicitud, id_empresa]
        );
        
        if(check.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(400).send('Solicitud no encontrada en trabajos activos.');
        }

        // 3. Mover de "En Curso" a "Completadas"
        await client.query('DELETE FROM solicitudes_en_curso WHERE id_solicitud=$1', [id_solicitud]);
        
        // 4. Insertar en completadas guardando la calificación hacia el USUARIO
        const insertQuery = `
            INSERT INTO solicitudes_completadas 
            (id_solicitud, id_empresa, calificacion_usuario, comentario_usuario, calificacion_empresa, fecha_completada) 
            VALUES ($1, $2, $3, $4, 0, NOW())
        `;
        await client.query(insertQuery, [id_solicitud, id_empresa, Math.round(calificacion), comentario]);

        await client.query('COMMIT');
        client.release();

        // 5. Notificar al usuario (Cliente)
        const socketRoom = `solicitud_${id_solicitud}`;
        req.io.to(socketRoom).emit('servicio_finalizado', { 
            id_solicitud,
            mensaje: "El técnico ha finalizado el servicio."
        });
        
        res.json({ exito: true, mensaje: "Servicio finalizado correctamente" });

    } catch (e) {
        await client.query('ROLLBACK');
        client.release();
        console.error(e);
        res.status(500).send('Error al finalizar servicio');
    }
});


// -----------------------------------------------------
// 13. Cancelar Servicio por parte de la Empresa
// -----------------------------------------------------
router.post('/cancelar-servicio', soloToken, async (req, res) => {
  let { id_solicitud, motivo } = req.body;
  if (!id_solicitud) return res.status(400).send('Faltan datos.');
  if (!motivo) motivo = 'Sin motivo especificado.';

  const client = await pool.connect();

  try {
    // 1. Identificar empresa
    const qEmp = 'SELECT id_empresa, nombre_empresa FROM empresas WHERE firebase_uid = $1';
    const rEmp = await client.query(qEmp, [req.firebase_uid]);
    if (rEmp.rows.length === 0) { client.release(); return res.status(404).send('Empresa no encontrada'); }
    
    const { id_empresa, nombre_empresa } = rEmp.rows[0];

    await client.query('BEGIN');

    // 2. Verificar que el trabajo está en curso con ESTA empresa
    const check = await client.query(
      'SELECT 1 FROM solicitudes_en_curso WHERE id_solicitud=$1 AND id_empresa=$2', 
      [id_solicitud, id_empresa]
    );
    
    if (check.rows.length === 0) {
      await client.query('ROLLBACK'); client.release();
      return res.status(400).send('Solicitud no encontrada en trabajos activos.');
    }

    // 3. Eliminar de en_curso
    await client.query('DELETE FROM solicitudes_en_curso WHERE id_solicitud = $1', [id_solicitud]);

    // 4. Insertar en canceladas (El trigger de BD hará el reembolso automático)
    await client.query(`
      INSERT INTO solicitudes_canceladas (id_solicitud, id_empresa, cancelado_por, motivo_principal, descripcion_detallada)
      VALUES ($1, $2, 'empresa', 'Cancelado por técnico', $3)
    `, [id_solicitud, id_empresa, motivo]);

    // 5. Obtener datos usuario para notificar
    const qUsuario = `
        SELECT u.fcm_token 
        FROM solicitudes s JOIN usuarios u ON s.id_usuario = u.id_usuario 
        WHERE s.id_solicitud = $1
    `;
    const resUser = await client.query(qUsuario, [id_solicitud]);

    await client.query('COMMIT');
    client.release();

    // 6. Notificar al usuario y Socket
    const socketRoom = `solicitud_${id_solicitud}`;
    req.io.to(socketRoom).emit('solicitud_cancelada', { 
        id_solicitud,
        mensaje: "La empresa ha cancelado el servicio."
    });

    if (resUser.rows.length > 0 && resUser.rows[0].fcm_token) {
        enviarNotificacion(
            resUser.rows[0].fcm_token,
            "Servicio Cancelado",
            `La empresa ${nombre_empresa} ha cancelado el servicio: ${motivo}`,
            { id_solicitud: String(id_solicitud), tipo: "cancelada" }
        );
    }

    res.json({ exito: true, mensaje: "Servicio cancelado y créditos reembolsados." });

  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    console.error(e);
    res.status(500).send('Error al cancelar');
  }
});

// -----------------------------------------------------
// 14. Historial Completo (Completados + Cancelados)
// -----------------------------------------------------
router.get('/historial', autenticarEmpresa, async (req, res) => {
  const id_empresa = req.empresa_postgres.id_empresa;

  try {
    const query = `
      -- 1. TRABAJOS COMPLETADOS
      SELECT 
        s.id_solicitud, 
        serv.nombre_servicio,
        te.nombre_tipo, -- Agregamos el tipo (ej: Automovil) para más detalle
        u.nombre as nombre_cliente, 
        u.apellido as apellido_cliente,
        'completada' as estado,
        sc.fecha_completada as fecha,
        sc.calificacion_usuario as calificacion,
        sc.comentario_usuario as comentario,
        NULL as cancelado_por
      FROM solicitudes_completadas sc
      JOIN solicitudes s ON sc.id_solicitud = s.id_solicitud
      JOIN usuarios u ON s.id_usuario = u.id_usuario
      -- JOIN CORREGIDO: Usando la tabla intermedia
      JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
      JOIN servicios serv ON tes.id_servicio = serv.id_servicio
      JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
      WHERE sc.id_empresa = $1

      UNION ALL

      -- 2. TRABAJOS CANCELADOS
      SELECT 
        s.id_solicitud, 
        serv.nombre_servicio,
        te.nombre_tipo,
        u.nombre as nombre_cliente, 
        u.apellido as apellido_cliente,
        'cancelada' as estado,
        scan.fecha_cancelacion as fecha,
        NULL as calificacion,
        scan.descripcion_detallada as comentario,
        scan.cancelado_por
      FROM solicitudes_canceladas scan
      JOIN solicitudes s ON scan.id_solicitud = s.id_solicitud
      JOIN usuarios u ON s.id_usuario = u.id_usuario
      
      JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
      JOIN servicios serv ON tes.id_servicio = serv.id_servicio
      JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
      WHERE scan.id_empresa = $1

      ORDER BY fecha DESC
    `;

    const { rows } = await pool.query(query, [id_empresa]);
    res.json(rows);

  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).send('Error interno al obtener historial');
  }
});

// -----------------------------------------------------
// 14. Historial Completo (Paginado)
// -----------------------------------------------------
router.get('/historial', autenticarEmpresa, async (req, res) => {
  const id_empresa = req.empresa_postgres.id_empresa;
  
  // Parámetros de paginación
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const offset = (page - 1) * limit;

  try {
    const query = `
      WITH historial_unificado AS (
          -- 1. TRABAJOS COMPLETADOS
          SELECT 
            s.id_solicitud, 
            serv.nombre_servicio,
            te.nombre_tipo,
            u.nombre as nombre_cliente, 
            u.apellido as apellido_cliente,
            'completada' as estado,
            sc.fecha_completada as fecha,
            sc.calificacion_usuario as calificacion,
            sc.comentario_usuario as comentario,
            NULL as cancelado_por
          FROM solicitudes_completadas sc
          JOIN solicitudes s ON sc.id_solicitud = s.id_solicitud
          JOIN usuarios u ON s.id_usuario = u.id_usuario
          JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
          JOIN servicios serv ON tes.id_servicio = serv.id_servicio
          JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
          WHERE sc.id_empresa = $1

          UNION ALL

          -- 2. TRABAJOS CANCELADOS
          SELECT 
            s.id_solicitud, 
            serv.nombre_servicio,
            te.nombre_tipo,
            u.nombre as nombre_cliente, 
            u.apellido as apellido_cliente,
            'cancelada' as estado,
            scan.fecha_cancelacion as fecha,
            NULL as calificacion,
            scan.descripcion_detallada as comentario,
            scan.cancelado_por
          FROM solicitudes_canceladas scan
          JOIN solicitudes s ON scan.id_solicitud = s.id_solicitud
          JOIN usuarios u ON s.id_usuario = u.id_usuario
          JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
          JOIN servicios serv ON tes.id_servicio = serv.id_servicio
          JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
          WHERE scan.id_empresa = $1
      )
      SELECT * FROM historial_unificado
      ORDER BY fecha DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await pool.query(query, [id_empresa, limit, offset]);
    res.json(rows);

  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).send('Error interno al obtener historial');
  }
});

// -----------------------------------------------------
// 16. Generar Reportes por Rango de Fechas (PAGINADO)
// -----------------------------------------------------
router.post('/generar-reporte', autenticarEmpresa, async (req, res) => {
    const id_empresa = req.empresa_postgres.id_empresa;
    const { fecha_inicio, fecha_fin } = req.body;
    
    // Parámetros de paginación
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;

    const client = await pool.connect();

    try {
        let resumen = {};
        let grafico = [];

        // PASO 1: Calcular Totales y Gráfico (Solo si es la página 1)
        // Esto evita recalcular todo el gráfico cada vez que haces scroll
        if (page === 1) {
            const queryGlobal = `
                -- Totales y Datos para Gráfico
                SELECT 
                    'completada' as tipo,
                    sc.fecha_completada::date as fecha,
                    sc.calificacion_empresa as calificacion
                FROM solicitudes_completadas sc
                WHERE sc.id_empresa = $1 AND sc.fecha_completada::date BETWEEN $2 AND $3

                UNION ALL

                SELECT 
                    'cancelada' as tipo,
                    scan.fecha_cancelacion::date as fecha,
                    NULL as calificacion
                FROM solicitudes_canceladas scan
                WHERE scan.id_empresa = $1 AND scan.fecha_cancelacion::date BETWEEN $2 AND $3
            `;
            const resGlobal = await client.query(queryGlobal, [id_empresa, fecha_inicio, fecha_fin]);
            
            let totalCompletados = 0;
            let totalCancelados = 0;
            let sumaCalificaciones = 0;
            let countCalificaciones = 0;
            const chartData = {};

            resGlobal.rows.forEach(row => {
                const fechaKey = row.fecha.toISOString().split('T')[0];
                if (!chartData[fechaKey]) chartData[fechaKey] = { fecha: fechaKey, completados: 0, cancelados: 0 };

                if (row.tipo === 'completada') {
                    totalCompletados++;
                    chartData[fechaKey].completados++;
                    if (row.calificacion) {
                        sumaCalificaciones += Number(row.calificacion);
                        countCalificaciones++;
                    }
                } else {
                    totalCancelados++;
                    chartData[fechaKey].cancelados++;
                }
            });

            resumen = {
                total_completados: totalCompletados,
                total_cancelados: totalCancelados,
                calificacion_promedio: countCalificaciones > 0 ? (sumaCalificaciones / countCalificaciones).toFixed(1) : "0.0"
            };
            grafico = Object.values(chartData).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
        }

        // PASO 2: Obtener Lista Paginada (Siempre se ejecuta)
        const queryLista = `
            SELECT * FROM (
                SELECT 
                    'completada' as tipo,
                    sc.fecha_completada as fecha,
                    NULL as cancelado_por,
                    sc.calificacion_empresa as calificacion,
                    serv.nombre_servicio,
                    te.nombre_tipo,
                    u.nombre || ' ' || u.apellido as cliente,
                    sc.comentario_usuario as comentario
                FROM solicitudes_completadas sc
                JOIN solicitudes s ON sc.id_solicitud = s.id_solicitud
                JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
                JOIN servicios serv ON tes.id_servicio = serv.id_servicio
                JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
                JOIN usuarios u ON s.id_usuario = u.id_usuario
                WHERE sc.id_empresa = $1 AND sc.fecha_completada::date BETWEEN $2 AND $3

                UNION ALL

                SELECT 
                    'cancelada' as tipo,
                    scan.fecha_cancelacion as fecha,
                    scan.cancelado_por,
                    NULL as calificacion,
                    serv.nombre_servicio,
                    te.nombre_tipo,
                    u.nombre || ' ' || u.apellido as cliente,
                    scan.descripcion_detallada as comentario
                FROM solicitudes_canceladas scan
                JOIN solicitudes s ON scan.id_solicitud = s.id_solicitud
                JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
                JOIN servicios serv ON tes.id_servicio = serv.id_servicio
                JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
                JOIN usuarios u ON s.id_usuario = u.id_usuario
                WHERE scan.id_empresa = $1 AND scan.fecha_cancelacion::date BETWEEN $2 AND $3
            ) as unificado
            ORDER BY fecha DESC
            LIMIT $4 OFFSET $5
        `;

        const resLista = await client.query(queryLista, [id_empresa, fecha_inicio, fecha_fin, limit, offset]);

        res.json({
            resumen: resumen,
            grafico: grafico,
            lista_detalle: resLista.rows
        });

    } catch (error) {
        console.error('Error generando reporte:', error);
        res.status(500).send('Error al generar reporte');
    } finally {
        client.release();
    }
});


// -----------------------------------------------------
// 17. Resumen Dashboard (Estadísticas Rápidas)
// -----------------------------------------------------
router.get('/resumen-dashboard', autenticarEmpresa, async (req, res) => {
  const id_empresa = req.empresa_postgres.id_empresa;

  try {
    const query = `
      SELECT 
        e.saldo_creditos,
        COALESCE(s.total_completados, 0) as total_completados,
        (SELECT COUNT(*) FROM solicitudes_en_curso WHERE id_empresa = e.id_empresa) as trabajos_en_curso
      FROM empresas e
      LEFT JOIN empresa_estadisticas s ON e.id_empresa = s.id_empresa
      WHERE e.id_empresa = $1
    `;

    const { rows } = await pool.query(query, [id_empresa]);
    
    if (rows.length === 0) return res.status(404).send('Empresa no encontrada');

    const data = rows[0];
    
    // Formatear números
    data.saldo_creditos = Number(data.saldo_creditos).toFixed(2);
    data.trabajos_en_curso = parseInt(data.trabajos_en_curso);

    // Generar avisos automáticos
    const avisos = [];
    if (data.saldo_creditos <= 10.00) {
        avisos.push({ tipo: 'alerta', mensaje: "Tu saldo es bajo. Recarga pronto para seguir aceptando trabajos." });
    }
    if (data.trabajos_en_curso > 2) {
        avisos.push({ tipo: 'info', mensaje: `Tienes ${data.trabajos_en_curso} trabajos en curso simultáneos.` });
    }
    if (Number(data.calificacion) < 3.5) {
        avisos.push({ tipo: 'urgente', mensaje: "Tu calificación ha bajado. Revisa los comentarios." });
    }

    res.json({ ...data, avisos });

  } catch (error) {
    console.error(error);
    res.status(500).send('Error dashboard');
  }
});

// -----------------------------------------------------
// 18. Obtener Calificaciones (Paginado + Resumen)
// -----------------------------------------------------
router.get('/mis-calificaciones', autenticarEmpresa, async (req, res) => {
    const id_empresa = req.empresa_postgres.id_empresa;
    
    // Parámetros de paginación
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const client = await pool.connect();

    try {
        let resumen = {};
        
        // PASO 1: Calcular Promedio y Total Global (Solo si es la página 1)
        if (page === 1) {
            const queryResumen = `
                SELECT 
                    COUNT(*) as total_calificaciones,
                    COALESCE(AVG(calificacion_empresa), 0) as promedio_general
                FROM solicitudes_completadas
                WHERE id_empresa = $1
            `;
            const resResumen = await client.query(queryResumen, [id_empresa]);
            
            resumen = {
                total: parseInt(resResumen.rows[0].total_calificaciones),
                promedio: parseFloat(resResumen.rows[0].promedio_general).toFixed(1)
            };
        }

        // PASO 2: Obtener la lista paginada
        const queryLista = `
            SELECT 
                sc.id_solicitud,
                serv.nombre_servicio,
                sc.fecha_completada,
                sc.calificacion_empresa as rating,
                sc.comentario_usuario as comentario
            FROM solicitudes_completadas sc
            JOIN solicitudes s ON sc.id_solicitud = s.id_solicitud
            JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
            JOIN servicios serv ON tes.id_servicio = serv.id_servicio
            WHERE sc.id_empresa = $1
            ORDER BY sc.fecha_completada DESC
            LIMIT $2 OFFSET $3
        `;

        const resLista = await client.query(queryLista, [id_empresa, limit, offset]);

        // Formatear ratings a números
        const listaFormat = resLista.rows.map(r => ({
            ...r,
            rating: parseFloat(r.rating)
        }));

        res.json({
            resumen: resumen,
            lista: listaFormat
        });

    } catch (error) {
        console.error('Error obteniendo calificaciones:', error);
        res.status(500).send('Error interno');
    } finally {
        client.release();
    }
});

// -----------------------------------------------------
// 19. Historial de Transacciones de Saldo (Paginado)
// -----------------------------------------------------
router.get('/historial-transacciones', autenticarEmpresa, async (req, res) => {
    const id_empresa = req.empresa_postgres.id_empresa;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    try {
        const query = `
            SELECT id_pago, monto_creditos, tipo_transaccion, descripcion, fecha_transaccion
            FROM historial_pagos_empresa
            WHERE id_empresa = $1
            ORDER BY fecha_transaccion DESC
            LIMIT $2 OFFSET $3
        `;
        
        const { rows } = await pool.query(query, [id_empresa, limit, offset]);
        res.json(rows);

    } catch (error) {
        console.error('Error historial transacciones:', error);
        res.status(500).send('Error interno');
    }
});


module.exports = router;