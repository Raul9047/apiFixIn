// routes/usuarios.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { soloToken, autenticarUsuario } = require('../middleware/auth');

const { enviarNotificacion } = require('../utils/notificaciones');

// -----------------------------------------------------
// 1. Verificar existencia (Público)
// -----------------------------------------------------
router.post('/verificar-existencia', async (req, res) => {
  const { email, telefono } = req.body;
  
  let queryText;
  let queryParams;
  
  if (email) { 
    queryText = 'SELECT 1 FROM usuarios WHERE email = $1'; 
    queryParams = [email]; 
  } else if (telefono) { 
    queryText = 'SELECT 1 FROM usuarios WHERE telefono = $1'; 
    queryParams = [telefono]; 
  } else { 
    return res.status(400).send('Se requiere un email o un teléfono para verificar.'); 
  }

  try {
    const { rows } = await pool.query(queryText, queryParams);
    if (rows.length > 0) {
      res.status(200).json({ existe: true });
    } else {
      res.status(200).json({ existe: false });
    }
  } catch (error) { 
    console.error(error);
    res.status(500).send('Error interno del servidor'); 
  }
});

// -----------------------------------------------------
// 2. Registrar Usuario (Autenticado)
// -----------------------------------------------------
router.post('/registrarUsuario', soloToken, async (req, res) => {
  if (req.usuario_postgres) {
    return res.status(400).send('Este usuario ya tiene un perfil registrado.');
  }

  const { nombre, apellido, fecha_nacimiento } = req.body;
  const firebase_uid = req.firebase_uid;
  const email = req.usuario_firebase.email || null;
  const telefono = req.usuario_firebase.phone_number || null;
  
  if (!nombre || !apellido) {
    return res.status(400).send('Falta el campo nombre o apellido.');
  }

  try {
    const query = `
      INSERT INTO usuarios (firebase_uid, nombre, apellido, email, telefono, fecha_nacimiento) 
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [firebase_uid, nombre, apellido, email, telefono, fecha_nacimiento]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    if (error.code === '23505') {
      return res.status(409).send('Este usuario (UID, email o teléfono) ya existe.');
    }
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 3. Obtener Perfil con Calificación (Autenticado)
// -----------------------------------------------------
router.get('/perfil', autenticarUsuario, async (req, res) => {
  try {
    if (!req.usuario_postgres) {
      return res.status(404).send('Perfil no encontrado. Debe registrarse primero.');
    }

    const id_usuario = req.usuario_postgres.id_usuario;

    const query = `
      SELECT 
        u.*, 
        COALESCE(ue.calificacion_promedio, 0.00) as calificacion_promedio,
        COALESCE(ue.total_completados, 0) as total_completados
      FROM usuarios u
      LEFT JOIN usuario_estadisticas ue ON u.id_usuario = ue.id_usuario
      WHERE u.id_usuario = $1
    `;

    const { rows } = await pool.query(query, [id_usuario]);

    if (rows.length === 0) {
      return res.status(404).send('Usuario no encontrado en base de datos.');
    }
    const usuario = rows[0];

    usuario.calificacion_promedio = Number(usuario.calificacion_promedio);
    usuario.total_completados = Number(usuario.total_completados);

    res.status(200).json(usuario);

  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// 3.1 Actualizar Perfil (Autenticado)
router.put('/update-perfil', autenticarUsuario, async (req, res) => {
  const { nombre, apellido, fecha_nacimiento } = req.body;
  const id_usuario = req.usuario_postgres.id_usuario;

  if (!nombre || !apellido || !fecha_nacimiento) {
    return res.status(400).send('Faltan datos obligatorios (nombre, apellido, fecha).');
  }

  try {
    const query = `
      UPDATE usuarios 
      SET nombre = $1, apellido = $2, fecha_nacimiento = $3
      WHERE id_usuario = $4
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [nombre, apellido, fecha_nacimiento, id_usuario]);
    
    if (rows.length === 0) return res.status(404).send('Usuario no encontrado.');
    
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 4. Buscar empresas (Autenticado - PostGIS)
// -----------------------------------------------------
router.post('/empresas/buscar', autenticarUsuario, async (req, res) => {
  if (!req.usuario_postgres) {
    return res.status(401).send('Debe completar su perfil para realizar búsquedas.');
  }

  const { id_tipo, id_servicio, latitud, longitud } = req.body;
  
  if (!id_servicio || !latitud || !longitud) {
    return res.status(400).send('Faltan datos: id_servicio, latitud o longitud.');
  }

  const query = `
    SELECT 
      t.id_empresa, 
      t.nombre_empresa, 
      ts.precio_base,
      ST_AsGeoJSON(t.ubicacion) AS ubicacion_geojson,
      ST_Distance(t.ubicacion, ST_MakePoint($3, $4)::geography) AS distancia_en_metros
    FROM empresas t
    JOIN empresas_servicios ts ON t.id_empresa = ts.id_empresa
    WHERE 
      ts.id_tipo = $1
      AND ts.id_servicio = $2
      AND t.estado = 'en_linea'
      AND ST_DWithin(t.ubicacion, ST_MakePoint($3, $4)::geography, 50000)
    ORDER BY 
      distancia_en_metros ASC;
  `;
  const params = [id_tipo, id_servicio, longitud, latitud];

  try {
    const { rows } = await pool.query(query, params);
    
    const empresas = rows.map(empresa => ({
      ...empresa,
      ubicacion: JSON.parse(empresa.ubicacion_geojson)
    }));
    
    res.status(200).json(empresas);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al buscar empresas');
  }
});

// -----------------------------------------------------
// 4.1. NUEVO: Actualizar Token FCM (Usuario)
// -----------------------------------------------------
router.put('/actualizar-token', autenticarUsuario, async (req, res) => {
    const { token } = req.body;
    const id_usuario = req.usuario_postgres.id_usuario;
    try {
        await pool.query('UPDATE usuarios SET fcm_token = $1 WHERE id_usuario = $2', [token, id_usuario]);
        res.status(200).send('Token actualizado');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error token');
    }
});


// -----------------------------------------------------
// 5. Crear Solicitud de Servicio (Autenticado)
// -----------------------------------------------------
router.post('/crear-solicitud', autenticarUsuario, async (req, res) => {
  // 1. Validar usuario autenticado
  if (!req.usuario_postgres) return res.status(401).send('Perfil no encontrado.');

  const { id_tipo, id_servicio_solicitado, latitud, longitud, detalles_problema } = req.body;
  const id_usuario = req.usuario_postgres.id_usuario;

  // 2. Validar datos de entrada
  if (!id_tipo || !id_servicio_solicitado || !latitud || !longitud) {
    return res.status(400).send('Faltan datos obligatorios.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const queryIdCombinado = `
        SELECT id_tipo_servicio 
        FROM tipo_especifico_servicio 
        WHERE id_tipo = $1 AND id_servicio = $2
    `;
    const resIdComb = await client.query(queryIdCombinado, [id_tipo, id_servicio_solicitado]);

    if (resIdComb.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).send('Este servicio no está disponible para el tipo de vehículo/equipo seleccionado.');
    }
    const idTipoServicio = resIdComb.rows[0].id_tipo_servicio;

    const queryPadre = `
      INSERT INTO solicitudes (
        id_usuario, 
        id_tipo_servicio, -- Usamos el ID combinado
        ubicacion_usuario, 
        ubicacion_servicio, 
        detalles_problema
      )
      VALUES ($1, $2, ST_MakePoint($3, $4)::geography, ST_MakePoint($3, $4)::geography, $5)
      RETURNING id_solicitud, fecha_creacion;
    `;
    
    const resPadre = await client.query(queryPadre, [
      id_usuario, 
      idTipoServicio, 
      longitud, 
      latitud, 
      detalles_problema
    ]);
    
    const solicitudID = resPadre.rows[0].id_solicitud;
    const fechaCreacion = resPadre.rows[0].fecha_creacion;

    const queryHija = `
      INSERT INTO solicitudes_pendientes (id_solicitud, fecha_expiracion)
      VALUES ($1, NOW() + INTERVAL '30 minutes')
    `;
    await client.query(queryHija, [solicitudID]);

    await client.query('COMMIT'); 

    
    const queryInfo = `
        SELECT 
            s.nombre_servicio, 
            te.nombre_tipo, 
            ui.url as icono_url
        FROM tipo_especifico_servicio tes
        JOIN servicios s ON tes.id_servicio = s.id_servicio
        JOIN tipos_especificos te ON tes.id_tipo = te.id_tipo
        LEFT JOIN url_icono ui ON tes.id_icono = ui.id_icono
        WHERE tes.id_tipo_servicio = $1
    `;
    const resInfo = await pool.query(queryInfo, [idTipoServicio]);
    const infoServicio = resInfo.rows[0] || {};

    const queryCandidatos = `
      SELECT 
        e.firebase_uid, 
        e.fcm_token,
        ST_Distance(e.ubicacion, ST_MakePoint($2, $3)::geography) as distancia_metros
      FROM empresas e
      JOIN empresas_servicios es ON e.id_empresa = es.id_empresa
      JOIN ciudades_operativas c ON e.id_ciudad = c.id_ciudad
      WHERE es.id_tipo_servicio = $1 
        AND es.estado = true -- Que la empresa tenga activo este servicio específico
        AND e.estado = 'en_linea' 
        AND c.esta_activa = true
        AND ST_Intersects(c.area_operativa, ST_MakePoint($2, $3)::geography)
    `;
    
    const candidatos = await pool.query(queryCandidatos, [idTipoServicio, longitud, latitud]);

    const payloadSocket = {
        id_solicitud: solicitudID,
        nombre_cliente: req.usuario_postgres.nombre,
        apellido_cliente: req.usuario_postgres.apellido,
        detalles: detalles_problema,
        latitud_cliente: latitud,
        longitud_cliente: longitud,
        nombre_servicio: infoServicio.nombre_servicio,
        nombre_tipo: infoServicio.nombre_tipo,
        icono_url: infoServicio.icono_url,
        fecha_creado: fechaCreacion
    };

    candidatos.rows.forEach(emp => {
      req.io.to(`empresa_${emp.firebase_uid}`).emit('nueva_solicitud', {
        ...payloadSocket,
        distancia_aprox: Math.round(emp.distancia_metros) + ' mts'
      });
      if (emp.fcm_token) {
          enviarNotificacion(
              emp.fcm_token, 
              "Nueva Solicitud Disponible", 
              `Cliente a ${Math.round(emp.distancia_metros)}m necesita ayuda: ${detalles_problema}`,
              { 
                  id_solicitud: String(solicitudID), 
                  tipo: "nueva_solicitud" 
              }
          );
        }
    });

    res.status(201).json({ id_solicitud: solicitudID, mensaje: 'Solicitud creada y enviada a técnicos cercanos.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).send('Error interno del servidor.');
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
// Obtener detalles de una solicitud en curso
// -----------------------------------------------------
router.get('/solicitudes/:id/detalle', autenticarUsuario, async (req, res) => {
    const id_solicitud = req.params.id;
    const id_usuario = req.usuario_postgres.id_usuario;

    try {
        const query = `
            SELECT 
                e.nombre_empresa,
                e.nombre_encargado,
                ST_Y(e.ubicacion::geometry) as latitud,
                ST_X(e.ubicacion::geometry) as longitud,
                
                COALESCE(es.calificacion_promedio, 0.00) as calificacion_promedio,
                COALESCE(es.total_completados, 0) as trabajos_completados,

                (EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.fecha_creacion)) * 12 + 
                 EXTRACT(MONTH FROM AGE(CURRENT_DATE, e.fecha_creacion)))::int as experiencia

            FROM solicitudes_en_curso sec
            JOIN empresas e ON sec.id_empresa = e.id_empresa
            JOIN solicitudes s ON sec.id_solicitud = s.id_solicitud
            LEFT JOIN empresa_estadisticas es ON e.id_empresa = es.id_empresa
            
            WHERE sec.id_solicitud = $1 AND s.id_usuario = $2
        `;
        
        const { rows } = await pool.query(query, [id_solicitud, id_usuario]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada.' });
        }
        
        const data = rows[0];
        data.calificacion_promedio = Number(data.calificacion_promedio);
        data.trabajos_completados = Number(data.trabajos_completados);

        res.json(data);

    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener detalles');
    }
});

// -----------------------------------------------------
// 6. Cancelar Solicitud 
// -----------------------------------------------------
router.post('/cancelar-solicitud', autenticarUsuario, async (req, res) => {
  const { id_solicitud, motivo } = req.body;
  const id_usuario = req.usuario_postgres.id_usuario;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const checkPendiente = await client.query(
        'SELECT 1 FROM solicitudes_pendientes p JOIN solicitudes s ON p.id_solicitud = s.id_solicitud WHERE p.id_solicitud = $1 AND s.id_usuario = $2', 
        [id_solicitud, id_usuario]
    );

    if (checkPendiente.rows.length > 0) {
        await client.query('DELETE FROM solicitudes WHERE id_solicitud = $1', [id_solicitud]);
        await client.query('COMMIT');
        
        req.io.emit('solicitud_eliminada_busqueda', { id_solicitud });
        return res.json({ mensaje: 'Solicitud pendiente cancelada y eliminada.' });
    }

    const checkEnCurso = await client.query(
        'SELECT c.id_empresa FROM solicitudes_en_curso c JOIN solicitudes s ON c.id_solicitud = s.id_solicitud WHERE c.id_solicitud = $1 AND s.id_usuario = $2',
        [id_solicitud, id_usuario]
    );

    if (checkEnCurso.rows.length > 0) {
        const id_empresa = checkEnCurso.rows[0].id_empresa;
        
        // 1. Borrar de en_curso
        await client.query('DELETE FROM solicitudes_en_curso WHERE id_solicitud = $1', [id_solicitud]);
        
        // 2. Insertar en canceladas
        await client.query(`
            INSERT INTO solicitudes_canceladas (id_solicitud, id_empresa, cancelado_por, motivo_principal, descripcion_detallada)
            VALUES ($1, $2, 'usuario', $3, $4)
        `, [id_solicitud, id_empresa, 'Cancelada por usuario', motivo || 'Sin motivo específico']);
        
        await client.query('COMMIT');

        // Notificar a la empresa
        req.io.emit('solicitud_cancelada', { id_solicitud }); 
        return res.json({ mensaje: 'Servicio en curso cancelado.' });
    }

    await client.query('ROLLBACK');
    res.status(404).send('Solicitud no encontrada o ya finalizada.');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).send('Error al cancelar');
  } finally {
    client.release();
  }
});


// -----------------------------------------------------
// 6.1. Calificar Empresa por Usuario
// -----------------------------------------------------
router.post('/calificar-servicio', autenticarUsuario, async (req, res) => {
  const { id_solicitud, calificacion, comentario } = req.body;
  const id_usuario = req.usuario_postgres.id_usuario;

  if (!id_solicitud || !calificacion) {
    return res.status(400).send('Faltan datos obligatorios (id_solicitud o calificacion).');
  }

  try {
    const query = `
      UPDATE solicitudes_completadas sc
      SET calificacion_empresa = $1, 
          comentario_empresa = $2
      FROM solicitudes s
      WHERE sc.id_solicitud = s.id_solicitud
        AND sc.id_solicitud = $3
        AND s.id_usuario = $4
      RETURNING sc.id_solicitud, sc.id_empresa
    `;

    const { rows } = await pool.query(query, [
      calificacion, 
      comentario, 
      id_solicitud, 
      id_usuario
    ]);

    if (rows.length === 0) {
      return res.status(404).send('La solicitud no fue encontrada, no ha sido completada o no pertenece a este usuario.');
    }
    const id_empresa = rows[0].id_empresa;

    const queryEmpresa = 'SELECT firebase_uid FROM empresas WHERE id_empresa = $1';
    const resEmpresa = await pool.query(queryEmpresa, [id_empresa]);
    
    if (resEmpresa.rows.length > 0 && req.io) {
        const uidEmpresa = resEmpresa.rows[0].firebase_uid;
        req.io.to(`empresa_${uidEmpresa}`).emit('nueva_calificacion', {
            id_solicitud: id_solicitud,
            calificacion: calificacion,
            comentario: comentario,
            mensaje: "¡Has recibido una nueva calificación de un cliente!"
        });
    }

    res.status(200).json({ exito: true, mensaje: 'Calificación registrada correctamente.' });

  } catch (error) {
    console.error(error);
    res.status(500).send('Error interno del servidor');
  }
});

// -----------------------------------------------------
// 7. Mis Solicitudes (Paginado)
// -----------------------------------------------------
router.get('/solicitudes/mias', autenticarUsuario, async (req, res) => {
    const id_usuario = req.usuario_postgres.id_usuario;
    
    // Obtener parámetros de paginación (por defecto página 1, 20 items)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;

    try {
        const query = `
            WITH historial_combinado AS (
                -- 1. PENDIENTES
                SELECT 
                    s.id_solicitud, 
                    'pendiente' as estado, 
                    s.fecha_creacion, 
                    serv.nombre_servicio, 
                    NULL as nombre_empresa
                FROM solicitudes s
                JOIN solicitudes_pendientes p ON s.id_solicitud = p.id_solicitud
                JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
                JOIN servicios serv ON tes.id_servicio = serv.id_servicio
                WHERE s.id_usuario = $1
                
                UNION ALL
                
                -- 2. EN CURSO
                SELECT 
                    s.id_solicitud, 
                    'en_curso' as estado, 
                    c.fecha_aceptacion as fecha_creacion, 
                    serv.nombre_servicio, 
                    e.nombre_empresa
                FROM solicitudes s
                JOIN solicitudes_en_curso c ON s.id_solicitud = c.id_solicitud
                JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
                JOIN servicios serv ON tes.id_servicio = serv.id_servicio
                JOIN empresas e ON c.id_empresa = e.id_empresa
                WHERE s.id_usuario = $1

                UNION ALL
                
                -- 3. COMPLETADAS
                SELECT 
                    s.id_solicitud, 
                    'completada' as estado, 
                    comp.fecha_completada as fecha_creacion, 
                    serv.nombre_servicio, 
                    e.nombre_empresa
                FROM solicitudes s
                JOIN solicitudes_completadas comp ON s.id_solicitud = comp.id_solicitud
                JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
                JOIN servicios serv ON tes.id_servicio = serv.id_servicio
                JOIN empresas e ON comp.id_empresa = e.id_empresa
                WHERE s.id_usuario = $1

                UNION ALL

                -- 4. CANCELADAS (Agregamos esto para que el historial esté completo)
                SELECT 
                    s.id_solicitud, 
                    'cancelada' as estado, 
                    can.fecha_cancelacion as fecha_creacion, 
                    serv.nombre_servicio, 
                    e.nombre_empresa
                FROM solicitudes s
                JOIN solicitudes_canceladas can ON s.id_solicitud = can.id_solicitud
                JOIN tipo_especifico_servicio tes ON s.id_tipo_servicio = tes.id_tipo_servicio
                JOIN servicios serv ON tes.id_servicio = serv.id_servicio
                JOIN empresas e ON can.id_empresa = e.id_empresa
                WHERE s.id_usuario = $1
            )
            SELECT * FROM historial_combinado
            ORDER BY fecha_creacion DESC
            LIMIT $2 OFFSET $3
        `;
        
        const { rows } = await pool.query(query, [id_usuario, limit, offset]);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener historial');
    }
});

// -----------------------------------------------------
// 9. Estado Actual (Check Pendiente o En Curso)
// -----------------------------------------------------
router.get('/estado-servicio-actual', autenticarUsuario, async (req, res) => {
  const id_usuario = req.usuario_postgres.id_usuario;
  try {
    // 1. Revisar En Curso
    const queryCurso = `
        SELECT s.id_solicitud, 'aceptada' as estado, e.nombre_empresa, serv.nombre_servicio
        FROM solicitudes s
        JOIN solicitudes_en_curso c ON s.id_solicitud = c.id_solicitud
        JOIN empresas e ON c.id_empresa = e.id_empresa
        JOIN servicios serv ON s.id_servicio = serv.id_servicio
        WHERE s.id_usuario = $1 LIMIT 1
    `;
    const resCurso = await pool.query(queryCurso, [id_usuario]);
    if (resCurso.rows.length > 0) {
        return res.json({ navegarA: 'ServiceConfirmation', datos: resCurso.rows[0] });
    }

    // 2. Revisar Pendiente
    const queryPendiente = `
        SELECT s.id_solicitud, serv.nombre_servicio, s.id_tipo
        FROM solicitudes s
        JOIN solicitudes_pendientes p ON s.id_solicitud = p.id_solicitud
        JOIN servicios serv ON s.id_servicio = serv.id_servicio
        WHERE s.id_usuario = $1 LIMIT 1
    `;
    const resPendiente = await pool.query(queryPendiente, [id_usuario]);
    if (resPendiente.rows.length > 0) {
        return res.json({ navegarA: 'SelectionService', datos: resPendiente.rows[0] });
    }

    res.json({ navegarA: 'Home' });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error');
  }
});

// -----------------------------------------------------
// 8. Verificar Zona Operativa (Autenticado - PostGIS)
// -----------------------------------------------------
router.post('/ubicacion/verificar-zona', autenticarUsuario, async (req, res) => {
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
        ciudad: {
            id_ciudad: rows[0].id_ciudad,
            nombre_ciudad: rows[0].nombre_ciudad
        }
      });
    } else {
      res.status(200).json({
        dentroDeZona: false
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error interno del servidor');
  }
});


module.exports = router;