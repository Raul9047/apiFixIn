require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pool = require('./config/db');
const { enviarNotificacion } = require('./utils/notificaciones');

// Importar rutas
const usuarioRoutes = require('./routes/usuarios');
const empresaRoutes = require('./routes/empresas');
const ubicacionRoutes = require('./routes/ubicacion');
const catalogoRoutes = require('./routes/catalogo');
const chatRoutes = require('./routes/chat');

const app = express();
app.use(express.json());
app.use(cors());

// Configuración del Server y Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Middleware para inyectar 'io' en las rutas
app.use((req, res, next) => {
  req.io = io;
  next();
});

// --- RUTAS ---
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/empresas', empresaRoutes);
app.use('/api/ubicacion', ubicacionRoutes); 
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/chat', chatRoutes);

// ==========================================
// Lógica de WebSocket (Global)
// ==========================================
io.on('connection', (socket) => {
    socket.on('join_empresa', (firebase_uid) => {
    const nombreSala = `empresa_${firebase_uid}`;
    socket.join(nombreSala);
  });

  socket.on('join_room', (roomName) => {
    socket.join(roomName);
    console.log(`Socket ${socket.id} se unió a la sala: ${roomName}`);
  });

  socket.on('leave_room', (roomName) => {
    socket.leave(roomName);
    console.log(`Socket ${socket.id} salió de la sala: ${roomName}`);
  });
  
  socket.on('monitor_solicitud', (id_solicitud) => {
      const sala = `solicitud_${id_solicitud}`;
      socket.join(sala);
  });

  socket.on('enviar_ubicacion', (data) => {
    const { id_solicitud, latitud, longitud } = data;
    io.to(`solicitud_${id_solicitud}`).emit('actualizar_ubicacion', { latitud, longitud });
  });

  socket.on('cambiar_estado_empresa', async (data) => {
    const { firebase_uid, estado } = data;
    if (!firebase_uid || !estado) return;
    try {
      await pool.query('UPDATE empresas SET estado = $1 WHERE firebase_uid = $2', [estado, firebase_uid]);
    } catch (error) {
      console.error('Error al cambiar estado de empresa:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado');
  });

  socket.on('enviar_mensaje_chat', async (data) => {
    const { id_solicitud, remitente, mensaje } = data;

    try {
      const query = `
          INSERT INTO mensajes_chat (id_solicitud, remitente, mensaje) 
          VALUES ($1, $2, $3) RETURNING fecha_envio;
      `;
      const resDB = await pool.query(query, [id_solicitud, remitente, mensaje]);
      const fecha = resDB.rows[0].fecha_envio;

      let nombre_empresa = "Soporte";

      if (remitente === 'empresa') {
          const queryNombre = `
            SELECT e.nombre_empresa 
            FROM solicitudes_en_curso sc
            JOIN empresas e ON sc.id_empresa = e.id_empresa WHERE sc.id_solicitud = $1
          `;
          const resNombre = await pool.query(queryNombre, [id_solicitud]);
          
          if (resNombre.rows.length > 0) {
              nombre_empresa = resNombre.rows[0].nombre_empresa;
          }
      }

      // Emitir a la sala de la solicitud
      io.to(`solicitud_${id_solicitud}`).emit('nuevo_mensaje_chat', {
        id_solicitud: id_solicitud, remitente: remitente, mensaje: mensaje, fecha_envio: fecha, nombre_empresa: nombre_empresa
      });

      // Lógica de Notificación Push (FCM)
      let queryToken = '';
      if (remitente === 'empresa') {
        // Si escribe empresa, notificamos al usuario
        queryToken = `
            SELECT u.fcm_token 
            FROM solicitudes s 
            JOIN usuarios u ON s.id_usuario = u.id_usuario 
            WHERE s.id_solicitud = $1`;
      } else {
        // Si escribe usuario, notificamos a la empresa
        queryToken = `
            SELECT e.fcm_token 
            FROM solicitudes_en_curso c 
            JOIN empresas e ON c.id_empresa = e.id_empresa 
            WHERE c.id_solicitud = $1`;
      }
      
      const resToken = await pool.query(queryToken, [id_solicitud]);
      
      if (resToken.rows.length > 0) {
        const destinoToken = resToken.rows[0].fcm_token;
        if (destinoToken) {
            const titulo = remitente === 'empresa' ? nombre_empresa : 'Nuevo mensaje';
            enviarNotificacion(
                destinoToken,
                titulo,
                mensaje,
                { id_solicitud: String(id_solicitud), tipo: "chat" }
            );
        }
      }
    } catch (error) {
      console.error("Error guardando mensaje chat:", error);
    }
  });

});

// Test
app.get('/api/test', (req, res) => res.send('API FixIn Modularizada OK'));

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor FixIn corriendo en puerto ${PORT}`);
});