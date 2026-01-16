const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { soloToken } = require('../middleware/auth');

// Obtener historial de mensajes de una solicitud
router.get('/historial/:id_solicitud', soloToken, async (req, res) => {
    const { id_solicitud } = req.params;
    try {
        const query = `
            SELECT id_mensaje, remitente, mensaje, fecha_envio 
            FROM mensajes_chat 
            WHERE id_solicitud = $1 
            ORDER BY fecha_envio ASC
        `;
        const { rows } = await pool.query(query, [id_solicitud]);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener chat');
    }
});

module.exports = router;