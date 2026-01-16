// utils/notificaciones.js
const admin = require('../config/firebaseAdmin');

const enviarNotificacion = async (token, titulo, cuerpo, data = {}) => {
    if (!token) return;

    const message = {
        notification: {
            title: titulo,
            body: cuerpo,
        },
        data: {
            ...data,
            click_action: "FLUTTER_NOTIFICATION_CLICK"
        },
        token: token
    };

    try {
        await admin.messaging().send(message);
    } catch (error) {
    }
};

module.exports = { enviarNotificacion };